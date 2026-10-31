package ru.volna.messenger;

import android.Manifest;
import android.content.Intent;
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
}
