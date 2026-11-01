package ru.lensy.app

import android.app.ActivityManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.math.abs

data class Edition(val id: String, val name: String, val pkg: String)

data class PingResult(val avg: Double, val jitter: Double, val loss: Int)

object Engine {
    val editions = listOf(
        Edition("kr", "الكورية (KR)", "com.pubg.krmobile"),
        Edition("global", "العالمية", "com.tencent.ig"),
        Edition("bgmi", "BGMI", "com.pubg.imobile"),
        Edition("vn", "فيتنام", "com.vng.pubgmobile"),
        Edition("tw", "تايوان", "com.rekoo.pubgm"),
        Edition("lite", "Lite", "com.tencent.iglite"),
    )
    private val gamePackages = editions.map { it.pkg }.toSet()

    fun installed(ctx: Context): List<Edition> =
        editions.filter { ctx.packageManager.getLaunchIntentForPackage(it.pkg) != null }

    fun launch(ctx: Context, pkg: String): Boolean {
        val intent = ctx.packageManager.getLaunchIntentForPackage(pkg) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try { ctx.startActivity(intent); true } catch (e: Exception) { false }
    }

    // ---------- память ----------

    private fun memInfo(ctx: Context): ActivityManager.MemoryInfo {
        val am = ctx.getSystemService(ActivityManager::class.java)
        val mi = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        return mi
    }

    fun availMB(ctx: Context) = memInfo(ctx).availMem / 1_048_576.0
    fun totalMB(ctx: Context) = memInfo(ctx).totalMem / 1_048_576.0

    data class KillResult(val apps: Int, val beforeMB: Double, val afterMB: Double)

    /** Закрывает фоновые процессы всех сторонних приложений (кроме игры и себя). */
    suspend fun killBackground(ctx: Context): KillResult = withContext(Dispatchers.Default) {
        val before = availMB(ctx)
        val am = ctx.getSystemService(ActivityManager::class.java)
        val pm = ctx.packageManager
        @Suppress("DEPRECATION")
        val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
        val home = pm.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)
            ?.activityInfo?.packageName
        var n = 0
        for (a in apps) {
            val sys = (a.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            if (sys || a.packageName == ctx.packageName || a.packageName in gamePackages || a.packageName == home) continue
            try { am.killBackgroundProcesses(a.packageName); n++ } catch (_: Exception) {}
        }
        delay(900)
        KillResult(n, before, availMB(ctx))
    }

    // ---------- состояние телефона ----------

    fun thermal(ctx: Context): Int =
        if (Build.VERSION.SDK_INT >= 29) ctx.getSystemService(PowerManager::class.java).currentThermalStatus else 0

    fun thermalText(s: Int) = when {
        s <= PowerManager.THERMAL_STATUS_NONE -> "بارد"
        s == PowerManager.THERMAL_STATUS_LIGHT -> "دافئ"
        s == PowerManager.THERMAL_STATUS_MODERATE -> "ساخن"
        else -> "محموم"
    }

    fun powerSave(ctx: Context) = ctx.getSystemService(PowerManager::class.java).isPowerSaveMode

    fun battery(ctx: Context): Int =
        ctx.getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)

    fun charging(ctx: Context): Boolean = ctx.getSystemService(BatteryManager::class.java).isCharging

    fun network(ctx: Context): Pair<String, Boolean> {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "لا شبكة" to false
        val type = when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "واي فاي"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "خلوي"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
            else -> "أخرى"
        }
        val vpn = caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        return type to vpn
    }

    fun dataSaver(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        return cm.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
    }

    fun freeDiskGB(): Double {
        val st = StatFs(Environment.getDataDirectory().path)
        return st.availableBytes / 1e9
    }

    fun dndAllowed(ctx: Context) =
        ctx.getSystemService(NotificationManager::class.java).isNotificationPolicyAccessGranted

    // ---------- пинг ----------

    private suspend fun connectMs(host: String, timeout: Int = 2500): Double? = withContext(Dispatchers.IO) {
        try {
            Socket().use { s ->
                val t0 = System.nanoTime()
                s.connect(InetSocketAddress(host, 443), timeout)
                (System.nanoTime() - t0) / 1e6
            }
        } catch (e: Exception) { null }
    }

    suspend fun ping(host: String, samples: Int = 5): PingResult? {
        connectMs(host) // прогрев DNS
        val t = mutableListOf<Double>()
        repeat(samples) { connectMs(host)?.let { t += it } }
        if (t.isEmpty()) return null
        val jitter = if (t.size > 1) t.zipWithNext { a, b -> abs(a - b) }.average() else 0.0
        return PingResult(t.average(), jitter, samples - t.size)
    }

    // ---------- графика ----------

    /** Настройки PUBG без фризов под этот телефон. */
    fun recommended(ctx: Context, refreshHz: Float, hot: Boolean): Pair<String, String> {
        val ram = totalMB(ctx) / 1024
        // Высокие FPS в PUBG открываются только на «Плавной» — она же даёт меньше всего фризов
        return when {
            hot -> "Smooth" to "Extreme 60"
            refreshHz >= 119 && ram >= 8 -> "Smooth" to "120 FPS"
            refreshHz >= 89 && ram >= 6 -> "Smooth" to "90 FPS"
            ram >= 8 -> "Balanced" to "Extreme 60"
            else -> "Smooth" to "Extreme 60"
        }
    }
}
