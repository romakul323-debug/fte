package ru.lensy.app

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

enum class LineState { OK, WARN, WORK, INFO }
data class Line(val id: Long, val title: String, val value: String, val state: LineState, val hint: String? = null)

enum class Action(val title: String) { RAM("ОЧИСТКА ОЗУ"), LAG("УБИРАЮ ЛАГИ"), FREEZE("АНТИ-ФРИЗ"), LAUNCH("ЗАЛЁТ") }
enum class Phase { IDLE, RUNNING, DONE, LAUNCHING }

class LensyModel(app: Application) : AndroidViewModel(app) {
    private val ctx: Context get() = getApplication()
    private val prefs = app.getSharedPreferences("lensy", Context.MODE_PRIVATE)

    var phase by mutableStateOf(Phase.IDLE); private set
    var action by mutableStateOf(Action.LAUNCH); private set
    var progress by mutableDoubleStateOf(0.0); private set
    val lines = mutableStateListOf<Line>()
    var note by mutableStateOf<String?>(null); private set

    var bestPing by mutableStateOf<Pair<String, Int>?>(null); private set
    var freed by mutableStateOf<String?>(null); private set
    var freezeHint by mutableStateOf<String?>(null); private set
    var refreshHz by mutableStateOf(60f)

    var editionId by mutableStateOf(prefs.getString("edition", "kr") ?: "kr")
        private set
    var autoLaunch by mutableStateOf(prefs.getBoolean("auto", false))
        private set
    var gameMode by mutableStateOf(prefs.getBoolean("gamemode", true))
        private set
    var dnd by mutableStateOf(prefs.getBoolean("dnd", false))
        private set

    fun setEdition(id: String) { editionId = id; prefs.edit().putString("edition", id).apply() }
    fun setAuto(v: Boolean) { autoLaunch = v; prefs.edit().putBoolean("auto", v).apply() }
    fun changeGameMode(v: Boolean) { gameMode = v; prefs.edit().putBoolean("gamemode", v).apply() }
    fun changeDnd(v: Boolean) { dnd = v; prefs.edit().putBoolean("dnd", v).apply() }

    /** Выбранная версия; если её нет на телефоне — первая установленная. */
    val edition: Edition
        get() {
            val inst = Engine.installed(ctx)
            return inst.firstOrNull { it.id == editionId } ?: inst.firstOrNull()
                ?: Engine.editions.first { it.id == editionId }
        }

    private var job: Job? = null
    private var seq = 0L
    private var entered = false

    fun onEnter() {
        if (entered) return
        entered = true
        if (autoLaunch) run(Action.LAUNCH)
    }

    fun cancel() { job?.cancel(); phase = Phase.IDLE }

    fun run(a: Action) {
        job?.cancel()
        action = a
        lines.clear()
        progress = 0.0
        note = null
        phase = Phase.RUNNING
        job = viewModelScope.launch {
            when (a) {
                Action.RAM -> ram(0.0, 1.0)
                Action.LAG -> lag()
                Action.FREEZE -> freeze()
                Action.LAUNCH -> {
                    quick()
                    ram(0.3, 0.8)
                    if (gameMode) {
                        add(0.9, Line(0, "Игровой режим", "включён", LineState.OK,
                            "Wi‑Fi без энергосбережения" + if (dnd && Engine.dndAllowed(ctx)) " · не беспокоить" else ""))
                        GameModeService.start(ctx, dnd)
                    }
                }
            }
            add(1.0, Line(0, "Готово", "", LineState.INFO))
            phase = Phase.DONE
            if (a == Action.LAUNCH) {
                delay(600)
                launchGame()
            }
        }
    }

    fun launchGame() {
        phase = Phase.LAUNCHING
        val e = edition
        val ok = Engine.launch(ctx, e.pkg)
        viewModelScope.launch {
            if (!ok) {
                note = "PUBG ${e.name} не найдена на телефоне. Выбери версию в настройках."
                phase = Phase.DONE
            } else {
                delay(1500)
                if (phase == Phase.LAUNCHING) phase = Phase.IDLE
            }
        }
    }

    // ---------- шаги ----------

    private suspend fun quick() {
        val t = Engine.thermal(ctx)
        add(0.1, Line(0, "Нагрев", Engine.thermalText(t), if (t >= 3) LineState.WARN else LineState.OK,
            if (t >= 3) "Дай телефону остыть — иначе фризы" else null))
        if (Engine.powerSave(ctx)) add(0.2, Line(0, "Энергосбережение", "включено", LineState.WARN, "Выключи — оно режет FPS"))
    }

