"""Public portability and authenticated service tests; synthetic PCM only."""
import importlib.util
import io
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
import wave

import numpy as np
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


setup = load('lingua_setup', ROOT / 'installers/setup_runtime.py')
server = load('lingua_server', ROOT / 'native/qwen_asr_server.py')
transformers = load('lingua_transformers', ROOT / 'native/qwen_transformers.py')


def wav():
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        audio.writeframes(np.full(1600, 500, dtype='<i2').tobytes())
    return output.getvalue()


class PortableTests(unittest.TestCase):
    def test_runtime_paths_do_not_assume_a_developer_checkout(self):
        self.assertEqual(setup.runtime_root('Darwin', '/example/Alice'), Path('/example/Alice/Library/Application Support/Lingua Atelier'))
        self.assertEqual(setup.runtime_root('Windows', '/example/Alice', '/example/local'), Path('/example/local/Lingua Atelier'))
        self.assertEqual(set(setup.MODELS), {'mlx', 'transformers'})
        self.assertTrue(all(len(revision) == 40 for _, revision in setup.MODELS.values()))

    def test_shared_service_rejects_missing_or_wrong_token_before_inference(self):
        calls = []
        class Model:
            def generate(self, samples, **options):
                calls.append(options)
                return SimpleNamespace(text='Bonjour.', language=['French'], generation_tokens=None)
        app = server.create_app(Path('/unused'), loader=lambda _: Model(), backend='transformers', token='synthetic-test-connection-token')
        with TestClient(app) as client:
            for headers in [{}, {'Authorization': 'Bearer wrong'}]:
                self.assertEqual(client.get('/health', headers=headers).status_code, 401)
                self.assertEqual(client.post('/inference', headers=headers, files={'file': ('x.wav', wav())}).status_code, 401)
            self.assertEqual(calls, [])
            headers = {'Authorization': 'Bearer synthetic-test-connection-token'}
            self.assertEqual(client.get('/health', headers=headers).json()['runtime'], 'transformers')
            data = client.post('/inference', headers=headers, files={'file': ('x.wav', wav())}, data={'language': 'fr'}).json()
            self.assertEqual(data['text'], 'Bonjour.')
            self.assertIsNone(data['generation_tokens'])
            self.assertEqual(len(calls), 1)

    def test_transformers_contract_preserves_raw_candidates_without_fake_scores(self):
        calls = []
        model = object.__new__(transformers.TransformerModel)
        def transcribe(**options):
            calls.append(options)
            return [SimpleNamespace(text='Bonjour.' if options['language'] == 'French' else '你好。', language=options['language'])]
        model.model = SimpleNamespace(transcribe=transcribe)
        output = transformers.generate_dual(model, np.zeros(1600, dtype=np.float32), 256, 'synthetic vocabulary')
        self.assertEqual([c['language'] for c in output['candidates']], ['fr', 'zh'])
        self.assertEqual([c['text'] for c in output['candidates']], ['Bonjour.', '你好。'])
        self.assertNotIn('language_evidence', output)
        self.assertTrue(output['experimental'])
        self.assertEqual([c['language'] for c in calls], ['French', 'Chinese'])
        self.assertTrue(all(c['context'] == 'synthetic vocabulary' for c in calls))


if __name__ == '__main__':
    unittest.main()
