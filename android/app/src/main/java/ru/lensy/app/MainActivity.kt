package ru.lensy.app

import android.Manifest
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.graphics.drawscope.clipPath
import android.net.Uri
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

// ---------- палитра ----------

object C {
    val ink = Color(0xFFE0E0E0)
    val ash = Color(0xFF7A7A7A)
    val faint = Color(0xFF292929)
    val blood = Color(0xFF8C050A)
    val bloodLight = Color(0xFFCC1419)
}

fun serif(size: TextUnit, w: FontWeight = FontWeight.Light, italic: Boolean = false) =
    TextStyle(fontFamily = FontFamily.Serif, fontSize = size, fontWeight = w,
        fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal)

fun mono(size: TextUnit, w: FontWeight = FontWeight.Normal, spacing: TextUnit = 0.sp) =
    TextStyle(fontFamily = FontFamily.Monospace, fontSize = size, fontWeight = w, letterSpacing = spacing)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) { App(this) }
        }
    }
}

enum class Screen { MAIN, SETTINGS, DNS }

@Composable
fun App(activity: ComponentActivity) {
    val vm: LensyModel = viewModel()
    var entered by remember { mutableStateOf(false) }
    var screen by remember { mutableStateOf(Screen.MAIN) }

    LaunchedEffect(Unit) {
        @Suppress("DEPRECATION")
        vm.refreshHz = activity.windowManager.defaultDisplay.refreshRate
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Darkness()
        Crossfade(targetState = entered, label = "gate") { inside ->
            if (!inside) KillGate { entered = true; vm.onEnter() }
            else when (screen) {
                Screen.MAIN -> MainScreen(vm, onSettings = { screen = Screen.SETTINGS }, onDns = { screen = Screen.DNS })
                Screen.SETTINGS -> SettingsScreen(vm) { screen = Screen.MAIN }
                Screen.DNS -> DnsScreen { screen = Screen.MAIN }
            }
        }
        AnimatedVisibility(vm.phase != Phase.IDLE, enter = fadeIn(), exit = fadeOut()) {
            ActionOverlay(vm)
        }
    }
    BackHandler(enabled = screen != Screen.MAIN || vm.phase != Phase.IDLE) {
        if (vm.phase != Phase.IDLE) vm.cancel() else screen = Screen.MAIN
    }
}

// ---------- фон: чернота, зерно, туман ----------

@Composable
fun Darkness(fog: Float = 1f) {
    var t by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        while (true) { delay(83); t += 0.083f }
    }
    Canvas(Modifier.fillMaxSize()) {
        val b = (0.5f - 0.5f * cos(t * 2 * PI.toFloat() / 6f))
        drawRect(
            Brush.radialGradient(
                listOf(Color.White.copy(alpha = (0.07f + 0.04f * b) * fog), Color.Transparent),
                center = Offset(size.width * (0.5f + 0.08f * sin(t / 9f)), size.height * 0.4f),
                radius = size.minDimension * 0.95f
            )
        )
        drawRect(
            Brush.radialGradient(
                listOf(C.blood.copy(alpha = 0.12f * fog * b), Color.Transparent),
                center = Offset(size.width / 2, size.height), radius = size.maxDimension * 0.5f
            )
        )
        val rnd = Random((t * 12).toInt())
        repeat(900) {
            drawRect(
                Color.White.copy(alpha = rnd.nextFloat() * 0.09f),
                topLeft = Offset(rnd.nextFloat() * size.width, rnd.nextFloat() * size.height),
                size = Size(2f, 2f)
            )
        }
        drawRect(
            Brush.radialGradient(
                listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f)),
                center = center, radius = size.maxDimension * (0.62f + 0.03f * b)
            )
        )
        // полосы старого монитора
        var y = 0f
        while (y < size.height) { drawRect(Color.White.copy(alpha = 0.022f), Offset(0f, y), Size(size.width, 1.5f)); y += 6f }
        val band = (t * 120f) % (size.height + 200f) - 100f
        drawRect(Brush.verticalGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.03f), Color.Transparent), band, band + 120f),
            Offset(0f, band), Size(size.width, 120f))
        // мигание умирающей лампы
        val cyc = t % 9.7f
        if ((cyc > 3f && cyc < 3.09f) || (cyc > 3.17f && cyc < 3.24f)) drawRect(Color.Black.copy(alpha = 0.55f))
    }
}

