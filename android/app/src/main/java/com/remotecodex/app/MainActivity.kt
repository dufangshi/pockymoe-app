package com.remotecodex.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.HapticFeedbackConstants
import android.view.View
import android.webkit.*
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.remotecodex.app.data.SessionStore
import com.remotecodex.app.data.ShellOrigins
import com.remotecodex.app.notify.*
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/** The only product surface is the deployed page. No plaintext device API bridge. */
// openWeb checks both required WebKit features before installing any bridge;
// reply proxies can only originate from that listener.
@SuppressLint("RequiresFeature")
class MainActivity : ComponentActivity() {
    private lateinit var store: SessionStore
    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private val prefs by lazy { getSharedPreferences("mobile_shell", MODE_PRIVATE) }
    private var reply: JavaScriptReplyProxy? = null
    private var authReply: Pair<JavaScriptReplyProxy, String>? = null
    private var saveReply: Pair<JavaScriptReplyProxy, String>? = null
    private var saveBytes: ByteArray? = null
    private var backId: String? = null
    private var failed = false
    private var authStopped = false
    private var permissionAsked = false
    private var origin = ""
    private var debugWebOrigin: String? = null
    private var pageBackground = Color.TRANSPARENT
    private lateinit var firstPaint: FirstPaintState
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val permission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    private val chooser =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            fileCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(it.resultCode, it.data)
            )
            fileCallback = null
        }
    private val save =
        registerForActivityResult(
            ActivityResultContracts.CreateDocument("application/octet-stream")
        ) { uri ->
            val saved =
                uri != null &&
                    runCatching {
                            contentResolver.openOutputStream(uri!!)?.use {
                                it.write(saveBytes!!)
                            } != null
                        }
                        .getOrDefault(false)
            saveReply?.let { respond(it.first, it.second, JSONObject().put("saved", saved)) }
            saveReply = null
            saveBytes = null
        }

    override fun onCreate(state: Bundle?) {
        pageBackground = StartupTheme.background(this)
        firstPaint = FirstPaintState(pageBackground)
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(pageBackground))
        super.onCreate(state)
        enableEdgeToEdge()
        store = SessionStore(this)
        if (BuildConfig.DEBUG) {
            debugWebOrigin = intent.getStringExtra(EXTRA_WEB_URL)
            intent.getStringExtra(EXTRA_RELAY_URL)?.let { address ->
                val pair = ShellOrigins.forAddress(address)
                store.relayUrl = pair.relayOrigin
                store.webOrigin = debugWebOrigin ?: pair.webOrigin
            }
            intent.getStringExtra(EXTRA_TOKEN)?.let { store.token = it }
        }
        val dark = StartupPaint.isDark(pageBackground)
        root = FrameLayout(this).apply { setBackgroundColor(pageBackground) }
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(pageBackground))
        setContentView(root)
        StartupTrace.event("activityRootConfigured", pageBackground)
        if (Build.VERSION.SDK_INT >= 31)
            splashScreen.setOnExitAnimationListener { splash ->
                StartupTrace.event(
                    "systemSplashExit",
                    StartupTrace.color(splash),
                    if (::web.isInitialized) web.alpha else null,
                )
                StartupTrace.event(
                    "rootAtSplashExit",
                    StartupTrace.color(root),
                    if (::web.isInitialized) web.alpha else null,
                )
                splash.remove()
            }
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (backId != null) return
                    if (reply == null) {
                        moveTaskToBack(true)
                        return
                    }
                    val id = UUID.randomUUID().toString()
                    backId = id
                    reply?.postMessage(
                        JSONObject()
                            .put("command", JSONObject().put("id", id).put("type", "back"))
                            .toString()
                    )
                    // A stalled page must not trap a person in the app.
                    root.postDelayed(
                        {
                            if (backId == id) {
                                backId = null
                                moveTaskToBack(true)
                            }
                        },
                        1500,
                    )
                }
            },
        )
        if (store.hasRelayUrl) openWeb(state) else localPage(false)
        if (BuildConfig.DEBUG)
            intent.getStringExtra("e2eNotificationState")?.let {
                Notifications.debugState(this, it)
            }
    }

    private fun validOrigin(value: String): Boolean {
        val u = Uri.parse(value)
        return u.host != null &&
            u.userInfo == null &&
            (u.path.isNullOrEmpty() || u.path == "/") &&
            u.query == null &&
            u.fragment == null &&
            (u.scheme == "https" ||
                (BuildConfig.DEBUG &&
                    u.scheme == "http" &&
                    u.host in setOf("localhost", "127.0.0.1", "10.0.2.2")))
    }

    private fun sameOrigin(uri: Uri, expected: String = origin): Boolean {
        val a = Uri.parse(expected)
        fun port(u: Uri) = if (u.port != -1) u.port else if (u.scheme == "https") 443 else 80
        return uri.scheme == a.scheme && uri.host == a.host && port(uri) == port(a)
    }

    private fun localPage(offline: Boolean) {
        if (offline && root.findViewWithTag<View>("offline") != null) return
        val layout =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val dp = resources.displayMetrics.density
                setPadding(
                    (24 * dp).toInt(),
                    (64 * dp).toInt(),
                    (24 * dp).toInt(),
                    (24 * dp).toInt(),
                )
                setBackgroundColor(pageBackground)
                tag = if (offline) "offline" else "connect"
            }
        val dark = Color.red(pageBackground) < 128
        val textColor = if (dark) Color.parseColor("#E9E9E7") else Color.parseColor("#17171A")
        layout.addView(
            TextView(this).apply {
                text =
                    if (offline) shellText(this@MainActivity, "无法连接", "Unable to connect")
                    else shellText(this@MainActivity, "连接 Pockymoe", "Connect to Pockymoe")
                setTextColor(textColor)
                textSize = 22f
            }
        )
        if (offline) {
            layout.addView(
                TextView(this).apply {
                    text =
                        shellText(
                            this@MainActivity,
                            "无法连接到 Relay，请检查网络后重试。",
                            "Cannot connect to the Relay. Check your connection and retry.",
                        )
                    setTextColor(textColor)
                }
            )
            layout.addView(
                Button(this).apply {
                    text = shellText(this@MainActivity, "重试", "Retry")
                    setOnClickListener {
                        root.removeView(layout)
                        failed = false
                        if (::web.isInitialized) web.alpha = 0f
                        if (::web.isInitialized) web.reload() else openWeb(null)
                    }
                }
            )
        } else {
            val input =
                EditText(this).apply {
                    setText("https://app.lnz-study.com")
                    contentDescription = shellText(this@MainActivity, "Relay 地址", "Relay address")
                    setTextColor(textColor)
                    inputType = 17
                }
            layout.addView(input)
            layout.addView(
                Button(this).apply {
                    text = shellText(this@MainActivity, "连接", "Connect")
                    setOnClickListener {
                        val address =
                            com.remotecodex.app.data.normalizeRelayUrl(input.text.toString())
                        if (!validOrigin(address)) {
                            input.error =
                                shellText(
                                    this@MainActivity,
                                    "请输入 HTTPS Relay 地址",
                                    "Enter an HTTPS Relay address",
                                )
                            return@setOnClickListener
                        }
                        AgentEventService.stop(this@MainActivity)
                        Notifications.clear(this@MainActivity)
                        store.token = ""
                        val pair = ShellOrigins.forAddress(address)
                        store.relayUrl = pair.relayOrigin
                        store.webOrigin =
                            if (BuildConfig.DEBUG) debugWebOrigin ?: pair.webOrigin
                            else pair.webOrigin
                        openWeb(null)
                    }
                }
            )
        }
        // These two offline-only native pages use flat controls; product forms stay in the Web UI.
        for (i in 0 until layout.childCount) {
            val child = layout.getChildAt(i)
            if (child is Button || child is EditText) {
                child.minimumHeight = (44 * resources.displayMetrics.density).toInt()
                child.background =
                    GradientDrawable().apply {
                        setColor(Color.TRANSPARENT)
                        cornerRadius = 8 * resources.displayMetrics.density
                        setStroke((resources.displayMetrics.density).toInt(), textColor)
                    }
                (child as? TextView)?.setTextColor(textColor)
                child.layoutParams =
                    LinearLayout.LayoutParams(-1, -2).apply {
                        topMargin = (12 * resources.displayMetrics.density).toInt()
                    }
            }
        }
        ViewCompat.setOnApplyWindowInsetsListener(layout) { view, insets ->
            val bars =
                insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
                )
            view.setPadding(
                view.paddingLeft,
                maxOf(bars.top, (64 * resources.displayMetrics.density).toInt()),
                view.paddingRight,
                bars.bottom,
            )
            insets
        }
        root.addView(layout, FrameLayout.LayoutParams(-1, -1))
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openWeb(state: Bundle?) {
        origin = store.webOrigin
        if (!validOrigin(origin) || !validOrigin(store.relayUrl)) {
            AgentEventService.stop(this)
            Notifications.clear(this)
            store.token = ""
            store.relayUrl = ""
            localPage(false)
            return
        }
        root.removeAllViews()
        if (
            !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
                !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        ) {
            localPage(true)
            return
        }
        web =
            WebView(this).apply {
                alpha = 0f
                setBackgroundColor(pageBackground)
                overScrollMode = View.OVER_SCROLL_NEVER
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                settings.useWideViewPort = true
                settings.loadWithOverviewMode = true
                WebViewCompat.addWebMessageListener(this, "PockymoeAndroid", setOf(origin)) {
                    _,
                    message,
                    source,
                    main,
                    proxy ->
                    if (main && sameOrigin(source))
                        runCatching { handle(JSONObject(message.data ?: "{}"), proxy) }
                            .onFailure {
                                runCatching {
                                    respond(
                                        proxy,
                                        JSONObject(message.data!!).optString("id"),
                                        null,
                                        shellText(
                                            this@MainActivity,
                                            "无法完成操作",
                                            "Unable to complete the action",
                                        ),
                                    )
                                }
                            }
                }
                WebViewCompat.addDocumentStartJavaScript(
                    this,
                    assets.open("pockymoe-host.js").bufferedReader().use { it.readText() },
                    setOf(origin),
                )
                webViewClient =
                    object : WebViewClient() {
                        override fun onPageStarted(
                            view: WebView,
                            url: String,
                            favicon: android.graphics.Bitmap?,
                        ) {
                            reply = null
                            failed = false
                            firstPaint.begin()
                            view.animate().cancel()
                            view.alpha = 0f
                            view.setBackgroundColor(pageBackground)
                            StartupTrace.event("webNavigationHidden", pageBackground, view.alpha)
                        }

                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest,
                        ): Boolean {
                            if (!request.isForMainFrame || sameOrigin(request.url)) return false
                            external(request.url)
                            return true
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            error: WebResourceError,
                        ) {
                            if (request.isForMainFrame) {
                                failed = true
                                localPage(true)
                            }
                        }

                        override fun onReceivedHttpError(
                            view: WebView,
                            request: WebResourceRequest,
                            response: WebResourceResponse,
                        ) {
                            if (request.isForMainFrame && response.statusCode >= 400) {
                                failed = true
                                localPage(true)
                            }
                        }

                        override fun onPageCommitVisible(view: WebView, url: String) {
                            StartupTrace.event("webDocumentCommitted", pageBackground, view.alpha)
                            if (!failed) {
                                root.findViewWithTag<View>("offline")?.let(root::removeView)
                                firstPaint.documentCommitted()
                                revealPaintedPage(view)
                            }
                        }

                        override fun onPageFinished(view: WebView, url: String) {
                            if (sameOrigin(Uri.parse(url))) syncSession()
                        }

                        override fun doUpdateVisitedHistory(
                            view: WebView,
                            url: String,
                            reload: Boolean,
                        ) {
                            if (sameOrigin(Uri.parse(url)))
                                prefs
                                    .edit()
                                    .putString(
                                        "route",
                                        Uri.parse(url).encodedPath +
                                            (Uri.parse(url).encodedQuery?.let { "?$it" } ?: ""),
                                    )
                                    .apply()
                        }
                    }
                webChromeClient =
                    object : WebChromeClient() {
                        override fun onShowFileChooser(
                            view: WebView,
                            callback: ValueCallback<Array<Uri>>,
                            params: FileChooserParams,
                        ): Boolean {
                            fileCallback?.onReceiveValue(null)
                            fileCallback = callback
                            chooser.launch(params.createIntent())
                            return true
                        }
                    }
                setOnLongClickListener {
                    hitTestResult.type in
                        setOf(
                            WebView.HitTestResult.SRC_ANCHOR_TYPE,
                            WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE,
                        )
                }
            }
        // The deployed Web UI and its Relay are distinct origins. Session cookies
        // remain native/private and are read only for the explicitly configured Relay.
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        root.addView(web, FrameLayout.LayoutParams(-1, -1))
        // Edge-to-edge stays with the page; only the IME shrinks the visible viewport.
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            val bars =
                insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
                )
            val webVersion =
                WebViewCompat.getCurrentWebViewPackage(this)
                    ?.versionName
                    ?.substringBefore('.')
                    ?.toIntOrNull() ?: 0
            // WebView <136 cannot publish edge-to-edge safe-area env values. Match the
            // page's background behind system bars and inset the viewport on those engines.
            // Newer engines receive the unconsumed insets and use the page's env() rules.
            val legacyInsets = webVersion < 136
            web.layoutParams =
                (web.layoutParams as FrameLayout.LayoutParams).apply {
                    topMargin = if (legacyInsets) bars.top else 0
                    leftMargin = if (legacyInsets) bars.left else 0
                    rightMargin = if (legacyInsets) bars.right else 0
                    bottomMargin = if (legacyInsets) maxOf(ime, bars.bottom) else 0
                }
            // Modern WebView adjusts visualViewport from the IME itself. Resizing its
            // native bounds too would apply the keyboard offset twice in the shared UI.
            if (legacyInsets)
                WindowInsetsCompat.Builder(insets)
                    .setInsets(WindowInsetsCompat.Type.ime(), androidx.core.graphics.Insets.NONE)
                    .build()
            else insets
        }
        val route = notificationRoute(intent) ?: prefs.getString("route", "/").orEmpty()
        if (state != null && notificationRoute(intent) == null && web.restoreState(state) != null)
            return
        val cookie =
            "remote_codex_relay_session=${store.token}; Path=/; HttpOnly; SameSite=Lax${if (store.relayUrl.startsWith("https:")) "; Secure" else ""}"
        if (BuildConfig.DEBUG && store.token.isNotBlank())
            CookieManager.getInstance().setCookie(store.relayUrl, cookie) {
                web.loadUrl(origin + route)
            }
        else web.loadUrl(origin + route)
    }

    private fun respond(
        proxy: JavaScriptReplyProxy,
        id: String,
        data: Any?,
        error: String? = null,
    ) {
        proxy.postMessage(
            JSONObject()
                .put("id", id)
                .put("data", data ?: JSONObject.NULL)
                .apply { if (error != null) put("error", error) }
                .toString()
        )
    }

    private fun handle(value: JSONObject, proxy: JavaScriptReplyProxy) {
        reply = proxy
        val id = value.getString("id")
        val args = value.optJSONArray("args") ?: JSONArray()
        var result: Any? = null
        var reconnect = false
        when (value.getString("method")) {
            "capabilities" ->
                result =
                    JSONObject()
                        .put("surface", "mobile")
                        .put("platform", "android")
                        .put("bridgeVersion", 2)
                        .put("shellVersion", BuildConfig.VERSION_NAME)
                        .put("liveActivity", Build.VERSION.SDK_INT >= 36)
                        .put("nativePush", false)
                        .put("haptics", true)
            "activity.sync" -> {
                HostDiagnostics.activity(args.getJSONObject(0))
                syncSession()
                Notifications.sync(this, args.getJSONObject(0))
            }
            "commandResult" ->
                if (args.getString(0) == backId) {
                    backId = null
                    val answer = args.getJSONObject(1)
                    if (
                        !answer.optBoolean("ok") ||
                            answer.optJSONObject("data")?.optBoolean("handled") != true
                    )
                        moveTaskToBack(true)
                }
            "window.openThread" -> navigate(args.getString(0))
            "window.setTitle" -> title = args.getString(0)
            "shell.openExternal" -> external(Uri.parse(args.getString(0)))
            "auth.openExternal" -> {
                val url = Uri.parse(args.getString(0))
                require(
                    url.userInfo == null &&
                        sameOrigin(url, store.relayUrl) &&
                        url.path.orEmpty().startsWith("/relay/auth/")
                )
                require(authReply == null)
                authReply = proxy to id
                try {
                    CustomTabsIntent.Builder().build().launchUrl(this, url)
                } catch (error: Exception) {
                    authReply = null
                    throw error
                }
                return
            }
            "files.saveAs" -> {
                require(saveReply == null)
                val encoded = args.getString(1)
                require(encoded.length <= 45 * 1024 * 1024)
                saveBytes = Base64.decode(encoded, Base64.DEFAULT)
                saveReply = proxy to id
                save.launch(args.getString(0).substringAfterLast('/').substringAfterLast('\\'))
                return
            }
            "settings.get",
            "settings.set" -> {
                val settings = JSONObject(prefs.getString("settings", "{}")!!)
                if (value.getString("method") == "settings.set") {
                    val patch = args.getJSONObject(0)
                    val nextWeb = patch.optString("webOrigin", origin)
                    val nextRelay = patch.optString("relayOrigin", store.relayUrl)
                    require(validOrigin(nextWeb) && validOrigin(nextRelay))
                    reconnect = nextWeb != origin || nextRelay != store.relayUrl
                    if (reconnect) {
                        AgentEventService.stop(this)
                        Notifications.clear(this)
                        store.token = ""
                        store.webOrigin = nextWeb
                        store.relayUrl = nextRelay
                        prefs.edit().remove("route").apply()
                    }
                    for (key in patch.keys()) settings.put(key, patch.get(key))
                    prefs.edit().putString("settings", settings.toString()).apply()
                }
                result =
                    settings.put("webOrigin", store.webOrigin).put("relayOrigin", store.relayUrl)
            }
            "appearance.sync" -> {
                val a = args.getJSONObject(0)
                HostDiagnostics.appearance(a)
                val dark = a.optString("effective") == "dark"
                val appearance = a.toString()
                val document = firstPaint.generation
                prefs.edit().putString("appearance", appearance).apply()
                val color = a.optString("background")
                val parsed = parsePageColor(color)
                if (parsed != null) applyPageBackground(parsed)
                else
                    web.evaluateJavascript(
                        "(() => { const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=" +
                            JSONObject.quote(color) +
                            ".trim() || getComputedStyle(document.documentElement).backgroundColor;ctx.fillRect(0,0,1,1);const p=ctx.getImageData(0,0,1,1).data;return p[3] ? '#' + Array.from(p.slice(0,3),v=>v.toString(16).padStart(2,'0')).join('') : null; })()"
                    ) { raw ->
                        // Resolve CSS Color 4 (oklch/color-mix/etc.) in the browser, then
                        // cache its actual sRGB paint. Never apply an older theme's reply.
                        if (
                            !isDestroyed &&
                                document == firstPaint.generation &&
                                prefs.getString("appearance", "") == appearance
                        )
                            applyPageBackground(parsePageColor(raw.trim('"')) ?: pageBackground)
                    }
                WindowCompat.getInsetsController(window, root).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
                @Suppress("DEPRECATION")
                window.navigationBarColor = pageBackground
                Notifications.appearanceChanged(this)
            }
            "haptics.play" -> {
                if (args.getString(0) in setOf("sent", "attention", "warning"))
                    HostDiagnostics.haptic(args.getString(0))
                web.performHapticFeedback(
                    when (args.getString(0)) {
                        "sent" -> HapticFeedbackConstants.CONTEXT_CLICK
                        "attention" -> HapticFeedbackConstants.LONG_PRESS
                        "warning" ->
                            if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT
                            else HapticFeedbackConstants.LONG_PRESS
                        else -> return
                    }
                )
            }
            "badge.set" -> Unit // Android launchers have no portable numeric badge API.
            else -> error("Unsupported method")
        }
        respond(proxy, id, result)
        if (reconnect)
            root.postDelayed(
                {
                    reply = null
                    openWeb(null)
                },
                150,
            )
    }

    private fun external(uri: Uri) {
        if (uri.scheme in setOf("https", "http", "mailto", "tel"))
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }

    private fun navigate(path: String) {
        val uri = Uri.parse(path)
        require(
            path.startsWith("/") &&
                !path.startsWith("//") &&
                !path.contains('\\') &&
                uri.scheme == null
        )
        if (web.url == origin + path) return
        val proxy = reply
        if (proxy != null)
            proxy.postMessage(
                JSONObject()
                    .put(
                        "command",
                        JSONObject()
                            .put("id", UUID.randomUUID().toString())
                            .put("type", "navigate")
                            .put("path", path),
                    )
                    .toString()
            )
        else web.loadUrl(origin + path)
    }

    private fun applyPageBackground(color: Int) {
        if (firstPaint.appearance(color)) paintBackground(color, persist = true)
        else {
            StartupTrace.event("pageAppearanceQueued", color, web.alpha)
            revealPaintedPage(web)
        }
    }

    private fun paintBackground(color: Int, persist: Boolean) {
        pageBackground = color
        if (persist) prefs.edit().putInt("background", color).apply()
        root.setBackgroundColor(color)
        if (::web.isInitialized) web.setBackgroundColor(color)
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(color))
        @Suppress("DEPRECATION")
        window.navigationBarColor = color
        if (persist) {
            StartupTheme.remember(this)
        }
    }

    private fun revealPaintedPage(view: WebView) {
        if (failed || !firstPaint.canReveal) return
        val document = firstPaint.generation
        val appearance = firstPaint.revision
        view.postVisualStateCallback(
            document,
            object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) {
                    if (failed || isDestroyed || !firstPaint.confirm(requestId, appearance)) return
                    paintBackground(firstPaint.color, persist = true)
                    StartupTrace.event("webVisualStateReady", pageBackground, view.alpha)
                    view
                        .animate()
                        .alpha(1f)
                        .setDuration(120)
                        .withEndAction {
                            StartupTrace.event("webVisible", pageBackground, view.alpha)
                        }
                        .start()
                }
            },
        )
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        if (Build.VERSION.SDK_INT >= 29) theme.rebase()
        else theme.applyStyle(R.style.Theme_RemoteCodex, true)
        super.onConfigurationChanged(newConfig)
        // System theme changes must not recreate the retained WebView.
        // A first-run local page, with no saved paint, continues to follow the OS.
        if (::root.isInitialized && !prefs.contains("background")) {
            val color = StartupTheme.background(this)
            firstPaint.fallback(color)
            paintBackground(color, persist = false)
            val dark = StartupPaint.isDark(color)
            val foreground = Color.parseColor(if (dark) "#E9E9E7" else "#17171A")
            fun recolor(view: View) {
                if (view is TextView) view.setTextColor(foreground)
                if (view is Button || view is EditText)
                    (view.background as? GradientDrawable)?.setStroke(
                        resources.displayMetrics.density.toInt(),
                        foreground,
                    )
                if (view is android.view.ViewGroup)
                    for (i in 0 until view.childCount) recolor(view.getChildAt(i))
            }
            root.findViewWithTag<View>("connect")?.let {
                it.setBackgroundColor(color)
                recolor(it)
            }
            root.findViewWithTag<View>("offline")?.let {
                it.setBackgroundColor(color)
                recolor(it)
            }
            WindowCompat.getInsetsController(window, root).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }

    private fun parsePageColor(value: String): Int? =
        runCatching {
                if (value.startsWith("rgb")) {
                    val parts =
                        value.substringAfter('(').substringBefore(')').split(Regex("[, /]+"))
                    Color.rgb(
                        parts[0].toFloat().toInt(),
                        parts[1].toFloat().toInt(),
                        parts[2].toFloat().toInt(),
                    )
                } else Color.parseColor(value)
            }
            .getOrNull()

    private fun syncSession() {
        val token =
            CookieManager.getInstance()
                .getCookie(store.relayUrl)
                ?.split(';')
                ?.map { it.trim() }
                ?.firstOrNull { it.startsWith("remote_codex_relay_session=") }
                ?.substringAfter('=')
                .orEmpty()
        if (store.token != token) {
            Notifications.clear(this)
            store.token = token
        }
        if (token.isNotBlank() && RemoteCodexForeground.isForeground) {
            if (Build.VERSION.SDK_INT >= 33 && !permissionAsked) {
                permissionAsked = true
                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
            AgentEventService.start(this)
        } else if (token.isBlank()) {
            AgentEventService.stop(this)
            Notifications.clear(this)
        }
    }

    private fun notificationRoute(intent: Intent): String? {
        if (
            intent.getStringExtra(Notifications.EXTRA_RELAY_ORIGIN)?.let { it != store.relayUrl } ==
                true
        )
            return null
        val d = intent.getStringExtra("deviceId") ?: return null
        val t = intent.getStringExtra("threadId") ?: return null
        return "/devices/${Uri.encode(d)}/threads/${Uri.encode(t)}"
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val uri = intent.data
        if (
            uri?.scheme in setOf("pockymoe", "remotecodex") &&
                uri?.host == "auth" &&
                authReply != null
        ) {
            authReply?.let {
                respond(it.first, it.second, JSONObject().put("callbackUrl", uri.toString()))
            }
            authReply = null
        } else notificationRoute(intent)?.let { if (::web.isInitialized) navigate(it) }
        if (BuildConfig.DEBUG)
            intent.getStringExtra("e2eNotificationState")?.let {
                Notifications.debugState(this, it)
            }
    }

    override fun onSaveInstanceState(out: Bundle) {
        if (::web.isInitialized) web.saveState(out)
        super.onSaveInstanceState(out)
    }

    override fun onStart() {
        super.onStart()
        RemoteCodexForeground.isForeground = true
        StartupTheme.remember(this)
    }

    override fun onResume() {
        super.onResume()
        if (authStopped)
            root.postDelayed(
                {
                    authReply?.let { respond(it.first, it.second, null) }
                    authReply = null
                    authStopped = false
                },
                300,
            )
    }

    override fun onStop() {
        if (authReply != null) authStopped = true
        RemoteCodexForeground.isForeground = false
        StartupTheme.remember(this)
        if (::web.isInitialized) CookieManager.getInstance().flush()
        super.onStop()
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        if (::web.isInitialized) {
            reply = null
            authReply = null
            saveReply = null
            (web.parent as? android.view.ViewGroup)?.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }

    companion object {
        const val EXTRA_RELAY_URL = "e2eRelayUrl"
        const val EXTRA_WEB_URL = "e2eWebUrl"
        const val EXTRA_TOKEN = "e2eToken"
        const val EXTRA_DEVICE_ID = "e2eDeviceId"
    }
}
