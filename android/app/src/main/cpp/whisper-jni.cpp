#include <jni.h>
#include <atomic>
#include <algorithm>
#include <cmath>
#include <sstream>
#include <string>
#include <vector>
#include "whisper.h"

struct Resident {
    whisper_context *ctx;
    std::atomic<bool> cancelled{false};
};
static void fail(JNIEnv *env, const char *message) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), message);
}
static std::string quoted(const std::string &s) {
    std::ostringstream out; out << '"';
    for (const unsigned char c : s) {
        switch (c) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default: if (c < 32) out << ' '; else out << c;
        }
    }
    out << '"'; return out.str();
}
extern "C" JNIEXPORT jlong JNICALL
Java_app_lingua_nativewhisper_NativeWhisper_create(JNIEnv *env, jclass, jstring path) {
    const char *file = env->GetStringUTFChars(path, nullptr);
    auto config = whisper_context_default_params();
    config.use_gpu = false; config.flash_attn = true;
    auto *ctx = whisper_init_from_file_with_params(file, config);
    env->ReleaseStringUTFChars(path, file);
    if (!ctx) { fail(env, "Whisper model could not be loaded. Try a smaller model."); return 0; }
    return reinterpret_cast<jlong>(new Resident{ctx});
}
extern "C" JNIEXPORT void JNICALL
Java_app_lingua_nativewhisper_NativeWhisper_cancel(JNIEnv *, jclass, jlong handle) {
    if (handle) reinterpret_cast<Resident *>(handle)->cancelled.store(true);
}
extern "C" JNIEXPORT void JNICALL
Java_app_lingua_nativewhisper_NativeWhisper_destroy(JNIEnv *, jclass, jlong handle) {
    if (!handle) return;
    auto *resident = reinterpret_cast<Resident *>(handle);
    whisper_free(resident->ctx); delete resident;
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_lingua_nativewhisper_NativeWhisper_recognize(
        JNIEnv *env, jclass, jlong handle, jfloatArray audio, jstring lang, jint threads) {
    auto *resident = reinterpret_cast<Resident *>(handle);
    if (!resident) { fail(env, "Model is not loaded."); return nullptr; }
    resident->cancelled.store(false);
    const int size = env->GetArrayLength(audio);
    if (size < 4000 || size > 30 * WHISPER_SAMPLE_RATE) {
        fail(env, "Audio must be between 0.25 and 30 seconds."); return nullptr;
    }
    std::vector<float> samples(std::max(size, WHISPER_SAMPLE_RATE), 0);
    env->GetFloatArrayRegion(audio, 0, size, samples.data());
    const char *language = env->GetStringUTFChars(lang, nullptr);
    auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = std::clamp(static_cast<int>(threads), 1, 8);
    params.language = language;
    params.translate = false; params.no_context = true;
    params.no_timestamps = true; params.single_segment = false;
    params.print_progress = params.print_realtime = params.print_timestamps = params.print_special = false;
    params.temperature = 0; params.temperature_inc = 0;
    params.greedy.best_of = 1; params.suppress_nst = true;
    params.max_tokens = 192;
    params.abort_callback = [](void *p) { return static_cast<Resident *>(p)->cancelled.load(); };
    params.abort_callback_user_data = resident;
    const int code = whisper_full(resident->ctx, params, samples.data(), samples.size());
    env->ReleaseStringUTFChars(lang, language);
    if (code || resident->cancelled.load()) {
        fail(env, resident->cancelled.load() ? "Recognition cancelled; audio is retained." : "Whisper inference failed.");
        return nullptr;
    }
    std::ostringstream segments;
    std::string text;
    const int n = whisper_full_n_segments(resident->ctx);
    for (int i = 0; i < n; ++i) {
        std::string sentence = whisper_full_get_segment_text(resident->ctx, i);
        double sum = 0; int count = 0;
        for (int j = 0; j < whisper_full_n_tokens(resident->ctx, i); ++j) {
            const auto token = whisper_full_get_token_data(resident->ctx, i, j);
            if (token.id < whisper_token_eot(resident->ctx) && std::isfinite(token.plog)) { sum += token.plog; ++count; }
        }
        const auto score = count ? sum / count : -10;
        const auto silence = whisper_full_get_segment_no_speech_prob(resident->ctx, i);
        if (i) segments << ',';
        segments << "{\"text\":" << quoted(sentence) << ",\"avg_logprob\":" << score
                 << ",\"no_speech_prob\":" << silence << '}';
        if (!(silence > .8 && score < -1.5)) text += sentence;
    }
    const char *detected = whisper_lang_str(whisper_full_lang_id(resident->ctx));
    const std::string result = "{\"text\":" + quoted(text) + ",\"language\":" + quoted(detected ? detected : "")
        + ",\"segments\":[" + segments.str() + "]}";
    // JNI NewStringUTF expects modified UTF-8. Return bytes so accents and
    // four-byte Unicode characters are decoded as standard UTF-8 by Java.
    auto bytes = env->NewByteArray(result.size());
    env->SetByteArrayRegion(bytes, 0, result.size(), reinterpret_cast<const jbyte *>(result.data()));
    return bytes;
}