/** Глаз во тьме: медленно открывается, водит зрачком и закрывается. */
@Composable
fun DarkEye(modifier: Modifier, period: Float = 11f) {
    var t by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) { while (true) { delay(33); t += 0.033f } }
    Canvas(modifier) {
        val cyc = t % period
        val open = when { cyc < 1.4f -> cyc / 1.4f; cyc < 4.5f -> 1f; cyc < 5.1f -> 1f - (cyc - 4.5f) / 0.6f; else -> 0f }
        val look = sin(t * 0.9f) * 0.4f
        val c = center
        val ew = size.width * 0.46f
        val eh = size.height * 0.5f * open
        val lid = Path().apply {
            moveTo(c.x - ew, c.y)
            quadraticTo(c.x, c.y - eh * 2, c.x + ew, c.y)
            quadraticTo(c.x, c.y + eh * 2, c.x - ew, c.y)
            close()
        }
        drawCircle(Brush.radialGradient(listOf(C.blood.copy(alpha = 0.35f * open), Color.Transparent), c, ew), ew, c)
        drawPath(lid, C.bloodLight.copy(alpha = 0.15f + 0.6f * open), style = Stroke(2f))
        if (open > 0.02f) clipPath(lid) {
            val r = size.height * 0.42f
            val ic = Offset(c.x + look * ew * 0.6f, c.y)
            drawCircle(Brush.radialGradient(listOf(Color(0xFFFF5A33), C.bloodLight, C.blood), ic, r), r, ic)
            val slit = Path().apply {
                moveTo(ic.x, ic.y - r * 0.9f)
                quadraticTo(ic.x + r * 0.22f, ic.y, ic.x, ic.y + r * 0.9f)
                quadraticTo(ic.x - r * 0.22f, ic.y, ic.x, ic.y - r * 0.9f)
                close()
            }
            drawPath(slit, Color.Black)
        }
    }
}

@Composable
fun GlitchTitle(text: String, size: TextUnit, spacing: TextUnit, color: Color = C.ink) {
    var on by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(7000); on = true; delay(130); on = false; delay(90); on = true; delay(60); on = false
        }
    }
    Box {
        if (on) Text(text, style = serif(size, FontWeight.ExtraLight).copy(letterSpacing = spacing),
            color = C.bloodLight.copy(alpha = 0.7f), modifier = Modifier.offset(3.dp, (-1).dp))
        Text(text, style = serif(size, FontWeight.ExtraLight).copy(letterSpacing = spacing),
            color = color.copy(alpha = if (on) 0.75f else 1f), modifier = Modifier.offset(if (on) (-2).dp else 0.dp, 0.dp))
    }
}

@Composable
fun Whisper() {
    val lines = listOf(
        "الصمت قبل الطلقة الأولى", "أحدهم مختبئ في العشب", "المنطقة تضيق",
        "لست وحدك في هذه الجولة", "لا تحدّق في الشجيرات طويلاً", "الدائرة الأخيرة دائماً أهدأ", "هو يراك الآن"
    )
    var i by remember { mutableIntStateOf(0) }
    var a by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        while (true) {
            for (k in 0..35) { a = sin(k / 35f * PI.toFloat()) * 0.5f; delay(200) }
            i = (i + 1) % lines.size
        }
    }
    Text(lines[i], style = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Light), color = C.ash.copy(alpha = a))
}

// ---------- вход: «Убить телефон» ----------

