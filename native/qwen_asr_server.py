"""Local Qwen3-ASR adapter for Lingua Atelier; no uploads or audio logging.

MLX model loading and inference share one dedicated thread. HTTP health checks
stay responsive during generation; one model remains loaded between chunks.
"""
import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import io
import json
import os
from pathlib import Path
import time
import secrets
import platform
import wave

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_DATASETS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import JSONResponse

ENGINE = 'qwen3-asr'
MODEL_ID = 'Qwen3-ASR-1.7B'
LANGUAGES = {'auto': None, 'fr': 'French', 'zh': 'Chinese', 'en': 'English'}
LANGUAGE_CODES = {'french': 'fr', 'chinese': 'zh', 'english': 'en'}
MAX_BYTES = 4 * 1024 * 1024
MAX_SECONDS = 90


def decode_wav(data: bytes) -> np.ndarray:
    if len(data) > MAX_BYTES:
        raise ValueError('Audio is too large')
    try:
        with wave.open(io.BytesIO(data)) as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, 16000, 'NONE'):
                raise ValueError('Expected mono 16 kHz PCM16 WAV')
            count = audio.getnframes()
            if count < 1 or count > MAX_SECONDS * 16000:
                raise ValueError('Audio must be between 0 and 90 seconds')
            pcm = audio.readframes(count)
            if len(pcm) != count * 2:
                raise ValueError('Truncated WAV')
    except (wave.Error, EOFError) as exc:
        raise ValueError('Invalid WAV') from exc
    return np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.0


def create_app(model_dir: Path, loader=None, dual_decoder=None, backend="mlx", token="") -> FastAPI:
    model_dir = model_dir.expanduser().resolve()
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='qwen-asr')

    def load():
        if loader:
            return loader(str(model_dir))
        if backend == 'transformers':
            from qwen_transformers import TransformerModel
            return TransformerModel(model_dir)
        if not (model_dir / 'model.safetensors').is_file():
            raise RuntimeError('The local Qwen model is missing')
        config = json.loads((model_dir / 'config.json').read_text())
        text_config = config.get('thinker_config', {}).get('text_config', {})
        if config.get('model_type') != 'qwen3_asr' or (text_config.get('hidden_size'), text_config.get('num_hidden_layers')) != (2048, 28):
            raise RuntimeError('Expected the Qwen3-ASR 1.7B model')
        from mlx_audio.stt.utils import load_model
        return load_model(str(model_dir))

    @asynccontextmanager
    async def lifespan(app):
        try:
            app.state.model = await asyncio.get_running_loop().run_in_executor(executor, load)
            yield
        finally:
            executor.shutdown(wait=True, cancel_futures=True)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
    gate = asyncio.Semaphore(1)

    @app.middleware('http')
    async def authenticate(request: Request, call_next):
        if token and not secrets.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + token):
            return JSONResponse({'detail': 'Authorization required'}, status_code=401)
        return await call_next(request)

    @app.get('/health')
    async def health():
        return {'status': 'ok', 'engine': ENGINE, 'model_id': MODEL_ID, 'runtime': backend, 'offline': True,
                'features': ['dual-fr-zh-v1', 'context-hotwords-v1'] + (['acoustic-language-v2'] if backend == 'mlx' else [])}

    def infer(samples, language, context=""):
        began = time.perf_counter()
        duration = len(samples) / 16000
        text, languages, tokens = '', [], 0
        # Skip digital silence only. Weak classroom speech must reach the model.
        if float(np.sqrt(np.mean(samples * samples))) >= 0.00001:
            max_tokens = max(256, min(2048, int(duration * 20) + 64))
            try:
                result = app.state.model.generate(samples, language=LANGUAGES[language],
                    max_tokens=max_tokens, temperature=0.0, chunk_duration=300.0, verbose=False,
                    **({"system_prompt": context} if context else {}))
                tokens = result.generation_tokens
                if tokens is not None and tokens >= max_tokens:
                    raise RuntimeError('Generation limit reached; retry a shorter audio part')
                text = str(result.text).strip()
                names = result.language if isinstance(result.language, list) else [result.language]
                languages = list(dict.fromkeys(LANGUAGE_CODES.get(str(name).lower(), str(name).lower()) for name in names if name))
            finally:
                # Retain weights but release transient attention buffers.
                if loader is None and backend == 'mlx':
                    import mlx.core as mx
                    mx.clear_cache()
        return {'engine': ENGINE, 'model_id': MODEL_ID, 'text': text,
                'languages': languages, 'duration': duration,
                'processing_seconds': time.perf_counter() - began,
                'generation_tokens': tokens}

    def infer_dual(samples, context=""):
        duration = len(samples) / 16000
        if float(np.sqrt(np.mean(samples * samples))) < 0.00001:
            result = {'candidates': [{'language': language, 'text': '', 'truncated': False}
                                     for language in ['fr', 'zh']], 'processing_seconds': 0,
                      'decode_mode': 'digital-silence'}
        else:
            try:
                if dual_decoder:
                    decode = dual_decoder
                elif backend == 'transformers':
                    from qwen_transformers import generate_dual
                    decode = generate_dual
                else:
                    from qwen_dual import generate_dual
                    decode = generate_dual
                result = decode(app.state.model, samples, max(256, min(2048, int(duration * 20) + 64)),
                                **({"context": context} if context else {}))
            finally:
                if loader is None and backend == 'mlx':
                    import mlx.core as mx
                    mx.clear_cache()
        return {'engine': ENGINE, 'model_id': MODEL_ID, 'mode': 'dual', 'duration': duration, **result}

    @app.post('/inference')
    async def inference(file: UploadFile = File(...), language: str = Form('auto'), mode: str = Form('single'), context: str = Form('')):
        try:
            if len(context) > 2000 or '<|' in context or '<asr_text>' in context:
                raise HTTPException(422, 'Invalid or oversized context')
            if language not in LANGUAGES:
                raise HTTPException(422, 'Unsupported language')
            if mode not in ['single', 'dual'] or (mode == 'dual' and language != 'auto'):
                raise HTTPException(422, 'Dual mode requires auto language')
            try:
                samples = decode_wav(await file.read(MAX_BYTES + 1))
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            async with gate:
                try:
                    if mode == 'dual':
                        return await asyncio.get_running_loop().run_in_executor(executor, infer_dual, samples, context)
                    return await asyncio.get_running_loop().run_in_executor(executor, infer, samples, language, context)
                except Exception as exc:
                    # Do not echo private audio, model text or internal tracebacks.
                    raise HTTPException(503, 'Qwen transcription failed; original audio can be retried') from exc
        finally:
            await file.close()

    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8182)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--backend', choices=['auto', 'mlx', 'transformers'], default='auto')
    parser.add_argument('--token-file', type=Path)
    args = parser.parse_args()
    token = args.token_file.read_text().strip() if args.token_file else ''
    if args.host not in ['127.0.0.1', 'localhost', '::1'] and len(token) < 24:
        parser.error('LAN serving requires --token-file containing at least 24 characters')
    backend = args.backend if args.backend != 'auto' else ('mlx' if platform.system() == 'Darwin' and platform.machine() == 'arm64' else 'transformers')
    import uvicorn
    uvicorn.run(create_app(args.model, backend=backend, token=token), host=args.host, port=args.port, access_log=False)
