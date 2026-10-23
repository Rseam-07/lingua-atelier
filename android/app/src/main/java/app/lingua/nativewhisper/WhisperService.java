package app.lingua.nativewhisper;

import android.app.*;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Binder;
import android.os.IBinder;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public final class WhisperService extends Service {
    final Pairing pairing = new Pairing();
    final ExecutorService jobs = Executors.newSingleThreadExecutor();
    final AtomicBoolean cancelled = new AtomicBoolean();
    ModelRepository models;
    WhisperEngine engine;
    String token;
    private LocalServer server;
    private final IBinder binder = new LocalBinder();
    public final class LocalBinder extends Binder { WhisperService service() { return WhisperService.this; } }
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel("local-whisper", "本机语音识别", NotificationManager.IMPORTANCE_LOW));
        Intent stop = new Intent(this, WhisperService.class).setAction("stop");
        PendingIntent stopIntent = PendingIntent.getService(this, 2, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent open = PendingIntent.getActivity(this, 1, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, "local-whisper").setSmallIcon(app.lingua.nativewhisper.R.drawable.ic_lingua)
            .setContentTitle("Lingua 本机识别已启动").setContentText("语音在手机处理 · 点此返回，或停止释放内存")
            .setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null, "停止", stopIntent).build()).build();
        startForeground(8179, notification);
        SharedPreferences prefs = getSharedPreferences("connection", MODE_PRIVATE);
        token = prefs.getString("token", "");
        if (token.isEmpty()) { token = Pairing.random(); prefs.edit().putString("token", token).apply(); }
        models = new ModelRepository(this); engine = new WhisperEngine(models);
        server = new LocalServer(this);
        try { server.start(180000, false); }
        catch (java.io.IOException failure) { stopSelf(); }
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) stopSelf();
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public void onDestroy() {
        cancelled.set(true); if (server != null) server.stop();
        jobs.execute(() -> engine.close()); jobs.shutdown();
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
}