    private suspend fun ram(p0: Double, p1: Double) {
        val before = Engine.availMB(ctx)
        add(p0 + (p1 - p0) * 0.2, Line(0, "Свободно сейчас", gb(before), LineState.INFO))
        val i = add(p0 + (p1 - p0) * 0.35, Line(0, "Закрываю фоновые", "…", LineState.WORK))
        val r = Engine.killBackground(ctx)
        val gained = (r.afterMB - r.beforeMB).coerceAtLeast(0.0)
        freed = if (gained > 30) "+${gained.toInt()} МБ" else "чисто"
        replace(i, Line(0, "Закрываю фоновые", "${r.apps} прил.", LineState.OK))
        add(p0 + (p1 - p0) * 0.75, Line(0, "Освобождено", if (gained > 30) "+${gained.toInt()} МБ" else "уже чисто", LineState.OK))
        add(p1, Line(0, "Свободно для игры", gb(r.afterMB), LineState.OK))
    }

    private suspend fun lag() {
        val (net, vpn) = Engine.network(ctx)
        add(0.08, Line(0, "Сеть", net, if (net == "нет сети") LineState.WARN else LineState.OK,
            when { net == "Сотовая" -> "Wi‑Fi обычно стабильнее сотовой"; vpn -> "VPN добавляет пинг — выключи"; else -> null }))
        if (Engine.dataSaver(ctx)) add(0.12, Line(0, "Экономия трафика", "включена", LineState.WARN, "Выключи — режет сеть в фоне"))
        val regions = listOf(
            "Корея" to "ec2.ap-northeast-2.amazonaws.com",
            "Япония" to "ec2.ap-northeast-1.amazonaws.com",
            "Москва" to "ya.ru",
            "Европа" to "ec2.eu-central-1.amazonaws.com",
            "Ближ. Восток" to "ec2.me-south-1.amazonaws.com",
        )
        val idx = regions.mapIndexed { k, r -> add(0.16 + 0.05 * k, Line(0, r.first, "…", LineState.WORK)) }
        val results = regions.mapIndexed { k, r ->
            viewModelScope.async {
                val res = Engine.ping(r.second)
                if (res != null) {
                    val ms = res.avg.toInt()
                    replace(idx[k], Line(0, r.first, "$ms мс · ±${res.jitter.toInt()}",
                        if (ms > 150 || res.jitter > 25) LineState.WARN else LineState.OK))
                } else replace(idx[k], Line(0, r.first, "нет ответа", LineState.WARN))
                res?.let { r.first to it }
            }
        }.awaitAll().filterNotNull()
        bump(0.8)
        results.minByOrNull { it.second.avg }?.let { best ->
            bestPing = best.first to best.second.avg.toInt()
            add(0.9, Line(0, "Лучший сервер", best.first, LineState.OK,
                if (best.second.jitter > 20) "Пинг скачет: ближе к роутеру, без VPN и загрузок" else "Выбери этот регион в лобби PUBG"))
        }
    }

    private suspend fun freeze() {
        val t = Engine.thermal(ctx)
        val hot = t >= 2
        add(0.15, Line(0, "Нагрев", Engine.thermalText(t), if (hot) LineState.WARN else LineState.OK,
            if (hot) "Сними чехол, не играй на зарядке — горячий телефон сбрасывает частоту" else null))
        val ps = Engine.powerSave(ctx)
        add(0.3, Line(0, "Энергосбережение", if (ps) "включено" else "выключено", if (ps) LineState.WARN else LineState.OK,
            if (ps) "Выключи — режет процессор и FPS" else null))
        add(0.45, Line(0, "Экран", "${refreshHz.toInt()} Гц", LineState.OK,
            if (refreshHz < 89) null else "В настройках дисплея поставь максимальную частоту"))
        val disk = Engine.freeDiskGB()
        add(0.6, Line(0, "Память диска", "%.0f ГБ своб.".format(disk), if (disk < 4) LineState.WARN else LineState.OK,
            if (disk < 4) "Меньше 4 ГБ — текстуры подгружаются рывками" else null))
        val (g, f) = Engine.recommended(ctx, refreshHz, hot)
        freezeHint = "$g · $f"
        add(0.8, Line(0, "Графика в PUBG", g, LineState.OK))
        add(0.9, Line(0, "Частота кадров", f, LineState.OK, "Тени и сглаживание — выкл. Выше — нагрев и фризы"))
    }

    // ---------- строки ----------

    private suspend fun add(p: Double, line: Line): Int {
        delay(280)
        lines.add(line.copy(id = ++seq))
        progress = maxOf(progress, p)
        return lines.size - 1
    }

    private fun replace(i: Int, line: Line) {
        if (i in lines.indices) lines[i] = line.copy(id = ++seq)
    }

    private fun bump(p: Double) { progress = maxOf(progress, p) }

    companion object {
        fun gb(mb: Double) = "%.1f ГБ".format(mb / 1024)
    }
}
