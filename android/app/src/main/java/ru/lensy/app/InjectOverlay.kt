package ru.lensy.app

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * Плашка «حقن LENSY» поверх PUBG: 0…100% и «تم الحقن».
 * Шаги отражают то, что Lensy реально сделал перед запуском.
 */
object InjectOverlay {
    private const val RED = 0xFFCC1419.toInt()
    private const val INK = 0xFFE6E6E6.toInt()
    private const val ASH = 0xFF8A8A8A.toInt()

    fun canShow(ctx: Context) = Settings.canDrawOverlays(ctx)

    fun show(ctx: Context, game: String, freed: String?, gameMode: Boolean) {
        if (!canShow(ctx)) return
        val app = ctx.applicationContext
        val wm = app.getSystemService(WindowManager::class.java)
        val dp = app.resources.displayMetrics.density

        val title = TextView(app).apply {
            text = "حقن LENSY في $game"
            setTextColor(INK); textSize = 14f; typeface = Typeface.DEFAULT_BOLD
        }
        val pct = TextView(app).apply {
            text = "0%"; setTextColor(RED); textSize = 15f; typeface = Typeface.MONOSPACE
        }
        val head = LinearLayout(app).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(title, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(pct)
        }
        val bar = ProgressBar(app, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100; progress = 0
            progressTintList = ColorStateList.valueOf(RED)
            progressBackgroundTintList = ColorStateList.valueOf(0xFF262626.toInt())
        }
        val step = TextView(app).apply { text = "بدء الحقن"; setTextColor(ASH); textSize = 11f }

        val root = LinearLayout(app).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            val p = (14 * dp).toInt()
            setPadding(p, p, p, p)
            background = GradientDrawable().apply {
                setColor(0xF0000000.toInt())
                cornerRadius = 18 * dp
                setStroke((1 * dp).toInt(), RED)
            }
            addView(head)
            addView(bar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (8 * dp).toInt()).apply {
                topMargin = (8 * dp).toInt(); bottomMargin = (6 * dp).toInt()
            })
            addView(step)
            alpha = 0f
        }

        val lp = WindowManager.LayoutParams(
            (320 * dp).toInt(),
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = (18 * dp).toInt()
        }

        try { wm.addView(root, lp) } catch (e: Exception) { return }
        root.animate().alpha(1f).setDuration(250).start()

        val steps = listOf(
            8 to "ربط LENSY باللعبة",
            22 to (freed?.let { "تم تحرير $it" } ?: "تحرير الذاكرة"),
            45 to (if (gameMode) "واي فاي بلا توفير طاقة" else "تثبيت الشبكة"),
            65 to "مراقبة الحرارة",
            85 to "تهيئة الإطارات",
            100 to "جاهز للقتال",
        )
        val h = Handler(Looper.getMainLooper())
        var v = 0
        val tick = object : Runnable {
            override fun run() {
                v = (v + 2).coerceAtMost(100)
                bar.progress = v
                pct.text = "$v%"
                steps.firstOrNull { v <= it.first }?.let { step.text = it.second }
                if (v < 100) {
                    h.postDelayed(this, 55)
                } else {
                    title.text = "تم الحقن ✓"
                    pct.setTextColor(INK)
                    h.postDelayed({
                        root.animate().alpha(0f).setDuration(400).withEndAction {
                            try { wm.removeView(root) } catch (_: Exception) {}
                        }.start()
                    }, 2600)
                }
            }
        }
        h.postDelayed(tick, 400)
    }
}
