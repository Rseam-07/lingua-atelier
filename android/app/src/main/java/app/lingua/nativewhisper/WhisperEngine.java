package app.lingua.nativewhisper;

import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.locks.ReentrantLock;

/** Exactly one native context is resident; text models live in another process. */
final class WhisperEngine implements AutoCloseable {
    private final ReentrantLock lock = new ReentrantLock();
    private volatile long handle;
    private volatile String active = "";
    private volatile boolean closed;
    private final ModelRepository models;
    WhisperEngine(ModelRepository models) { this.models = models; }
    String active() { return active; }
    boolean busy() { return lock.isLocked(); }
    void load(String id) throws Exception {
        if (!lock.tryLock()) throw new IllegalStateException("语音模型正在处理，请稍后再试。");
        try { loadLocked(id); } finally { lock.unlock(); }
    }
    private void loadLocked(String id) throws Exception {
        if (closed) throw new IllegalStateException("服务已停止，请重新打开本机识别。");
        if (id.equals(active) && handle != 0) return;
        ModelCatalog.Model model = ModelCatalog.get(id);
        if (!models.ready(model)) throw new IllegalStateException("先在本机识别 App 选择并下载该模型。");
        if (handle != 0) { NativeWhisper.destroy(handle); handle = 0; active = ""; }
        handle = NativeWhisper.create(models.file(model).getAbsolutePath()); active = id;
    }
    JSONObject transcribe(byte[] wav, String id, String language, int threads) throws Exception {
        if (!java.util.Arrays.asList("auto", "fr", "zh", "en").contains(language)) throw new IllegalArgumentException("当前支持自动、中、英、法识别。");
        float[] samples = Wav.decode(wav);
        if (!lock.tryLock()) throw new IllegalStateException("上一段语音仍在处理，请稍后再试。");
        try {
            long began = System.nanoTime(); loadLocked(id);
            long loaded = System.nanoTime();
            JSONObject result = new JSONObject(new String(NativeWhisper.recognize(handle, samples, language, Math.max(1, Math.min(8, threads))), StandardCharsets.UTF_8));
            long elapsed = (System.nanoTime() - loaded) / 1000000;
            return result.put("engine", "lingua-whisper-android").put("protocol", 1).put("model_id", id)
                .put("backend", "native-cpu").put("threads", Math.max(1, Math.min(8, threads)))
                .put("audio_seconds", samples.length / 16000d).put("inference_ms", elapsed)
                .put("load_ms", (loaded - began) / 1000000).put("rtf", elapsed / (samples.length / 16d));
        } finally { lock.unlock(); }
    }
    @Override public void close() {
        closed = true;
        // Serialize cancellation and freeing: cancel() must never see a freed handle.
        lock.lock();
        try { if (handle != 0) NativeWhisper.destroy(handle); handle = 0; active = ""; }
        finally { lock.unlock(); }
    }
}
