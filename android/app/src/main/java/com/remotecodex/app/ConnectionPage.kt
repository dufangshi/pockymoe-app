package com.remotecodex.app

import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.*
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.doAfterTextChanged

/** Native only because the remote page is unavailable. Classic colors, system mode/language. */
internal class ConnectionPage(
    private val activity: android.content.Context,
    offline: Boolean,
    address: String,
    relayAddress: String,
    notice: String,
    connect: (String, String) -> Unit,
    retry: () -> Unit,
    change: () -> Unit,
) {
    private val density = activity.resources.displayMetrics.density

    private fun dp(value: Int) = (value * density + .5f).toInt()

    private val dark =
        activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
            Configuration.UI_MODE_NIGHT_YES
    val background = Color.parseColor(if (dark) "#17171A" else "#FAFAF8")
    private val foreground = Color.parseColor(if (dark) "#F4F7F6" else "#121416")
    private val muted = Color.parseColor(if (dark) "#A2AFB9" else "#5B6269")
    private val border = Color.parseColor(if (dark) "#36434D" else "#CCD2CD")
    private val accent = Color.parseColor(if (dark) "#00CC76" else "#008B53")
    private val accentText = Color.parseColor(if (dark) "#082016" else "#FAFAF8")
    private val danger = Color.parseColor(if (dark) "#EF6A75" else "#C53644")
    val view =
        ScrollView(activity).apply {
            tag = if (offline) "offline" else "connect"
            isFillViewport = true
            setBackgroundColor(this@ConnectionPage.background)
            clipToPadding = false
        }
    private val stage = FrameLayout(activity)
    private val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private lateinit var primary: Button
    private lateinit var spinner: ProgressBar
    private var input: EditText? = null
    private var busy = false
    private val primaryLabel =
        text(if (offline) "重试" else "连接", if (offline) "Retry" else "Connect")

    private fun text(zh: String, en: String) =
        if (activity.resources.configuration.locales[0].language == "zh") zh else en

    private fun shape(fill: Int, stroke: Int? = null) =
        GradientDrawable().apply {
            setColor(fill)
            cornerRadius = dp(12).toFloat()
            stroke?.let { setStroke(dp(1), it) }
        }

    private fun row(child: View, height: Int, top: Int = 0) {
        content.addView(
            child,
            LinearLayout.LayoutParams(-1, if (height < 0) height else dp(height)).apply {
                topMargin = dp(top)
            },
        )
    }

    private fun label(value: String, size: Float, color: Int) =
        TextView(activity).apply {
            text = value
            textSize = size
            setTextColor(color)
            gravity = Gravity.CENTER
            includeFontPadding = false
        }

    private fun field(description: String, value: String, placeholder: String) =
        EditText(activity).apply {
            contentDescription = description
            setText(value)
            hint = placeholder
            textSize = 16f
            setSingleLine(true)
            setTextColor(this@ConnectionPage.foreground)
            setHintTextColor(muted)
            setPadding(dp(14), 0, dp(14), 0)
            gravity = Gravity.CENTER_VERTICAL
            inputType =
                InputType.TYPE_CLASS_TEXT or
                    InputType.TYPE_TEXT_VARIATION_URI or
                    InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = EditorInfo.IME_ACTION_GO
            background = shape(Color.TRANSPARENT, border)
            setOnFocusChangeListener { _, focus ->
                background = shape(Color.TRANSPARENT, if (focus) accent else border)
            }
            setOnEditorActionListener { _, action, _ ->
                if (action == EditorInfo.IME_ACTION_GO) {
                    if (primary.isEnabled) primary.performClick()
                    true
                } else false
            }
        }

    private fun quiet(value: String, action: () -> Unit) =
        Button(activity).apply {
            text = value
            contentDescription = value
            textSize = 14f
            isAllCaps = false
            setTextColor(muted)
            background = null
            minimumHeight = 0
            minHeight = 0
            setPadding(0, 0, 0, 0)
            setOnClickListener { action() }
        }

    init {
        view.addView(stage, FrameLayout.LayoutParams(-1, -1))
        stage.addView(
            content,
            FrameLayout.LayoutParams(-1, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL),
        )
        stage.addOnLayoutChangeListener { _, _, _, right, bottom, _, _, _, _ ->
            val width = minOf(dp(420), right - dp(48))
            val params = content.layoutParams as FrameLayout.LayoutParams
            val top = maxOf(dp(24), ((bottom - content.measuredHeight) * .42f).toInt())
            if (params.width != width || params.topMargin != top) {
                params.width = width
                params.topMargin = top
                params.bottomMargin = dp(24)
                content.layoutParams = params
            }
        }
        content.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> stage.requestLayout() }
        content.addView(
            ImageView(activity).apply {
                setImageResource(R.mipmap.ic_launcher)
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            },
            LinearLayout.LayoutParams(dp(56), dp(56)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(16)
            },
        )
        row(
            label(
                    if (offline) text("无法连接", "Unable to connect")
                    else text("连接到 Pockymoe", "Connect to Pockymoe"),
                    22f,
                    foreground,
                )
                .apply {
                    typeface =
                        if (android.os.Build.VERSION.SDK_INT >= 28)
                            Typeface.create(
                                Typeface.create("sans-serif", Typeface.NORMAL),
                                600,
                                false,
                            )
                        else Typeface.create("sans-serif-medium", Typeface.NORMAL)
                },
            -2,
        )
        row(
            label(
                if (offline) text("请检查网络后重试", "Check your connection and retry")
                else text("输入你的 Pockymoe 服务地址", "Enter your Pockymoe service address"),
                14f,
                muted,
            ),
            -2,
            8,
        )
        var relay: EditText? = null
        if (!offline) {
            input =
                field(text("服务地址", "Service address"), address, "https://app.example.com").apply {
                    tag = "service-input"
                }
            row(input!!, 48, 24)
            row(
                label(notice, 13f, danger).apply {
                    tag = "connection-error"
                    gravity = Gravity.START or Gravity.CENTER_VERTICAL
                    setSingleLine(true)
                    accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
                },
                24,
                4,
            )
        }
        val buttonFrame = FrameLayout(activity)
        primary =
            Button(activity).apply {
                tag = "connection-button"
                text = primaryLabel
                contentDescription = primaryLabel
                textSize = 16f
                isAllCaps = false
                typeface =
                    if (android.os.Build.VERSION.SDK_INT >= 28)
                        Typeface.create(Typeface.create("sans-serif", Typeface.NORMAL), 600, false)
                    else Typeface.create("sans-serif-medium", Typeface.NORMAL)
                minimumHeight = 0
                minHeight = 0
                setPadding(0, 0, 0, 0)
                setOnClickListener {
                    if (offline) retry()
                    else connect(input!!.text.toString(), relay?.text?.toString().orEmpty())
                }
            }
        buttonFrame.addView(primary, FrameLayout.LayoutParams(-1, -1))
        spinner =
            ProgressBar(activity).apply {
                tag = "connection-spinner"
                visibility = View.GONE
                indeterminateTintList = ColorStateList.valueOf(accentText)
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
        buttonFrame.addView(spinner, FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER))
        row(buttonFrame, 48, if (offline) 24 else 8)
        if (offline) row(quiet(text("更改地址", "Change address"), change), 44, 8)
        else {
            val advanced =
                LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    visibility = View.GONE
                }
            row(
                quiet(text("高级", "Advanced")) {
                    advanced.visibility =
                        if (advanced.visibility == View.GONE) View.VISIBLE else View.GONE
                },
                44,
                8,
            )
            row(advanced, -2)
            advanced.addView(
                label(text("Relay 地址（可选）", "Relay address (optional)"), 14f, muted).apply {
                    gravity = Gravity.START
                },
                LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) },
            )
            relay =
                field(text("Relay 地址", "Relay address"), relayAddress, "https://relay.example.com")
            advanced.addView(relay, LinearLayout.LayoutParams(-1, dp(48)))
            input!!.doAfterTextChanged { updateButton() }
        }
        updateButton()
        ViewCompat.setOnApplyWindowInsetsListener(view) { v, insets ->
            val bars =
                insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
                )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        content.isFocusableInTouchMode = true
        content.requestFocus()
    }

    fun probing(value: Boolean) {
        busy = value
        spinner.visibility = if (value) View.VISIBLE else View.GONE
        primary.text = if (value) "" else primaryLabel
        updateButton()
    }

    private fun updateButton() {
        val enabled = !busy && (input == null || input!!.text.isNotBlank())
        primary.isEnabled = enabled
        primary.background = shape(if (enabled || busy) accent else border)
        primary.setTextColor(if (enabled || busy) accentText else muted)
    }
}
