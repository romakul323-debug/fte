package ru.volna.messenger;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * Показ экрана телефона: MediaProjection → кадры JPEG → WebSocket на сервер Волны → зрителям.
 * Работает и когда открыта игра — это служба переднего плана с уведомлением.
 */
public class ScreenService extends Service {
    private static final String CHANNEL = "volna_screen";
    private static final int ID = 1002;
    static volatile Runnable onEnded;

    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private HandlerThread thread;
    private Handler handler;
    private OkHttpClient client;
    private WebSocket ws;
    private int maxShort = 720, fps = 15, curW, curH;
    private long lastSent;
    private byte[] lastJpeg;
    private Bitmap bmp;
    private final ByteArrayOutputStream jpeg = new ByteArrayOutputStream(256 * 1024);
    private volatile boolean ending;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if ("stop".equals(intent.getAction())) { end(); return START_NOT_STICKY; }
        if (projection != null) return START_NOT_STICKY;

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Показ экрана", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent stop = new Intent(this, ScreenService.class).setAction("stop");
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle("Волна — показываешь экран")
            .setContentText("Его видят все в голосовом канале")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openPi)
            .addAction(0, "Остановить", stopPi)
            .build();
        try {
            ServiceCompat.startForeground(this, ID, n, Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : 0);
        } catch (Exception e) {
            end();
            return START_NOT_STICKY;
        }

        int code = intent.getIntExtra("code", Activity.RESULT_CANCELED);
        Intent data = intent.getParcelableExtra("data");
        String url = intent.getStringExtra("url");
        maxShort = Math.max(360, Math.min(1080, intent.getIntExtra("short", 720)));
        fps = Math.max(5, Math.min(20, intent.getIntExtra("fps", 15)));
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        try {
            projection = mpm.getMediaProjection(code, data);
        } catch (Exception e) {
            projection = null;
        }
        if (projection == null || url == null) { end(); return START_NOT_STICKY; }

        thread = new HandlerThread("volna-screen");
        thread.start();
        handler = new Handler(thread.getLooper());
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() { end(); }
        }, handler);

        client = new OkHttpClient.Builder().pingInterval(15, TimeUnit.SECONDS).build();
        ws = client.newWebSocket(new Request.Builder().url(url).header("User-Agent", "VolnaApp/1.0").build(), new WebSocketListener() {
            @Override
            public void onClosing(WebSocket s, int c, String r) { end(); }
            @Override
            public void onClosed(WebSocket s, int c, String r) { end(); }
            @Override
            public void onFailure(WebSocket s, Throwable t, Response r) { end(); }
        });

        handler.post(this::setupDisplay);
        handler.postDelayed(this::tick, 1000);
        return START_NOT_STICKY;
    }

    // размер картинки: короткая сторона не больше maxShort, пропорции как у экрана (учитывает поворот)
    private void setupDisplay() {
        if (ending || projection == null) return;
        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        Point size = new Point();
        wm.getDefaultDisplay().getRealSize(size);
        DisplayMetrics dm = getResources().getDisplayMetrics();
        float scale = Math.min(1f, (float) maxShort / Math.max(1, Math.min(size.x, size.y)));
        int w = Math.max(2, Math.round(size.x * scale) & ~1);
        int h = Math.max(2, Math.round(size.y * scale) & ~1);
        if (w == curW && h == curH && display != null) return;
        curW = w;
        curH = h;
        ImageReader old = reader;
        reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
        reader.setOnImageAvailableListener(this::onImage, handler);
        try {
            if (display == null) {
                display = projection.createVirtualDisplay("volna-screen", w, h, dm.densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, handler);
            } else {
                display.resize(w, h, dm.densityDpi);
                display.setSurface(reader.getSurface());
            }
        } catch (Exception e) {
            end();
        }
        if (old != null) old.close();
    }

    // раз в секунду: проверить поворот экрана и повторить последний кадр (чтобы новые зрители сразу видели картинку)
    private void tick() {
        if (ending) return;
        setupDisplay();
        if (lastJpeg != null && SystemClock.uptimeMillis() - lastSent > 1500) send(lastJpeg);
        handler.postDelayed(this::tick, 1000);
    }

    private void onImage(ImageReader r) {
        Image img = null;
        try {
            img = r.acquireLatestImage();
            if (img == null || ws == null) return;
            long now = SystemClock.uptimeMillis();
            if (now - lastSent < 1000 / fps) return;
            if (ws.queueSize() > 400 * 1024) return; // сеть не успевает — пропускаем кадр
            Image.Plane p = img.getPlanes()[0];
            ByteBuffer buf = p.getBuffer();
            int w = img.getWidth(), h = img.getHeight();
            int padW = p.getRowStride() / p.getPixelStride();
            if (bmp == null || bmp.getWidth() != padW || bmp.getHeight() != h) {
                if (bmp != null) bmp.recycle();
                bmp = Bitmap.createBitmap(padW, h, Bitmap.Config.ARGB_8888);
            }
            buf.rewind();
            bmp.copyPixelsFromBuffer(buf);
            Bitmap out = padW == w ? bmp : Bitmap.createBitmap(bmp, 0, 0, w, h);
            jpeg.reset();
            out.compress(Bitmap.CompressFormat.JPEG, 55, jpeg);
            if (out != bmp) out.recycle();
            lastJpeg = jpeg.toByteArray();
            send(lastJpeg);
        } catch (Exception ignored) {
        } finally {
            if (img != null) img.close();
        }
    }

    private void send(byte[] b) {
        lastSent = SystemClock.uptimeMillis();
        WebSocket s = ws;
        if (s != null) s.send(ByteString.of(b));
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        if (handler != null) handler.post(this::setupDisplay);
    }

    private synchronized void end() {
        if (ending) return;
        ending = true;
        try { if (display != null) display.release(); } catch (Exception ignored) {}
        try { if (reader != null) reader.close(); } catch (Exception ignored) {}
        try { if (projection != null) projection.stop(); } catch (Exception ignored) {}
        try { if (ws != null) ws.close(1000, "stop"); } catch (Exception ignored) {}
        try { if (client != null) client.dispatcher().executorService().shutdown(); } catch (Exception ignored) {}
        Runnable cb = onEnded;
        if (cb != null) { try { cb.run(); } catch (Exception ignored) {} }
        try { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE); } catch (Exception ignored) {}
        if (thread != null) thread.quitSafely();
        stopSelf();
    }

    @Override
    public void onDestroy() {
        end();
        super.onDestroy();
    }
}
