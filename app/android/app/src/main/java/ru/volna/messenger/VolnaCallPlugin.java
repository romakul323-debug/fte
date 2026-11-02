package ru.volna.messenger;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.ActivityCallback;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Включает и выключает «службу звонка», чтобы голос работал, когда приложение свёрнуто. */
@CapacitorPlugin(
    name = "VolnaCall",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class VolnaCallPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsCallback");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        // даже без разрешения на уведомления служба работает — просто значок не виден
        startService(call);
    }

    private void startService(PluginCall call) {
        boolean mic = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
        Intent i = new Intent(getContext(), CallService.class);
        i.putExtra("mic", mic);
        i.putExtra("title", call.getString("title", "Голосовой канал"));
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Не удалось запустить службу звонка: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), CallService.class));
        call.resolve();
    }

    /** Показ экрана: системный запрос «Начать запись экрана?», потом служба шлёт кадры на сервер. */
    @PluginMethod
    public void screenStart(PluginCall call) {
        if (call.getString("url") == null) { call.reject("no url"); return; }
        MediaProjectionManager mpm = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call, mpm.createScreenCaptureIntent(), "screenResult");
    }

    @ActivityCallback
    private void screenResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Intent i = new Intent(getContext(), ScreenService.class);
        i.putExtra("code", result.getResultCode());
        i.putExtra("data", result.getData());
        i.putExtra("url", call.getString("url"));
        i.putExtra("short", call.getInt("height", 720));
        i.putExtra("fps", call.getInt("fps", 15));
        ScreenService.onEnded = () -> notifyListeners("screenEnded", new JSObject());
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Не удалось начать показ экрана: " + e.getMessage());
        }
    }

    @PluginMethod
    public void screenStop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), ScreenService.class));
        call.resolve();
    }
}
