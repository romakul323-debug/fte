package ru.volna.messenger;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VolnaCallPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onDestroy() {
        // приложение закрыли совсем — убираем «службу звонка»
        stopService(new Intent(this, CallService.class));
        super.onDestroy();
    }
}