@Composable
fun KillGate(onEnter: () -> Unit) {
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var shake by remember { mutableFloatStateOf(0f) }
    var flash by remember { mutableFloatStateOf(0f) }
    var cracks by remember { mutableStateOf(false) }
    var killing by remember { mutableStateOf(false) }
    var dead by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.offset(x = shake.dp).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(22.dp)
        ) {
            DarkEye(Modifier.size(220.dp, 80.dp), period = 6f)
            GlitchTitle("LENSY", 34.sp, 14.sp)
            Text("تحذير", style = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Bold), color = C.bloodLight)
            Text("هذا الزر سيدمّر\nهاتفك", style = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Light), color = C.ink.copy(alpha = 0.85f),
                textAlign = TextAlign.Center)
            Column(
                Modifier
                    .size(260.dp, 120.dp)
                    .background(Brush.verticalGradient(listOf(C.blood.copy(alpha = 0.4f), Color.Black)), RoundedCornerShape(18.dp))
                    .border(1.dp, C.bloodLight.copy(alpha = 0.7f), RoundedCornerShape(18.dp))
                    .clickable(enabled = !killing) {
                        killing = true
                        scope.launch {
                            repeat(6) { k ->
                                view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                                shake = if (k % 2 == 0) 16f else -16f
                                delay(60)
                            }
                            shake = 0f
                            cracks = true
                            flash = 0.55f
                            view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                            repeat(10) { flash *= 0.7f; delay(40) }
                            flash = 0f
                            delay(500)
                            dead = true
                            view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                            delay(1400)
                            onEnter()
                        }
                    },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("⚡", style = serif(28.sp), color = C.bloodLight)
                Spacer(Modifier.height(6.dp))
                Text("اقتل الهاتف", style = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Black), color = C.ink)
            }
            Text("لا تضغط", style = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Light), color = C.ash.copy(alpha = 0.6f))
        }
        if (cracks) Cracks()
        if (flash > 0f) Box(Modifier.fillMaxSize().background(C.bloodLight.copy(alpha = flash)))
        if (dead) Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            Darkness(0.3f)
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                GlitchTitle("تم تدمير الهاتف", 26.sp, 0.sp, C.bloodLight)
                Text("مزحة 😈", style = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Light), color = C.ink)
            }
        }
    }
}

@Composable
fun Cracks() {
    Canvas(Modifier.fillMaxSize()) {
        val rnd = Random(666)
        val c = Offset(size.width * 0.52f, size.height * 0.47f)
        repeat(16) {
            val path = Path().apply { moveTo(c.x, c.y) }
            var p = c
            val ang = rnd.nextFloat() * 2 * PI.toFloat()
            repeat(8) {
                val a = ang + (rnd.nextFloat() - 0.5f) * 0.6f
                val len = 40f + rnd.nextFloat() * 90f
                p = Offset(p.x + cos(a) * len, p.y + sin(a) * len)
                path.lineTo(p.x, p.y)
            }
            drawPath(path, Color.White.copy(alpha = 0.75f), style = Stroke(width = 2f))
        }
        drawCircle(Color.White.copy(alpha = 0.6f), radius = 10f, center = c)
    }
}

// ---------- главный экран ----------

@Composable
fun MainScreen(vm: LensyModel, onSettings: () -> Unit, onDns: () -> Unit) {
    val ctx = LocalContext.current
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(3000); tick++ } }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // шапка
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                GlitchTitle("LENSY", 30.sp, 11.sp)
                Text("تحسين الرؤية", style = serif(12.sp), color = C.bloodLight)
                Text("${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL} · ${vm.refreshHz.toInt()} Hz",
                    style = mono(10.sp), color = C.ash, modifier = Modifier.padding(top = 2.dp))
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("⚙", style = serif(22.sp), color = C.ash, modifier = Modifier.clickable { onSettings() }.padding(6.dp))
                Text("PUBG ${vm.edition.id.uppercase()}", style = mono(10.sp, FontWeight.Bold, 2.sp), color = C.ink,
                    modifier = Modifier.border(1.dp, C.blood, CircleShape).padding(horizontal = 10.dp, vertical = 5.dp))
            }
        }

        DarkEye(Modifier.fillMaxWidth().height(56.dp))

        // индикаторы
        key(tick) {
            val t = Engine.thermal(ctx)
            val free = Engine.availMB(ctx)
            val total = Engine.totalMB(ctx)
            val bat = Engine.battery(ctx)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Gauge(Modifier.weight(1f), "الحرارة", Engine.thermalText(t), (t + 1) / 5f, t >= 3)
                Gauge(Modifier.weight(1f), "الذاكرة", LensyModel.gb(free), (free / total).toFloat(), free < 700)
                Gauge(Modifier.weight(1f), "البينغ", vm.bestPing?.second?.toString() ?: "—",
                    ((vm.bestPing?.second ?: 0) / 200f).coerceAtMost(1f), (vm.bestPing?.second ?: 0) > 120)
                Gauge(Modifier.weight(1f), "البطارية", "$bat%", bat / 100f, bat < 20 && !Engine.charging(ctx))
            }
        }

        // плитки
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Tile(Modifier.weight(1f), "▦", "تنظيف الذاكرة", vm.freed ?: "إغلاق الخلفية") { vm.run(Action.RAM) }
            Tile(Modifier.weight(1f), "〰", "إزالة اللاغ", vm.bestPing?.let { "${it.second} ms · ${it.first}" } ?: "البينغ والسيرفر") { vm.run(Action.LAG) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Tile(Modifier.weight(1f), "❄", "منع التقطيع", vm.freezeHint ?: "الحرارة والرسومات") { vm.run(Action.FREEZE) }
            Tile(Modifier.weight(1f), "◈", "LENSY DNS", "1.1.1.1 · مشفّر") { onDns() }
        }

        LaunchButton(vm)

        Box(Modifier.fillMaxWidth().padding(top = 4.dp), contentAlignment = Alignment.Center) { Whisper() }
    }
}

