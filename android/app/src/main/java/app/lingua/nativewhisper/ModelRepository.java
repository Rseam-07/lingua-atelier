package app.lingua.nativewhisper;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.StatFs;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

final class ModelRepository {
    interface Progress { void update(String message); }
    private final File root;
    private final SharedPreferences prefs;
    ModelRepository(Context context) {
        root = new File(context.getFilesDir(), "models"); root.mkdirs();
        prefs = context.getSharedPreferences("models", Context.MODE_PRIVATE);
    }
    File file(ModelCatalog.Model model) { return new File(root, model.filename()); }
    boolean ready(ModelCatalog.Model model) {
        return file(model).isFile() && file(model).length() == model.bytes() && prefs.getString(model.id(), "").equals(model.sha256());
    }
    void download(ModelCatalog.Model model, boolean mirror, AtomicBoolean cancelled, Progress progress) throws Exception {
        if (ready(model)) { progress.update("模型已下载，点击“加载模型”继续。"); return; }
        File part = new File(root, model.filename() + ".part");
        if (part.length() > model.bytes()) part.delete();
        long offset = part.length();
        if (new StatFs(root.getAbsolutePath()).getAvailableBytes() < model.bytes() - offset + 64L * 1024 * 1024) throw new IOException("剩余空间不足，请先释放空间。");
        String host = mirror ? "https://hf-mirror.com" : "https://huggingface.co";
        // Immutable revision is generated from the upstream model metadata.
        String revision = BuildConfigModels.REVISION;
        HttpURLConnection connection = (HttpURLConnection) new URL(host + "/ggerganov/whisper.cpp/resolve/" + revision + "/" + model.filename()).openConnection();
        connection.setConnectTimeout(20000); connection.setReadTimeout(30000);
        if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
        try {
            int code = connection.getResponseCode();
            if (code == 200) offset = 0;
            else if (code != 206 || !String.valueOf(connection.getHeaderField("Content-Range")).startsWith("bytes " + offset + "-")) throw new IOException("模型下载失败（HTTP " + code + "），请检查网络或切换下载源。");
            long done = offset, last = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(part, offset > 0)) {
                byte[] buffer = new byte[65536]; int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (cancelled.get()) throw new InterruptedIOException("下载已取消，已下载部分保留。");
                    done += count; if (done > model.bytes()) throw new IOException("下载大小异常，文件未启用。");
                    output.write(buffer, 0, count);
                    if (System.currentTimeMillis() - last > 300) { progress.update("正在下载 " + model.title() + " · " + done * 100 / model.bytes() + "%"); last = System.currentTimeMillis(); }
                }
                output.getFD().sync();
            }
            if (cancelled.get()) throw new InterruptedIOException("下载已取消，已下载部分保留。");
            progress.update("正在校验模型文件…");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = new FileInputStream(part)) { byte[] buffer = new byte[65536]; int count; while ((count = input.read(buffer)) >= 0) { if (cancelled.get()) throw new InterruptedIOException("校验已取消。"); digest.update(buffer, 0, count); } }
            StringBuilder sha = new StringBuilder(); for (byte b : digest.digest()) sha.append(String.format("%02x", b & 255));
            if (done != model.bytes() || !sha.toString().equals(model.sha256())) { part.delete(); throw new IOException("模型校验失败，请重新下载。"); }
            if (!part.renameTo(file(model))) throw new IOException("无法保存模型，请检查存储空间。");
            if (!prefs.edit().putString(model.id(), model.sha256()).commit()) throw new IOException("模型状态保存失败，请重试。");
            progress.update("下载并校验完成。点击“加载模型”，模型会保持就绪。");
        } finally { connection.disconnect(); }
    }
}
