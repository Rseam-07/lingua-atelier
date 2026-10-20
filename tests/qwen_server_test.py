"""Adapter contract tests; no MLX weights or personal audio are needed."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace
import threading
import time
import unittest
import wave

import numpy as np
from fastapi.testclient import TestClient

path = Path(__file__).resolve().parents[1] / 'native/qwen_asr_server.py'
spec = importlib.util.spec_from_file_location('qwen_adapter', path)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def wav(value=100):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as audio:
        audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        audio.writeframes(np.full(16000, value, dtype='<i2').tobytes())
    return stream.getvalue()


class AdapterTests(unittest.TestCase):
    def test_invalid_wav(self):
        for data in [b'', b'not a wav', wav()[:-10]]:
            with self.assertRaises(ValueError):
                adapter.decode_wav(data)

    def test_persistent_model_serial_inference_and_responsive_health(self):
        loaded, calls, threads = [], [], []
        started = threading.Event()

        class Model:
            active = 0
            def generate(self, samples, **options):
                self.active += 1
                assert self.active == 1
                threads.append(threading.get_ident())
                calls.append(options)
                started.set()
                time.sleep(.08)
                self.active -= 1
                return SimpleNamespace(text='Je suis géographe.', language=['French'], generation_tokens=12)

        def load(_):
            loaded.append(threading.get_ident())
            return Model()

        with TestClient(adapter.create_app(Path('/unused'), load)) as client:
            def send(language='auto', data=None):
                return client.post('/inference', files={'file': ('audio.wav', wav() if data is None else data, 'audio/wav')}, data={'language': language})
            with ThreadPoolExecutor(2) as pool:
                first = pool.submit(send)
                self.assertTrue(started.wait(2))
                self.assertEqual(client.get('/health').json()['engine'], 'qwen3-asr')
                second = pool.submit(send, 'fr')
                for future in [first, second]:
                    result = future.result().json()
                    self.assertEqual(result['languages'], ['fr'])
                    self.assertNotIn('language_probabilities', result)
            self.assertEqual(len(loaded), 1)
            self.assertTrue(all(t == loaded[0] for t in threads))
            self.assertEqual([c['language'] for c in calls], [None, 'French'])
            self.assertEqual(send(data=wav(0)).json()['text'], '')
            self.assertEqual(len(calls), 2)
            self.assertEqual(send(data=b'bad').status_code, 422)
            self.assertEqual(send('unknown').status_code, 422)
            self.assertEqual(len(calls), 2)

    def test_dual_contract_reuses_model_and_retains_incomplete_candidate(self):
        sentinel, calls = object(), []
        def decode(model, samples, max_tokens):
            self.assertIs(model, sentinel)
            calls.append((len(samples), max_tokens, threading.get_ident()))
            return {'candidates': [{'language': 'fr', 'text': 'Bonjour.', 'avg_logprob': -.2, 'truncated': False},
                                   {'language': 'zh', 'text': '你好。', 'truncated': True}],
                    'decode_mode': 'shared-encoder-batch', 'processing_seconds': .1,
                    'speech_language': 'fr', 'language_evidence': {
                        'method': 'unforced-prefix-token', 'logprobs': {'fr': -.1, 'zh': -4.1},
                        'margin': 4.0, 'calibrated': False}}
        with TestClient(adapter.create_app(Path('/unused'), lambda _: sentinel, decode)) as client:
            self.assertIn('dual-fr-zh-v1', client.get('/health').json()['features'])
            def send(data, language='auto', mode='dual'):
                return client.post('/inference', files={'file': ('audio.wav', data, 'audio/wav')}, data={'language': language, 'mode': mode})
            result = send(wav()).json()
            self.assertEqual(result['mode'], 'dual')
            self.assertEqual(result['candidates'][0]['avg_logprob'], -.2)
            self.assertTrue(result['candidates'][1]['truncated'])
            self.assertEqual(result['speech_language'], 'fr')
            self.assertEqual(result['language_evidence']['method'], 'unforced-prefix-token')
            self.assertFalse(result['language_evidence']['calibrated'])
            self.assertNotIn('language_probabilities', result)
            self.assertEqual(len(calls), 1)
            silence = send(wav(0)).json()
            self.assertEqual([c['text'] for c in silence['candidates']], ['', ''])
            self.assertEqual(len(calls), 1)
            self.assertEqual(send(wav(), language='fr').status_code, 422)
            self.assertEqual(send(wav(), mode='other').status_code, 422)
            self.assertEqual(send(data=b'bad').status_code, 422)
            self.assertEqual(len(calls), 1)

    def test_bounded_vocabulary_context_reaches_both_decodes(self):
        calls=[]
        class Model:
            def generate(self, samples, **options):
                calls.append(options)
                return SimpleNamespace(text='Les visiteurs.', language='French', generation_tokens=3)
        def decode(model,samples,max_tokens,context=''):
            calls.append({'dual_context':context})
            return {'candidates':[]}
        with TestClient(adapter.create_app(Path('/unused'),lambda _:Model(),decode)) as client:
            def send(context,mode='single'):
                return client.post('/inference',files={'file':('audio.wav',wav(),'audio/wav')},data={'language':'auto','mode':mode,'context':context})
            self.assertEqual(send('touriste, excursionniste').status_code,200)
            self.assertEqual(calls[-1]['system_prompt'],'touriste, excursionniste')
            self.assertEqual(send('touriste, excursionniste','dual').status_code,200)
            self.assertEqual(calls[-1]['dual_context'],'touriste, excursionniste')
            self.assertEqual(send('x'*2001).status_code,422)
            self.assertEqual(send('<|im_start|>').status_code,422)


if __name__ == '__main__':
    unittest.main()
