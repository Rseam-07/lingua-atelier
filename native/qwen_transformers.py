"""Optional Windows/Intel Qwen backend. No MLX imports; model stays resident.

Transformers does not currently provide our MLX prefix evidence / shared encoder
optimization. Both candidates remain available; accuracy and latency need local
validation. No calibrated confidence values are invented.
"""
import time
from types import SimpleNamespace


class TransformerModel:
    def __init__(self, model_dir):
        import torch
        from qwen_asr import Qwen3ASRModel
        cuda = torch.cuda.is_available()
        self.model = Qwen3ASRModel.from_pretrained(
            str(model_dir), dtype=torch.float16 if cuda else torch.float32,
            device_map='cuda:0' if cuda else 'cpu', local_files_only=True,
            attn_implementation='sdpa', max_inference_batch_size=1,
            max_new_tokens=2048,
        )

    def generate(self, samples, language=None, system_prompt='', **options):
        self.model.max_new_tokens = options.get('max_tokens', 2048)
        result = self.model.transcribe(audio=(samples, 16000), language=language,
                                       context=system_prompt)[0]
        # The public transcribe API doesn't expose token count or score.
        return SimpleNamespace(text=result.text, language=result.language.split(','),
                               generation_tokens=None)


def generate_dual(model, samples, max_tokens, context=''):
    began = time.perf_counter()
    candidates = []
    for code, name in [('fr', 'French'), ('zh', 'Chinese')]:
        try:
            result = model.generate(samples, language=name, system_prompt=context,
                                    max_tokens=max_tokens)
            candidates.append({'language': code, 'text': result.text})
        except Exception:
            candidates.append({'language': code, 'text': '', 'error': 'Inference incomplete'})
    return {'candidates': candidates, 'processing_seconds': time.perf_counter() - began,
            'decode_mode': 'transformers-sequential', 'experimental': True}