@Composable
fun Gauge(modifier: Modifier, label: String, value: String, level: Float, hot: Boolean) {
    Column(
        modifier.background(Color(0xFF0A0A0A), RoundedCornerShape(16.dp)).border(1.dp, C.faint, RoundedCornerShape(16.dp))
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(Modifier.size(62.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                drawArc(C.faint, 0f, 360f, false, style = Stroke(6f))
                drawArc(if (hot) C.bloodLight else C.ink.copy(alpha = 0.8f), -90f, 360f * level.coerceIn(0.02f, 1f), false,
                    style = Stroke(6f, cap = StrokeCap.Round))
            }
            Text(value, style = mono(10.sp, FontWeight.Medium), color = if (hot) C.bloodLight else C.ink,
                maxLines = 1, overflow = TextOverflow.Clip, modifier = Modifier.padding(horizontal = 6.dp))
        }
        Spacer(Modifier.height(8.dp))
        Text(label, style = TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Medium), color = C.ash)
    }
}

@Composable
fun Tile(modifier: Modifier, icon: String, title: String, result: String, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val view = LocalView.current
    Column(
        modifier
            .scale(if (pressed) 0.97f else 1f)
            .heightIn(min = 112.dp)
            .background(Brush.linearGradient(listOf(Color(0xFF121212), Color(0xFF050505))), RoundedCornerShape(18.dp))
            .border(1.dp, Brush.linearGradient(listOf(Color(0xFF383838), C.faint, C.blood.copy(alpha = 0.5f))), RoundedCornerShape(18.dp))
            .clickable(interactionSource = src, indication = null) {
                view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); onClick()
            }
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(Modifier.fillMaxWidth()) {
            Text(icon, style = serif(22.sp), color = C.bloodLight)
            Spacer(Modifier.weight(1f))
            Text("↖", style = serif(12.sp), color = C.ash)
        }
        Text(title, style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Bold), color = C.ink, maxLines = 1)
        Text(result, style = mono(10.sp), color = C.ash, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun LaunchButton(vm: LensyModel) {
    var t by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) { while (true) { delay(33); t += 0.033f } }
    val b = 0.5f - 0.5f * cos(t * 2 * PI.toFloat() / 3.5f)
    Row(
        Modifier.fillMaxWidth()
            .background(Brush.horizontalGradient(listOf(C.blood.copy(alpha = 0.28f + 0.15f * b), Color(0xFF080808))), RoundedCornerShape(18.dp))
            .border(1.dp, C.bloodLight.copy(alpha = 0.4f + 0.4f * b), RoundedCornerShape(18.dp))
            .clickable { vm.run(Action.LAUNCH) }
            .padding(20.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("💉", style = serif(22.sp), color = C.ink)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text("اقتحام PUBG", style = TextStyle(fontSize = 21.sp, fontWeight = FontWeight.Black), color = C.ink)
            Text("تنظيف · حقن · ${vm.edition.name}", style = TextStyle(fontSize = 11.sp), color = C.ash)
        }
        Text("‹", style = serif(26.sp), color = C.ink)
    }
}

// ---------- экран действия ----------

