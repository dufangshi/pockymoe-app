package com.remotecodex.app

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.uiautomator.UiDevice
import com.remotecodex.app.notify.Notifications
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProductParityTest {
    @get:Rule
    val permission = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private lateinit var scenario: ActivityScenario<MainActivity>

    private fun find(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup)
            for (i in 0 until view.childCount) find(view.getChildAt(i))?.let {
                return it
            }
        return null
    }

    private fun js(source: String): String {
        val done = CountDownLatch(1)
        var result = ""
        scenario.onActivity { activity ->
            find(activity.window.decorView)!!.evaluateJavascript(source) {
                result = it
                done.countDown()
            }
        }
        assertTrue("JavaScript callback", done.await(10, TimeUnit.SECONDS))
        return JSONTokener(result).nextValue().toString()
    }

    private fun eventually(message: String, check: () -> Boolean) {
        val end = System.currentTimeMillis() + 45_000
        while (System.currentTimeMillis() < end) {
            if (runCatching(check).getOrDefault(false)) return
            Thread.sleep(200)
        }
        shot("failure")
        // Deliberately omit document text/URLs: auth callbacks can contain one-use secrets.
        fail(message)
    }

    private fun shot(name: String) {
        val dir = File(context.getExternalFilesDir(null), "screenshots").apply { mkdirs() }
        if (::scenario.isInitialized)
            runCatching {
                js(
                    "document.querySelectorAll('.auth-recovery-code').forEach(e=>e.style.visibility='hidden')"
                )
            }
        val painted = CountDownLatch(1)
        scenario.onActivity { activity ->
            val web = find(activity.window.decorView)
            if (web == null || !activity.hasWindowFocus()) painted.countDown()
            else
                web.postVisualStateCallback(
                    0,
                    object : WebView.VisualStateCallback() {
                        override fun onComplete(requestId: Long) {
                            painted.countDown()
                        }
                    },
                )
        }
        assertTrue("Web frame painted", painted.await(10, TimeUnit.SECONDS))
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        device.waitForIdle(1000)
        Thread.sleep(180)
        assertTrue(device.takeScreenshot(File(dir, "$name.png")))
    }

    private fun load(path: String) {
        js("window.navigationProbe=true;location.assign(${JSONObject.quote(path)})")
        eventually("new Web document ready") {
            js(
                "!window.navigationProbe && document.readyState === 'complete' && !!window.pockymoeHost"
            ) == "true"
        }
    }

    private fun tap(element: String) {
        eventually("tap target ready") {
            js(
                "!!($element) && !($element).disabled && ($element).getBoundingClientRect().width > 0"
            ) == "true"
        }
        val rect =
            JSONObject(
                js(
                    "(() => {const r=($element).getBoundingClientRect(), v=visualViewport; return JSON.stringify({x:r.left+r.width/2-(v?.offsetLeft||0),y:r.top+r.height/2-(v?.offsetTop||0),width:v?.width||innerWidth})})()"
                )
            )
        var x = 0
        var y = 0
        scenario.onActivity { activity ->
            val view = find(activity.window.decorView)!!
            val position = IntArray(2)
            view.getLocationOnScreen(position)
            val scale = view.width / rect.getDouble("width")
            x = position[0] + (rect.getDouble("x") * scale).toInt()
            y = position[1] + (rect.getDouble("y") * scale).toInt()
        }
        assertTrue("native tap injected", device.click(x, y))
    }

    @Test
    fun thinShellAndLiveUpdates() {
        val env = E2eEnv.load()
        File(context.getExternalFilesDir(null), "screenshots").listFiles()?.forEach { it.delete() }
        for (name in
            listOf(
                "remote_codex",
                "mobile_shell",
                "notification_cursor",
                "account_activity",
            )) context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().clear().commit()
        val intent =
            Intent(context, MainActivity::class.java).apply {
                if (env.webUrl != env.appRelayUrl) putExtra(MainActivity.EXTRA_WEB_URL, env.webUrl)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        val cookiesCleared = CountDownLatch(1)
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            CookieManager.getInstance().removeAllCookies { cookiesCleared.countDown() }
        }
        assertTrue(cookiesCleared.await(10, TimeUnit.SECONDS))
        scenario = ActivityScenario.launch(intent)
        scenario.use {
            shot("cold-start")
            assertTrue(
                "native connection page",
                device.wait(
                    androidx.test.uiautomator.Until.hasObject(
                        androidx.test.uiautomator.By.clazz(android.widget.EditText::class.java.name)
                    ),
                    10_000,
                ),
            )
            val address =
                device.findObject(
                    androidx.test.uiautomator.By.clazz(android.widget.EditText::class.java.name)
                )
            address.text = env.appRelayUrl
            shot("connection")
            device
                .findObject(
                    androidx.test.uiautomator.By.clazz(android.widget.Button::class.java.name)
                )
                .click()
            eventually("host available") { js("!!window.pockymoeHost") == "true" }
            js("window.pockymoeHost.capabilities().then(c=>window.testCaps=c)")
            eventually("mobile capabilities") {
                js(
                    "window.testCaps?.surface === 'mobile' && testCaps.platform === 'android' && testCaps.liveActivity && !testCaps.nativePush"
                ) == "true"
            }
            js("window.pockymoeHost.settings.get().then(s=>window.originSettings=s)")
            eventually("separate Web and Relay origins") {
                js(
                    "window.originSettings?.webOrigin === ${JSONObject.quote(env.webUrl)} && originSettings.relayOrigin === ${JSONObject.quote(env.appRelayUrl)}"
                ) == "true"
            }
            assertEquals("Web source URL", env.webUrl, js("location.origin"))
            // Same-origin child frames still have no host, and their transport cannot invoke native
            // code.
            js(
                "window.testFrame=document.createElement('iframe'); testFrame.srcdoc='<!doctype html><title>frame</title>';document.body.append(testFrame)"
            )
            eventually("iframe cannot access host") {
                js(
                    "window.testFrame.contentDocument.readyState === 'complete' && !window.testFrame.contentWindow.pockymoeHost"
                ) == "true"
            }
            js(
                "window.testFrame.contentWindow.PockymoeAndroid?.postMessage(JSON.stringify({id:'frame',method:'settings.set',args:[{frameProbe:true}]})); window.testFrame.remove(); window.pockymoeHost.settings.get().then(s=>window.frameSettings=s)"
            )
            eventually("iframe cannot invoke bridge") {
                js("window.frameSettings && !window.frameSettings.frameProbe") == "true"
            }
            load("/relay-portal")
            fun fill(selector: String, value: String) =
                js(
                    "(() => {const e=document.querySelector(${JSONObject.quote(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSONObject.quote(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()"
                )
            eventually("Web login form") {
                js("!!document.querySelector('input[name=identifier]')") == "true"
            }
            fill("input[name=identifier]", env.username)
            fill("input[name=password]", env.password)
            tap("document.querySelector('form button[type=submit]')")
            eventually("Web password authentication completed") {
                js(
                    "!document.querySelector('input[name=identifier]') && location.pathname !== '/relay-portal'"
                ) == "true"
            }
            shot("web-login")
            load("/relay-devices")
            eventually("Web device list") {
                js("document.body.innerText.includes('e2e-phone')") == "true"
            }
            if (
                js(
                    "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Later')"
                ) == "true"
            )
                tap(
                    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Later')"
                )
            shot("devices")
            js(
                "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Connect').click()"
            )
            eventually("Web workspaces") {
                js("document.body.innerText.includes('mobile-ws')") == "true"
            }
            eventually("workspace row ready") {
                js(
                    "Array.from(document.querySelectorAll('a,button')).some(e=>e.textContent.includes('mobile-ws'))"
                ) == "true"
            }
            shot("workspaces")
            eventually("native background session ready") {
                com.remotecodex.app.data.SessionStore(context).isSignedIn
            }
            env.token = com.remotecodex.app.data.SessionStore(context).token
            env.allowAllNotifications()
            eventually("durable service started") {
                context
                    .getSharedPreferences("notification_cursor", Context.MODE_PRIVATE)
                    .all
                    .keys
                    .any { it.endsWith(".since") }
            }
            device.pressHome()
            val created = env.startThreadAndPrompt()
            device.openNotification()
            assertTrue(
                "durable background event",
                device.wait(
                    androidx.test.uiautomator.Until.hasObject(
                        androidx.test.uiautomator.By.textContains("Agent run finished")
                    ),
                    45_000,
                ),
            )
            device
                .findObject(androidx.test.uiautomator.By.textContains("Agent run finished"))
                .click()
            device.executeShellCommand("cmd statusbar collapse")
            js(
                "window.pockymoeHost.window.openThread('/devices/${env.deviceId}/threads/${created.id}')"
            )
            eventually("exact thread composer") {
                js("!!document.querySelector('[role=textbox][aria-label=Prompt]')") == "true"
            }
            eventually("fake harness response") {
                js("document.body.innerText.includes('hello')") == "true"
            }
            assertEquals(
                "one shared header",
                "1",
                js("document.querySelectorAll('.matter-topbar').length"),
            )
            assertEquals("Service Worker", "true", js("!!navigator.serviceWorker.controller"))
            if (
                js(
                    "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Later')"
                ) == "true"
            )
                tap(
                    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Later')"
                )
            shot("thread")
            val composer = "document.querySelector('[role=textbox][aria-label=Prompt]')"
            tap(composer)
            device.executeShellCommand("input text android-shell-message")
            eventually("keyboard resizes visible area") {
                js("visualViewport.height < screen.height * .8") == "true"
            }
            eventually("composer attached to keyboard") {
                js(
                    "(() => {const r=document.querySelector('[role=textbox][aria-label=Prompt]').closest('form').getBoundingClientRect(),v=visualViewport;return Math.abs(r.bottom-v.height-v.offsetTop)<40})()"
                ) == "true"
            }
            shot("keyboard")
            // Send through the real shared composer, not the backend helper.
            eventually("send button") {
                js(
                    "Array.from(document.querySelectorAll('button')).some(b => /send now|send message|send prompt|发送/i.test(b.getAttribute('aria-label')||''))"
                ) == "true"
            }
            tap(
                "Array.from(document.querySelectorAll('button')).find(b => /send now|send message|send prompt|发送/i.test(b.getAttribute('aria-label')||''))"
            )
            eventually("message sent from Web") {
                js(
                    "document.body.innerText.includes('android-shell-message') && !document.querySelector('[role=textbox][aria-label=Prompt]').innerText.includes('android-shell-message')"
                ) == "true"
            }
            var imeVisible = false
            scenario.onActivity {
                imeVisible =
                    androidx.core.view.ViewCompat.getRootWindowInsets(it.window.decorView)
                        ?.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()) == true
            }
            if (imeVisible) device.pressBack()
            val route = "/devices/${env.deviceId}/threads/${created.id}"
            eventually("thread remains after keyboard dismissal") {
                js("location.pathname") == route
            }
            js("window.retainedMarker = 'warm'")
            device.pressHome()
            Thread.sleep(500)
            context.startActivity(
                Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            )
            eventually("resume preserves document") { js("window.retainedMarker") == "warm" }
            assertEquals(route, js("location.pathname"))
            shot("warm-resume")
            // Contract-level back tests distinguish handled overlays from exiting the root.
            val backIndex = js("String(history.state?.idx)")
            js(
                "window.testBack=0;window.stopBack=window.pockymoeHost.onCommand(c=>{if(c.type==='back')window.testBack++})"
            )
            device.swipe(
                1,
                device.displayHeight / 2,
                device.displayWidth / 2,
                device.displayHeight / 2,
                30,
            )
            eventually("back delivered to page") { js("window.testBack > 0") == "true" }
            eventually("back navigation committed") {
                js("String(history.state?.idx)") != backIndex || js("!window.stopBack") == "true"
            }
            Thread.sleep(300)
            eventually("back destination ready") {
                js("document.readyState === 'complete' && !!window.pockymoeHost") == "true"
            }
            js(
                "window.stopBack?.();window.pockymoeHost.window.openThread(${JSONObject.quote(route)})"
            )
            eventually("thread restored") {
                js("!!document.querySelector('[role=textbox][aria-label=Prompt]')") == "true"
            }
            load("/relay-account")
            eventually("Web account security") {
                js("document.body.innerText.includes('Security')") == "true"
            }
            shot("account")
            load("/relay-settings")
            eventually("Web settings dialog") {
                js("!!document.querySelector('[role=dialog]')") == "true"
            }
            eventually("settings controls ready") {
                js(
                    "Array.from(document.querySelectorAll('[role=dialog]')).some(e=>e.getClientRects().length && /Settings|Preferences|Theme/.test(e.innerText) && !!e.querySelector('button'))"
                ) == "true"
            }
            shot("settings")
            load(route)
            eventually("thread after settings") {
                js("!!document.querySelector('[role=textbox][aria-label=Prompt]')") == "true"
            }
            js(
                "window.savedResult=null;window.pockymoeHost.files.saveAs('android-shell.txt',new TextEncoder().encode('test').buffer).then(r=>window.savedResult=r)"
            )
            assertTrue(
                "native save picker",
                device.wait(
                    androidx.test.uiautomator.Until.hasObject(
                        androidx.test.uiautomator.By.pkg(
                            java.util.regex.Pattern.compile(".*documentsui")
                        )
                    ),
                    10_000,
                ),
            )
            device.pressBack()
            eventually("save cancellation result") {
                js("window.savedResult?.saved === false") == "true"
            }
            // Theme storage and reload exercise the real theme pack loader.
            for (pack in listOf("classic", "plum-pocket", "terminal")) for (mode in
                listOf("light", "dark")) {
                js(
                    "window.navigationProbe=true;localStorage.setItem('pockymoe-theme-preset', '$pack');localStorage.setItem('remote-codex-theme-mode', '$mode');location.reload()"
                )
                eventually("theme loaded") {
                    js(
                        "!window.navigationProbe && !!document.querySelector('[role=textbox][aria-label=Prompt]')"
                    ) == "true"
                }
                eventually("theme applied") {
                    js(
                        "document.documentElement.dataset.themePreset === '$pack' && document.documentElement.dataset.themeEffective === '$mode'"
                    ) == "true"
                }
                Thread.sleep(500)
                shot("$pack-$mode")
            }
            // Local notification controls are compiled out of release entry points.
            for (state in
                listOf("running", "needsInput", "failed", "interrupted", "completed", "idle")) {
                scenario.onActivity { Notifications.debugState(it, state) }
                Thread.sleep(400)
                val notice =
                    context
                        .getSystemService(NotificationManager::class.java)
                        .activeNotifications
                        .filter { it.id == Notifications.WATCH_ID }
                assertEquals("one account notification", 1, notice.size)
                if (state != "idle") {
                    assertEquals(
                        "Live Update API style",
                        Notification.ProgressStyle::class.java.name,
                        notice.single().notification.extras.getString("android.template"),
                    )
                    if (
                        android.os.Build.VERSION.SDK_INT_FULL >=
                            android.os.Build.VERSION_CODES_FULL.BAKLAVA_1
                    )
                        assertTrue(
                            "promotion requested",
                            notice.single().notification.isRequestPromotedOngoing,
                        )
                    if (
                        android.os.Build.VERSION.SDK_INT_FULL >=
                            android.os.Build.VERSION_CODES_FULL.BAKLAVA_1
                    ) {
                        assertTrue(
                            "system allows promoted notifications",
                            context
                                .getSystemService(NotificationManager::class.java)
                                .canPostPromotedNotifications(),
                        )
                        assertTrue(
                            "system marked Live Update promoted",
                            notice.single().notification.flags and
                                Notification.FLAG_PROMOTED_ONGOING != 0,
                        )
                    }
                    android.util.Log.i(
                        "PockymoeE2E",
                        "LiveUpdate state=$state allowed=${context.getSystemService(NotificationManager::class.java).canPostPromotedNotifications()} promoted=${notice.single().notification.flags and Notification.FLAG_PROMOTED_ONGOING != 0}",
                    )
                    assertTrue(
                        "eligible Live Update",
                        notice.single().notification.hasPromotableCharacteristics(),
                    )
                }
                device.pressHome()
                Thread.sleep(300)
                shot("chip-$state")
                device.openNotification()
                Thread.sleep(500)
                shot("live-$state")
                device.executeShellCommand("cmd statusbar collapse")
                context.startActivity(
                    Intent(context, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                )
                eventually("return from Live Update inspection") {
                    com.remotecodex.app.notify.RemoteCodexForeground.isForeground
                }
            }
            scenario.onActivity { Notifications.debugState(it, "clear") }
            // Notification target is the cached page title and exact thread, including a cold
            // start.
            scenario.onActivity { activity ->
                Notifications.sync(
                    activity,
                    JSONObject()
                        .put("accountId", "e2e")
                        .put(
                            "items",
                            org.json
                                .JSONArray()
                                .put(
                                    JSONObject()
                                        .put("key", "${env.deviceId}:${created.id}")
                                        .put("deviceId", env.deviceId)
                                        .put("threadId", created.id)
                                        .put("title", "Android E2E")
                                        .put("state", "running")
                                        .put("since", java.time.Instant.now().toString())
                                ),
                        ),
                )
            }
            val notice =
                context
                    .getSystemService(NotificationManager::class.java)
                    .activeNotifications
                    .single { it.id == Notifications.WATCH_ID }
            device.pressHome()
            notice.notification.contentIntent.send()
            eventually("notification opens exact thread") { js("location.pathname") == route }
            scenario.recreate()
            eventually("recreated thread") {
                js("!!document.querySelector('[role=textbox][aria-label=Prompt]')") == "true"
            }
            eventually("recreated composer ready") {
                js(
                    "document.querySelector('[role=textbox][aria-label=Prompt]')?.isContentEditable === true"
                ) == "true"
            }
            shot("notification-thread")
            scenario.onActivity {
                find(it.window.decorView)!!.loadUrl(
                    "${env.webUrl.replace(Regex(":\\d+$"), ":19998")}/"
                )
            }
            eventually("offline page") {
                device.hasObject(androidx.test.uiautomator.By.text("Unable to connect")) ||
                    device.hasObject(androidx.test.uiautomator.By.text("无法连接"))
            }
            shot("offline")
            // Return to the configured origin after the failed navigation.
            scenario.onActivity { find(it.window.decorView)!!.loadUrl(env.webUrl + route) }
            eventually("network restored") {
                js("!!document.querySelector('[role=textbox][aria-label=Prompt]')") == "true"
            }
        }
    }
}
