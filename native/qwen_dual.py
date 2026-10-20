"""Two language-conditioned decodes sharing one Qwen audio encoder and weights.

Uses the batch decoder interfaces of mlx-audio 0.5.9. Token log likelihoods are
model evidence, not calibrated word accuracy or language probabilities.
"""
import math
import time


LANGUAGES = (('fr', 'French'), ('zh', 'Chinese'))


def _prompt_tokens(prompt):
    """Read a single prompt without importing MLX in contract tests."""
    rows = prompt.tolist() if hasattr(prompt, 'tolist') else prompt
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], list):
        raise RuntimeError('Expected one tokenized Qwen prompt per language')
    return rows[0]


def _language_prefix_layout(prompts, unforced_prompt, tokenizer):
    """Locate the next-language-token state, checking the actual tokenizer.

    Qwen's forced suffix is ``language French<asr_text>`` (or Chinese).
    Only when that suffix has three tokens and both prompts are identical up
    to the label can the hidden state before the label be reused as unforced
    language evidence. Fail explicitly if a future tokenizer changes this.
    """
    if len(prompts) != len(LANGUAGES):
        raise RuntimeError('Expected French and Chinese Qwen prompts')
    rows = [_prompt_tokens(prompt) for prompt in prompts]
    base = _prompt_tokens(unforced_prompt)
    suffixes = [tokenizer.encode(f'language {name}<asr_text>', add_special_tokens=False)
                for _, name in LANGUAGES]
    suffixes = [suffix.tolist() if hasattr(suffix, 'tolist') else suffix for suffix in suffixes]
    if (any(len(suffix) != 3 for suffix in suffixes)
            or suffixes[0][0] != suffixes[1][0]
            or suffixes[0][2] != suffixes[1][2]
            or suffixes[0][1] == suffixes[1][1]
            or any(row != base + suffix for row, suffix in zip(rows, suffixes))):
        raise RuntimeError('Unsupported Qwen language prefix; cannot extract unforced evidence')
    # This position predicts the following language-label token. It has seen
    # the common "language" token, but neither forced language label.
    return len(base), [suffix[1] for suffix in suffixes]


def _language_evidence(logprobs):
    """Two label-token scores from one unforced state; never word accuracy."""
    if len(logprobs) != len(LANGUAGES) or not all(math.isfinite(value) for value in logprobs):
        raise RuntimeError('Invalid Qwen language evidence')
    scores = dict(zip((code for code, _ in LANGUAGES), logprobs))
    language = max(scores, key=scores.get)
    return language, {'method': 'unforced-prefix-token', 'logprobs': scores,
                      'margin': abs(logprobs[0] - logprobs[1]), 'calibrated': False}


def repeated_tail(tokens):
    """Stop pathological token loops; retain the audio/candidate for review."""
    if len(tokens) < 24:
        return False
    for period in range(1, 9):
        if len(tokens) >= period * 8 and tokens[-period * 8:] == tokens[-period:] * 8:
            return True
    return False


def generate_dual(model, samples, max_tokens, context=""):
    import mlx.core as mx
    from mlx_audio.lm.models.cache import KVCache

    began = time.perf_counter()
    feats, mask, n_audio = model._preprocess_audio(samples)
    features = model.get_audio_features(feats, mask)
    mx.eval(features)
    prompt_options = {'system_prompt': context} if context else {}
    prompts = [model._build_prompt(n_audio, name, **prompt_options) for _, name in LANGUAGES]
    if prompts[0].shape != prompts[1].shape:
        raise RuntimeError('This tokenizer cannot batch the two language prefixes')
    language_position, language_tokens = _language_prefix_layout(
        prompts, model._build_prompt(n_audio, None, **prompt_options), model._tokenizer)
    embeds = mx.concatenate([model._build_inputs_embeds(p, features) for p in prompts], axis=0)
    mx.eval(embeds)
    del feats, mask, features
    cache = [KVCache() for _ in range(model.config.text_config.num_hidden_layers)]
    # Reuse the causal common-prefix state before the forced language label.
    # Project two final decode states and this one extra state, not every
    # prefill position, through the large vocabulary head.
    hidden = model.model(inputs_embeds=embeds, cache=cache)
    states = mx.concatenate([hidden[:, -1:, :],
                             hidden[0:1, language_position:language_position + 1, :]], axis=0)
    projected = (model.lm_head(states) if model.lm_head is not None
                 else model.model.embed_tokens.as_linear(states))[:, -1, :]
    language_logits = projected[2].astype(mx.float32)
    language_logprobs = language_logits - mx.logsumexp(language_logits)
    label_logprobs = language_logprobs[mx.array(language_tokens)]
    mx.eval(label_logprobs)
    speech_language, evidence = _language_evidence(label_logprobs.tolist())
    logits = projected[:2]
    del embeds, hidden, states, projected, language_logits, language_logprobs, label_logprobs
    eos = model._eos_token_ids()
    histories, scores, done, loops = [[], []], [[], []], [False, False], [False, False]
    for _ in range(max_tokens):
        tokens = mx.argmax(logits, axis=-1)
        # The model emits bf16 logits; subtracting their logsumexp in bf16 can
        # round confident tokens to a misleading zero likelihood loss.
        precise = logits.astype(mx.float32)
        logprobs = precise - mx.logsumexp(precise, axis=-1, keepdims=True)
        chosen = mx.take_along_axis(logprobs, tokens[:, None], axis=-1)[:, 0]
        mx.eval(tokens, chosen)
        for i, (token, score) in enumerate(zip(tokens.tolist(), chosen.tolist())):
            if done[i]:
                continue
            if token in eos:
                done[i] = True
            else:
                histories[i].append(token)
                scores[i].append(score)
                if repeated_tail(histories[i]):
                    loops[i], done[i] = True, True
        if all(done):
            break
        logits = model._forward_with_embeds(model.model.embed_tokens(tokens[:, None]), cache)[:, -1, :]
    candidates = []
    for i, (language, _) in enumerate(LANGUAGES):
        score = sum(scores[i]) / len(scores[i]) if scores[i] else None
        candidates.append({'language': language,
                           'text': model._tokenizer.decode(histories[i], skip_special_tokens=True).strip(),
                           'avg_logprob': score if score is not None and math.isfinite(score) else None,
                           'generation_tokens': len(histories[i]), 'truncated': not done[i] or loops[i],
                           **({'error': 'Repetitive output'} if loops[i] else {})})
    return {'candidates': candidates, 'processing_seconds': time.perf_counter() - began,
            'decode_mode': 'shared-encoder-batch', 'speech_language': speech_language,
            'language_evidence': evidence}