@Composable
fun ActionOverlay(vm: LensyModel) {
    Box(Modifier.fillMaxSize().background(Color.Black).clickable(enabled = false) {}) {
        Darkness(0.6f)
        Column(
            Modifier.fillMaxSize().systemBarsPadding().padding(top = 36.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(Modifier.size(160.dp), contentAlignment = Alignment.Center) {
                Canvas(Modifier.fillMaxSize()) {
                    drawArc(C.faint, 0f, 360f, false, style = Stroke(3f))
                    drawArc(Brush.verticalGradient(listOf(C.ink, C.bloodLight)), -90f, 360f * vm.progress.toFloat(), false,
                        style = Stroke(5f, cap = StrokeCap.Round))
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("${(vm.progress * 100).toInt()}", style = serif(44.sp, FontWeight.ExtraLight), color = C.ink)
                    Text(
                        when (vm.phase) { Phase.RUNNING -> "جارٍ العمل"; Phase.DONE -> "تم"; Phase.LAUNCHING -> "تشغيل PUBG"; else -> "" },
                        style = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium), color = C.ash
                    )
                }
            }
            Spacer(Modifier.height(18.dp))
            Text(vm.action.title, style = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Black), color = C.ink)
            Spacer(Modifier.height(10.dp))
            LazyColumn(Modifier.weight(1f).padding(horizontal = 24.dp)) {
                items(vm.lines, key = { it.id }) { LineRow(it) }
            }
            vm.note?.let {
                Text(it, style = TextStyle(fontSize = 13.sp), color = C.ash, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 30.dp, vertical = 8.dp))
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                TextBtn(Modifier.weight(1f), if (vm.phase == Phase.DONE) "تم" else "إلغاء", C.ash) { vm.cancel() }
                if (vm.phase == Phase.DONE && vm.action != Action.LAUNCH) {
                    Box(Modifier.width(1.dp).height(16.dp).background(C.faint))
                    TextBtn(Modifier.weight(1f), "اقتحام", C.bloodLight) { vm.run(Action.LAUNCH) }
                }
            }
        }
    }
}

@Composable
fun LineRow(l: Line) {
    Column(Modifier.padding(vertical = 7.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                when (l.state) { LineState.WORK -> "…"; LineState.OK -> "✓"; LineState.INFO -> "—"; LineState.WARN -> "!" },
                style = mono(13.sp, FontWeight.Bold),
                color = if (l.state == LineState.WARN) C.bloodLight else C.ash,
                modifier = Modifier.width(22.dp)
            )
            Text(l.title, style = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium), color = C.ash, modifier = Modifier.weight(1f))
            Text(l.value, style = mono(13.sp, FontWeight.Medium), color = if (l.state == LineState.WARN) C.bloodLight else C.ink,
                maxLines = 1)
        }
        l.hint?.let {
            Text(it, style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Light), color = C.ash.copy(alpha = 0.85f), modifier = Modifier.padding(start = 22.dp, top = 2.dp))
        }
    }
}

@Composable
fun TextBtn(modifier: Modifier, title: String, color: Color, onClick: () -> Unit) {
    Box(modifier.clickable { onClick() }.padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
        Text(title, style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Bold), color = color)
    }
}

// ---------- настройки ----------

@Composable
fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Color(0xFF0A0A0A), RoundedCornerShape(14.dp))
            .border(1.dp, C.faint, RoundedCornerShape(14.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp), content = content
    )
}

@Composable
fun SubScreen(title: String, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.ExtraLight), color = C.ink, modifier = Modifier.weight(1f))
            Text("✕", style = serif(18.sp), color = C.ash, modifier = Modifier.clickable { onClose() }.padding(8.dp))
        }
        content()
    }
}

