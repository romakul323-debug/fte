package ru.lensy.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Игровой режим на время катки:
 *  • Wi‑Fi держится без энергосбережения (меньше скачков пинга);
 *  • «Не беспокоить» (если разрешено) — уведомления не вылезут в бою;
 *  • слежка за нагревом — предупреждение, когда телефон начинает троттлить.
 */
class GameModeService : Service() {
    private var wifiLock: WifiManager.WifiLock? = null
    private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null
    private var prevFilter: Int? = null
    private var warned = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        startInForeground()
        holdWifi()
        if (intent?.getBooleanExtra(EXTRA_DND, false) == true) enableDnd()
        watchHeat()
        running = true
        return START_STICKY
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_MODE, "وضع اللعب", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CH_HEAT, "الحرارة", NotificationManager.IMPORTANCE_HIGH))
        val stop = PendingIntent.getService(
            this, 1, Intent(this, GameModeService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        val open = PendingIntent.getActivity(
            this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val n = Notification.Builder(this, CH_MODE)
            .setSmallIcon(android.R.drawable.ic_lock_idle_low_battery)
            .setContentTitle("Lensy · وضع اللعب")
            .setContentText("واي فاي بلا توفير طاقة · مراقبة الحرارة")
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "إيقاف", stop).build())
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ID_MODE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(ID_MODE, n)
        }
    }

    @Suppress("DEPRECATION")
    private fun holdWifi() {
        if (wifiLock != null) return
        val wm = applicationContext.getSystemService(WifiManager::class.java)
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "lensy:game").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun enableDnd() {
        val nm = getSystemService(NotificationManager::class.java)
        if (!nm.isNotificationPolicyAccessGranted) return
        if (prevFilter == null) prevFilter = nm.currentInterruptionFilter
        nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
    }

    private fun watchHeat() {
        if (Build.VERSION.SDK_INT < 29 || thermalListener != null) return
        val pm = getSystemService(PowerManager::class.java)
        val l = PowerManager.OnThermalStatusChangedListener { status ->
            if (status >= PowerManager.THERMAL_STATUS_SEVERE && !warned) {
                warned = true
                val n = Notification.Builder(this, CH_HEAT)
                    .setSmallIcon(android.R.drawable.stat_sys_warning)
                    .setContentTitle("الهاتف محموم")
                    .setContentText("سيبدأ التقطيع الآن. أعطه دقيقة بين الجولات أو اخفض الإطارات.")
                    .setAutoCancel(true)
                    .build()
                getSystemService(NotificationManager::class.java).notify(ID_HEAT, n)
            } else if (status < PowerManager.THERMAL_STATUS_MODERATE) {
                warned = false
            }
        }
        pm.addThermalStatusListener(l)
        thermalListener = l
    }

    override fun onDestroy() {
        running = false
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
        if (Build.VERSION.SDK_INT >= 29) {
            thermalListener?.let { getSystemService(PowerManager::class.java).removeThermalStatusListener(it) }
        }
        prevFilter?.let {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.isNotificationPolicyAccessGranted) nm.setInterruptionFilter(it)
        }
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "ru.lensy.app.STOP"
        const val EXTRA_DND = "dnd"
        private const val CH_MODE = "mode"
        private const val CH_HEAT = "heat"
        private const val ID_MODE = 66
        private const val ID_HEAT = 67

        @Volatile var running = false

        fun start(ctx: Context, dnd: Boolean) {
            val i = Intent(ctx, GameModeService::class.java).putExtra(EXTRA_DND, dnd)
            ctx.startForegroundService(i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, GameModeService::class.java).setAction(ACTION_STOP))
        }
    }
}
