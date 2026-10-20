import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

path = Path(__file__).resolve().parents[1] / 'native/qwen_dual.py'
spec = importlib.util.spec_from_file_location('qwen_dual', path)
dual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dual)


class Tokenizer:
    def encode(self, text, **_):
        return {'language French<asr_text>': [3, 4, 7],
                'language Chinese<asr_text>': [3, 6, 7]}[text]

    def decode(self, tokens, **_):
        return {11: 'French candidate', 12: '中文候选'}[tokens[0]]


class LanguageEvidenceTests(unittest.TestCase):
    def test_layout_is_checked_against_unforced_prompt_and_tokenizer(self):
        tokenizer = Tokenizer()
        prompts = [[[1, 2, 3, 4, 7]], [[1, 2, 3, 6, 7]]]
        self.assertEqual(dual._language_prefix_layout(prompts, [[1, 2]], tokenizer), (2, [4, 6]))
        for invalid in [
            [[[9, 2, 3, 4, 7]], prompts[1]],  # forced-only earlier context
            [[[1, 2, 3, 4, 8]], prompts[1]],  # changed asr marker
            [[[1, 2, 3, 4, 7, 8]], prompts[1]],  # changed suffix length
        ]:
            with self.assertRaisesRegex(RuntimeError, 'Unsupported Qwen language prefix'):
                dual._language_prefix_layout(invalid, [[1, 2]], tokenizer)
        with self.assertRaisesRegex(RuntimeError, 'Expected one tokenized'):
            dual._language_prefix_layout([[1, 2], [1, 2]], [[1, 2]], tokenizer)

    def test_changed_tokenization_is_rejected(self):
        tokenizer = Tokenizer()
        tokenizer.encode = lambda *_args, **_kwargs: [3, 4, 5, 7]
        with self.assertRaisesRegex(RuntimeError, 'Unsupported Qwen language prefix'):
            dual._language_prefix_layout([[[1, 2, 3, 4, 7]], [[1, 2, 3, 6, 7]]], [[1, 2]], tokenizer)

    def test_raw_label_evidence_is_explicitly_uncalibrated(self):
        language, evidence = dual._language_evidence([-9.0, -0.5])
        self.assertEqual(language, 'zh')
        self.assertEqual(evidence, {'method': 'unforced-prefix-token',
            'logprobs': {'fr': -9.0, 'zh': -0.5}, 'margin': 8.5, 'calibrated': False})
        self.assertEqual(dual._language_evidence([-0.1, -3.0])[0], 'fr')
        for invalid in [[float('nan'), -1], [-1, float('inf')], [-1]]:
            with self.assertRaisesRegex(RuntimeError, 'Invalid Qwen language evidence'):
                dual._language_evidence(invalid)

    def test_generate_uses_common_prefix_not_candidate_likelihood(self):
        # The French decode is more fluent under its own forced prefix, while
        # the actual common-prefix language state favors Chinese strongly.
        mx = ModuleType('mlx.core')
        for name in ['array', 'concatenate', 'argmax', 'take_along_axis', 'float32']:
            setattr(mx, name, getattr(np, name))
        mx.eval = lambda *_: None
        def logsumexp(value, axis=None, keepdims=False):
            peak = np.max(value, axis=axis, keepdims=True)
            result = peak + np.log(np.exp(value - peak).sum(axis=axis, keepdims=True))
            return result if keepdims else np.squeeze(result, axis=axis)
        mx.logsumexp = logsumexp
        packages = {name: ModuleType(name) for name in
                    ['mlx', 'mlx_audio', 'mlx_audio.lm', 'mlx_audio.lm.models']}
        packages['mlx'].core = mx
        cache = ModuleType('mlx_audio.lm.models.cache')
        cache.KVCache = object
        packages.update({'mlx.core': mx, 'mlx_audio.lm.models.cache': cache})

        class Model:
            _tokenizer = Tokenizer()
            config = SimpleNamespace(text_config=SimpleNamespace(num_hidden_layers=1))
            lm_head = staticmethod(lambda states: states)
            prefill_calls = 0
            def __init__(self):
                self.model = SimpleNamespace()  # replaced by callable below
                class Decoder:
                    embed_tokens = staticmethod(lambda tokens: tokens)
                    def __call__(decoder, inputs_embeds, cache):
                        self.prefill_calls += 1
                        hidden = np.zeros((2, 5, 20), dtype=np.float32)
                        hidden[0, 2, 4], hidden[0, 2, 6] = -5.0, 5.0
                        hidden[0, -1, 11] = 10.0
                        hidden[1, -1, 12] = 1.0
                        return hidden
                self.model = Decoder()
            def _preprocess_audio(self, samples):
                return None, None, 1
            def get_audio_features(self, *_):
                return np.zeros((1, 20))
            def _build_prompt(self, n_audio, language):
                return np.array([[1, 2] + ([] if language is None else
                    self._tokenizer.encode(f'language {language}<asr_text>'))])
            def _build_inputs_embeds(self, prompt, features):
                return np.zeros((1, len(prompt[0]), 20))
            def _eos_token_ids(self):
                return {0}
            def _forward_with_embeds(self, embeds, cache):
                logits = np.zeros((2, 1, 20))
                logits[:, :, 0] = 10.0
                return logits

        model = Model()
        with patch.dict(sys.modules, packages):
            result = dual.generate_dual(model, np.ones(160), 2)
        self.assertEqual(model.prefill_calls, 1)
        self.assertEqual(result['speech_language'], 'zh')
        self.assertAlmostEqual(result['language_evidence']['margin'], 10.0, places=5)
        self.assertFalse(result['language_evidence']['calibrated'])
        self.assertGreater(result['candidates'][0]['avg_logprob'], result['candidates'][1]['avg_logprob'])
        self.assertEqual([row['text'] for row in result['candidates']], ['French candidate', '中文候选'])


class LoopTests(unittest.TestCase):
    def test_pathological_loop_is_bounded_without_suppressing_normal_repetition(self):
        self.assertTrue(dual.repeated_tail([1, 2] * 12))
        self.assertTrue(dual.repeated_tail([3, 4, 5, 6] * 8))
        self.assertFalse(dual.repeated_tail([1, 2] * 5))
        self.assertFalse(dual.repeated_tail(list(range(100))))
        self.assertFalse(dual.repeated_tail([1, 2] * 12 + [3, 4]))


if __name__ == '__main__':
    unittest.main()