@Composable
fun SettingsScreen(vm: LensyModel, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val installed = remember { Engine.installed(ctx).map { it.id }.toSet() }
    var dndGranted by remember { mutableStateOf(Engine.dndAllowed(ctx)) }
    var overlayOk by remember { mutableStateOf(InjectOverlay.canShow(ctx)) }
    LaunchedEffect(Unit) { while (true) { delay(1000); dndGranted = Engine.dndAllowed(ctx); overlayOk = InjectOverlay.canShow(ctx) } }

    SubScreen("الإعدادات", onClose) {
        Panel {
            Text("إصدار PUBG", style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium), color = C.ash)
            Engine.editions.forEach { e ->
                Row(Modifier.fillMaxWidth().clickable { vm.setEdition(e.id) }.padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(12.dp).border(1.dp, C.ash, CircleShape)
                        .background(if (vm.editionId == e.id) C.bloodLight else Color.Transparent, CircleShape))
                    Spacer(Modifier.width(12.dp))
                    Text(e.name, style = TextStyle(fontSize = 17.sp), color = C.ink, modifier = Modifier.weight(1f))
                    Text(if (e.id in installed) "مثبّتة" else "", style = TextStyle(fontSize = 11.sp), color = C.ash)
                }
            }
        }
        Panel {
            Toggle("اقتحام تلقائي", "بعد الدخول ينظّف الهاتف ويشغّل PUBG فوراً", vm.autoLaunch) { vm.setAuto(it) }
            Box(Modifier.fillMaxWidth().height(1.dp).background(C.faint))
            Toggle("الحقن فوق PUBG", if (overlayOk) "شريط «حقن LENSY» فوق اللعبة 0…100%" else "يحتاج إذن «الظهور فوق التطبيقات» — اضغط", vm.inject && overlayOk) {
                if (it && !InjectOverlay.canShow(ctx)) {
                    ctx.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                vm.changeInject(it)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(C.faint))
            Toggle("وضع اللعب", "أثناء اللعب: واي فاي بلا توفير طاقة وتنبيه عند السخونة", vm.gameMode) {
                vm.changeGameMode(it)
                if (it && Build.VERSION.SDK_INT >= 33) (ctx as? ComponentActivity)?.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(C.faint))
            Toggle("عدم الإزعاج في اللعب", if (dndGranted) "لن تظهر الإشعارات وسط القتال" else "يحتاج إذناً — اضغط لفتح الإعدادات", vm.dnd) {
                if (it && !Engine.dndAllowed(ctx)) {
                    ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                vm.changeDnd(it)
            }
            if (GameModeService.running) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(C.faint))
                TextBtn(Modifier.fillMaxWidth(), "إيقاف وضع اللعب", C.bloodLight) { GameModeService.stop(ctx) }
            }
        }
        Text("تنظيف الذاكرة يغلق عمليات الخلفية لتطبيقات الطرف الثالث. تطبيقات النظام والواجهة واللعبة نفسها لا تُمس.",
            style = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Light), color = C.ash)
    }
}

@Composable
fun Toggle(title: String, sub: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = TextStyle(fontSize = 17.sp), color = C.ink)
            Text(sub, style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Light), color = C.ash)
        }
        Switch(
            checked = value, onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = C.blood, checkedThumbColor = C.ink,
                uncheckedTrackColor = Color(0xFF1A1A1A), uncheckedThumbColor = C.ash, uncheckedBorderColor = C.faint)
        )
    }
}

// ---------- DNS ----------

@Composable
fun DnsScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    SubScreen("DNS", onClose) {
        Text("Lensy · تحسين الرؤية", style = TextStyle(fontSize = 16.sp), color = C.bloodLight)
        Text("DNS مشفّر 1.1.1.1 من Cloudflare. عناوين سيرفرات اللعبة تُحلّ أسرع وأكثر استقراراً، ومزوّد الإنترنت لا يتلاعب بالردود.",
            style = TextStyle(fontSize = 15.sp), color = C.ink.copy(alpha = 0.85f))
        Text("لا يؤثر DNS على البينغ أثناء القتال ولا على الضربات في الرأس — يعمل فقط لحظة البحث عن السيرفر.",
            style = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Light), color = C.ash)
        Panel {
            Step(1, "اضغط «نسخ العنوان».")
            Step(2, "اضغط «فتح الإعدادات» ← «DNS خاص» (قد يكون في «الاتصالات» ← «إعدادات أخرى»).")
            Step(3, "اختر «اسم مضيف مزوّد DNS»، الصق العنوان واحفظ.")
        }
        Text("one.one.one.one", style = mono(18.sp, FontWeight.Bold, 2.sp), color = C.ink,
            modifier = Modifier.fillMaxWidth().border(1.dp, C.faint, RoundedCornerShape(12.dp)).padding(14.dp), textAlign = TextAlign.Center)
        TextBtn(Modifier.fillMaxWidth().border(1.dp, C.blood, RoundedCornerShape(14.dp)), if (copied) "تم النسخ" else "نسخ العنوان", C.ink) {
            ctx.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("dns", "one.one.one.one"))
            copied = true
        }
        TextBtn(Modifier.fillMaxWidth(), "فتح الإعدادات", C.ash) {
            ctx.startActivity(Intent(Settings.ACTION_WIRELESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

@Composable
fun Step(n: Int, text: String) {
    Row {
        Text("$n", style = mono(12.sp, FontWeight.Bold), color = C.bloodLight, modifier = Modifier.width(20.dp))
        Text(text, style = TextStyle(fontSize = 14.sp), color = C.ink.copy(alpha = 0.85f))
    }
}
