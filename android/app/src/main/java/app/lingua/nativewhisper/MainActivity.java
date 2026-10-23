package app.lingua.nativewhisper;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.*;
import android.net.Uri;
import android.os.*;
import android.view.View;
import android.widget.*;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;

public final class MainActivity extends Activity {
    private WhisperService service;
    private boolean bound, working;
    private volatile boolean recording;
    private Spinner modelChoice, sourceChoice, languageChoice, threadChoice;
    private TextView status, result;
    private Button download, load, record, pair, export;
    private String latestMarkdown = "";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ServiceConnection connection = new ServiceConnection() {
        public void onServiceConnected(ComponentName name, IBinder binder) { service = ((WhisperService.LocalBinder) binder).service(); bound = true; refresh(); }
        public void onServiceDisconnected(ComponentName name) { service = null; bound = false; status.setText("识别组件已停止，重新打开 App 可启动。"); }
    };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); buildUi();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 10);
        Intent intent = new Intent(this, WhisperService.class); startForegroundService(intent); bindService(intent, connection, BIND_AUTO_CREATE);
    }
    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private void buildUi() {
        getWindow().setStatusBarColor(Color.rgb(247, 246, 241)); getWindow().setNavigationBarColor(Color.rgb(247, 246, 241));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(Color.rgb(247, 246, 241));
        LinearLayout page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setPadding(dp(24), dp(28), dp(24), dp(30)); scroll.addView(page); setContentView(scroll);
        text(page, "LINGUA ATELIER", 13, true); text(page, "手机，也能听课。", 30, true);
        text(page, "本机 Whisper · 中文 / English / Français\n无需电脑。安装一次，在 Obsidian 里继续记笔记。", 15, false);
        text(page, "1  选择并下载", 20, true);
        String[] choices = Arrays.stream(ModelCatalog.ALL).map(m -> m.title() + " · " + m.megabytes() + " MB").toArray(String[]::new);
        modelChoice = spinner(page, choices);
        String saved = getPreferences(MODE_PRIVATE).getString("model", "small-q5_1");
        for (int i = 0; i < ModelCatalog.ALL.length; ++i) if (ModelCatalog.ALL[i].id().equals(saved)) modelChoice.setSelection(i);
        sourceChoice = spinner(page, new String[]{"Hugging Face 官方下载", "国内镜像 hf-mirror.com（相同校验）"});
        sourceChoice.setSelection(getPreferences(MODE_PRIVATE).getBoolean("mirror", false) ? 1 : 0);
        text(page, "只在点击后下载。Small 适合先测试较强手机；Base 更省电；Tiny 用于快速试运行。下载量不等于运行内存。", 13, false);
        download = button(page, "下载 / 继续下载所选模型", () -> task(() -> {
            service.cancelled.set(false);
            service.models.download(selected(), sourceChoice.getSelectedItemPosition() == 1, service.cancelled, this::message);
        }));
        button(page, "取消下载", () -> { if (service != null) service.cancelled.set(true); });
        text(page, "2  加载与十秒试录", 20, true);
        threadChoice = spinner(page, new String[]{"4 线程 · 默认", "2 线程 · 更省电", "6 线程 · 性能测试"});
        load = button(page, "加载模型并保持就绪", () -> task(() -> { message("正在加载 " + selected().title() + "…"); service.engine.load(selected().id()); message("模型已常驻。可以试录，或连接 Obsidian。"); }));
        languageChoice = spinner(page, new String[]{"自动（中 / 英 / 法）", "法语", "中文", "英语"});
        record = button(page, "试录 10 秒并测速", this::startRecording);
        text(page, "允许麦克风后，说一段你知道原文的内容。原音先保存，再识别；这里会显示实际耗时。测速时保持 App 前台。", 13, false);
        status = text(page, "正在启动本机识别…", 14, true);
        result = text(page, "试录结果将显示在这里。", 17, false); result.setTextIsSelectable(true);
        export = button(page, "保存本次测试 Markdown", () -> { Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("text/markdown").putExtra(Intent.EXTRA_TITLE, "Lingua-手机试录.md").addCategory(Intent.CATEGORY_OPENABLE); startActivityForResult(intent, 20); }); export.setEnabled(false);
        text(page, "3  回到 Obsidian", 20, true);
        pair = button(page, "连接 Obsidian", this::pairObsidian);
        text(page, "需安装 Lingua Atelier 0.9.0 或更新插件。点击后自动连接当前手机，无需填写地址或密钥。语音留在本机；翻译和整理在插件里自行选择本地或在线。", 13, false);
        button(page, "打开插件下载页", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/Rseam-07/lingua-atelier/releases"))));
        text(page, "使用提示", 20, true);
        text(page, "上课前：打开本 App 加载模型 → 连接 Obsidian → 开始录音。\n通知栏显示本机识别状态；结束后可点“停止”释放模型。\n本版使用原生多核 CPU，未启用 GPU / NPU。长课速度、发热与中法混合准确率需要真机验证。", 14, false);
        button(page, "停止本机识别并释放内存", () -> { if (working) { message("请等待当前下载或识别结束。"); return; } if (bound) { unbindService(connection); bound = false; } stopService(new Intent(this, WhisperService.class)); service = null; finish(); });
    }
    private TextView text(LinearLayout page, String value, int size, boolean bold) {
        TextView text = new TextView(this); text.setText(value); text.setTextSize(size); text.setTextColor(Color.rgb(49, 61, 53));
        text.setPadding(0, dp(bold ? 18 : 9), 0, dp(8)); text.setLineSpacing(dp(3), 1);
        if (bold) text.setTypeface(Typeface.DEFAULT, Typeface.BOLD); page.addView(text); return text;
    }
    private Spinner spinner(LinearLayout page, String[] values) {
        Spinner spinner = new Spinner(this); ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, values);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); spinner.setAdapter(adapter); page.addView(spinner, new LinearLayout.LayoutParams(-1, dp(52))); return spinner;
    }
    private Button button(LinearLayout page, String label, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false); button.setTextColor(Color.rgb(62, 88, 70));
        page.addView(button, new LinearLayout.LayoutParams(-1, -2)); button.setOnClickListener(v -> action.run()); return button;
    }
    private ModelCatalog.Model selected() { return ModelCatalog.ALL[modelChoice.getSelectedItemPosition()]; }
    private int threads() { return new int[]{4, 2, 6}[threadChoice.getSelectedItemPosition()]; }
    private String language() { return new String[]{"auto", "fr", "zh", "en"}[languageChoice.getSelectedItemPosition()]; }
    private void message(String value) { main.post(() -> { if (!isFinishing()) status.setText(value); }); }
    private void refresh() {
        boolean enabled = service != null && !working;
        for (View v : new View[]{modelChoice, sourceChoice, languageChoice, threadChoice, download, load, record, pair}) v.setEnabled(enabled);
        export.setEnabled(!latestMarkdown.isEmpty() && !working);
        if (enabled) status.setText(service.models.ready(selected()) ? "所选模型已下载，点击加载或试录。" : "选择模型后点击下载，建议使用 Wi-Fi。");
    }
    private interface Job { void run() throws Exception; }
    private void task(Job job) {
        if (working || service == null) return;
        working = true; refresh();
        // Freeze the UI selection while the native job owns the model.
        getPreferences(MODE_PRIVATE).edit().putString("model", selected().id()).putBoolean("mirror", sourceChoice.getSelectedItemPosition() == 1).apply();
        service.jobs.execute(() -> {
            String finalMessage;
            try { job.run(); finalMessage = "处理完成，模型与已保存文件保留。"; }
            catch (Exception e) { finalMessage = e.getMessage() == null ? "处理未完成，请重试。" : e.getMessage(); }
            final String done = finalMessage;
            main.post(() -> { working = false; if (!isFinishing()) { refresh(); status.setText(done); } });
        });
    }
    private void startRecording() {
        if (service == null || working) return;
        if (!service.models.ready(selected())) { message("请先下载所选模型。"); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 11); return; }
        String model = selected().id(), lang = language(); int count = threads();
        task(() -> {
            service.engine.load(model);
            int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (min <= 0) throw new IOException("手机麦克风不支持当前采样格式。");
            AudioRecord input = new AudioRecord(MediaRecorder.AudioSource.MIC, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, 6400));
            ByteArrayOutputStream pcm = new ByteArrayOutputStream(); recording = true;
            try {
                if (input.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("麦克风未就绪，请检查权限或是否被其他 App 占用。");
                input.startRecording(); byte[] buffer = new byte[3200]; long deadline = SystemClock.elapsedRealtime() + 15000;
                while (recording && pcm.size() < 320000 && SystemClock.elapsedRealtime() < deadline) {
                    int n = input.read(buffer, 0, Math.min(buffer.length, 320000 - pcm.size()));
                    if (n < 0) throw new IOException("麦克风读取失败。");
                    if (n == 0) continue;
                    pcm.write(buffer, 0, n); message("正在试录 · " + pcm.size() / 32000 + " / 10 秒");
                }
                input.stop();
            } finally { input.release(); recording = false; }
            byte[] wav = Wav.encode(pcm.toByteArray());
            File recordings = new File(getFilesDir(), "recordings"); recordings.mkdirs();
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date());
            File audio = new File(recordings, stamp + ".wav");
            try (FileOutputStream output = new FileOutputStream(audio)) { output.write(wav); output.getFD().sync(); }
            message("原始录音已保存，正在本机识别…");
            JSONObject data = service.engine.transcribe(wav, model, lang, count);
            String words = data.getString("text").trim();
            double rtf = data.getDouble("rtf");
            String detail = String.format(Locale.CHINA, "%s\n\n音频 %.1f 秒 · 识别 %.2f 秒\n实时系数 %.2f（小于 1 表示本段处理快于音频时长）\n%s · %d 线程\n这次短测不能代表整节课的速度或准确率。", words, data.getDouble("audio_seconds"), data.getDouble("inference_ms") / 1000, rtf, model, count);
            latestMarkdown = "# Lingua 手机试录\n\n- 模型：" + model + "\n- 设备：" + Build.MANUFACTURER + " " + Build.MODEL + "\n- 实时系数：" + String.format(Locale.ROOT, "%.3f", rtf) + "\n\n## 自动转写\n\n" + words + "\n\n## 测试记录\n\n" + detail + "\n\n原始录音保存在本机识别 App 内；这次短测不代表课堂准确率。\n";
            try (FileOutputStream output = new FileOutputStream(new File(recordings, stamp + ".md"))) { output.write(latestMarkdown.getBytes(StandardCharsets.UTF_8)); }
            main.post(() -> result.setText(detail));
        });
    }
    private void pairObsidian() {
        if (service == null || working) return;
        if (!service.models.ready(selected())) { message("请先下载所选语音模型，再连接 Obsidian。"); return; }
        String code = service.pairing.begin(SystemClock.elapsedRealtime());
        Uri link = new Uri.Builder().scheme("obsidian").authority("lingua-android").appendQueryParameter("code", code).appendQueryParameter("model", selected().id()).appendQueryParameter("threads", Integer.toString(threads())).build();
        try { startActivity(new Intent(Intent.ACTION_VIEW, link).setPackage("md.obsidian")); }
        catch (ActivityNotFoundException e) { message("请先安装 Obsidian，并启用 Lingua Atelier 0.9.0 或更新版本。"); }
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == 11) { if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) startRecording(); else message("未允许麦克风。仍可在 Obsidian 导入录音处理。"); }
    }
    @Override protected void onActivityResult(int request, int code, Intent data) {
        super.onActivityResult(request, code, data);
        if (request == 20 && code == RESULT_OK && data != null && data.getData() != null) {
            try (OutputStream output = getContentResolver().openOutputStream(data.getData())) { if (output == null) throw new IOException(); output.write(latestMarkdown.getBytes(StandardCharsets.UTF_8)); message("Markdown 已保存。"); }
            catch (IOException e) { message("保存失败，测试原稿仍保留在本机。"); }
        }
    }
    @Override protected void onDestroy() { recording = false; if (bound) unbindService(connection); super.onDestroy(); }
}
