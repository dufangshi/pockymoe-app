package expo.modules.pockymoenative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.time.Instant
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/**
 * Background notices without Firebase, as the WebView shell does (docs/android-shell.md, "One
 * account notification"): a dataSync foreground service polls the relay's durable account feed
 * (`/relay/account/workbench`, generic outcomes only, no thread content) with the app's relay
 * session while the app is not visible, and posts one notification per finished, failed or
 * waiting turn. Device APIs stay end-to-end encrypted in the app; the feed is account metadata.
 */
class ThreadWatchService : Service() {
  @Volatile private var running = false
  private var worker: Thread? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannels(this)
    promote()
    running = true
    worker = Thread({ loop() }, "pockymoe-thread-watch").apply { isDaemon = true; start() }
  }

  /** Every startForegroundService() must be answered with startForeground(), also for a
   *  service that is already running (the app restarts the watch when it comes forward). */
  private fun promote() {
    val watch = NotificationCompat.Builder(this, WATCH_CHANNEL)
      .setSmallIcon(Config.smallIcon(this, android.R.drawable.stat_notify_sync_noanim))
      .setContentTitle(Config.text(this, "watchTitle", "Watching for finished turns"))
      .setOngoing(true).setSilent(true).setPriority(NotificationCompat.PRIORITY_MIN)
      .setContentIntent(openIntent(this, null))
      .build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(WATCH_ID, watch, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(WATCH_ID, watch)
  }

  private fun loop() {
    val startedAt = System.currentTimeMillis()
    var lastEventAt = 0L
    while (running) {
      val relay = Config.relay(this)
      val token = Config.token(this)
      if (relay == null || token == null || !NotificationManagerCompat.from(this).areNotificationsEnabled()) { stopSelf(); return }
      if (Foreground.visible) { pause(4_000); continue }
      val key = sha256("$relay|$token")
      val prefs = getSharedPreferences("pockymoe_watch_cursor", MODE_PRIVATE)
      val saved = prefs.getLong("$key.since", 0).takeIf { it > 0 } ?: System.currentTimeMillis().also { prefs.edit().putLong("$key.since", it).apply() }
      val since = maxOf(saved, Foreground.leftAt)
      if (since != saved) prefs.edit().putLong("$key.since", since).apply()
      try {
        val events = fetch(relay, token).optJSONArray("notifications")
        if (events != null) {
          val seen = prefs.getStringSet("$key.seen", emptySet()).orEmpty().toMutableSet()
          val retained = mutableSetOf<String>()
          for (i in events.length() - 1 downTo 0) {
            val event = events.optJSONObject(i) ?: continue
            val id = event.optString("id").takeIf { it.isNotEmpty() } ?: continue
            retained.add(id)
            if (id in seen) continue
            val at = runCatching { Instant.parse(event.optString("occurredAt")).toEpochMilli() }.getOrNull() ?: continue
            seen.add(id)
            if (at < since || Foreground.visible) continue
            val route = threadRoute(event.optString("href")) ?: continue
            val outcome = event.optString("title")
            val state = when { outcome.endsWith("needs input") -> "waiting"; outcome.endsWith("failed") -> "failed"; else -> "done" }
            post(route.first, route.second, state)
            lastEventAt = System.currentTimeMillis()
          }
          prefs.edit().putStringSet("$key.seen", seen.intersect(retained)).apply()
        }
      } catch (_: Exception) { /* offline or signed out: try again later */ }
      pause(pollInterval(System.currentTimeMillis() - maxOf(startedAt, lastEventAt, Foreground.leftAt)))
    }
  }

  private fun pause(ms: Long) {
    val until = System.currentTimeMillis() + ms
    // Wake early when the app comes to the foreground.
    while (running && System.currentTimeMillis() < until && !(Foreground.visible && ms > 4_000)) Thread.sleep(250)
  }

  private fun fetch(relay: String, token: String): JSONObject {
    val connection = URL(relay.trimEnd('/') + "/relay/account/workbench").openConnection() as HttpURLConnection
    connection.connectTimeout = 20_000; connection.readTimeout = 30_000; connection.instanceFollowRedirects = false
    connection.setRequestProperty("Authorization", "Bearer $token")
    try {
      if (connection.responseCode != 200) throw IllegalStateException("HTTP ${connection.responseCode}")
      return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
    } finally { connection.disconnect() }
  }

  private fun post(deviceId: String, threadId: String, state: String) {
    val body = when (state) {
      "waiting" -> Config.text(this, "waiting", "A thread needs your input.")
      "failed" -> Config.text(this, "failed", "A turn failed.")
      else -> Config.text(this, "done", "A turn finished.")
    }
    val names = Config.names(this)
    val notification = NotificationCompat.Builder(this, THREAD_CHANNEL)
      .setSmallIcon(Config.smallIcon(this, android.R.drawable.stat_notify_chat))
      .apply { Config.accent(this@ThreadWatchService)?.let { setColor(it) } }
      .setContentTitle(names.optString("$deviceId/$threadId").ifEmpty { Config.text(this, "title", "Pockymoe") })
      .setContentText(body)
      .setSubText(names.optString("device:$deviceId").ifEmpty { null })
      .setAutoCancel(true)
      .setCategory(if (state == "waiting") NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
      .setContentIntent(openIntent(this, "$deviceId/$threadId"))
      .build()
    runCatching { NotificationManagerCompat.from(this).notify("$deviceId/$threadId".hashCode(), notification) }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int { promote(); return START_STICKY }

  // Android 15 caps dataSync services; stop cleanly at the limit.
  override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }

  override fun onDestroy() {
    running = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    const val WATCH_ID = 4101
    const val WATCH_CHANNEL = "pockymoe-watch"
    const val THREAD_CHANNEL = "threads"

    fun start(context: Context) {
      if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
      val intent = Intent(context, ThreadWatchService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }
    fun stop(context: Context) { context.stopService(Intent(context, ThreadWatchService::class.java)) }

    fun ensureChannels(context: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val manager = context.getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(NotificationChannel(WATCH_CHANNEL, Config.text(context, "watchChannel", "Background watch"), NotificationManager.IMPORTANCE_MIN))
      if (manager.getNotificationChannel(THREAD_CHANNEL) == null)
        manager.createNotificationChannel(NotificationChannel(THREAD_CHANNEL, Config.text(context, "threadsChannel", "Threads"), NotificationManager.IMPORTANCE_HIGH))
    }

    /** Opens the app; a thread notice carries `<scheme>://thread/<device>/<thread>` for the JS router. */
    fun openIntent(context: Context, route: String?): PendingIntent {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
      val scheme = Config.scheme(context)
      if (route != null && scheme != null) { launch.action = Intent.ACTION_VIEW; launch.data = Uri.parse("$scheme://thread/$route") }
      launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      return PendingIntent.getActivity(context, route?.hashCode() ?: 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
  }
}

/** Background poll interval after [quietMs] without events or visits (same schedule as the shell). */
internal fun pollInterval(quietMs: Long): Long = when {
  quietMs < 2 * 60_000L -> 4_000L
  quietMs < 10 * 60_000L -> 10_000L
  quietMs < 30 * 60_000L -> 30_000L
  else -> 60_000L
}

internal fun threadRoute(href: String): Pair<String, String>? {
  val parts = Uri.parse(href).pathSegments ?: return null
  if (parts.size != 4 || parts[0] != "devices" || parts[2] != "threads" || parts[3] in setOf("new", "import")) return null
  return parts[1] to parts[3]
}

private fun sha256(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

/** Whether the app's activity is visible, from the module's lifecycle hooks. */
object Foreground {
  @Volatile var visible = false
    set(value) { if (field && !value) leftAt = System.currentTimeMillis(); field = value }
  @Volatile var leftAt = 0L
    private set
}

/**
 * The relay origin, the session token (AES-GCM under an Android Keystore key, never in plain
 * preferences), the URL scheme and the localized notice texts the service shows.
 */
object Config {
  private const val PREFS = "pockymoe_watch"
  private const val KEY_ALIAS = "pockymoe-watch-token"

  fun save(context: Context, relay: String, token: String, scheme: String, texts: Map<String, String>) {
    val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("relay", relay).putString("token", encrypt(token)).putString("scheme", scheme)
    texts.forEach { (k, v) -> editor.putString("text.$k", v) }
    editor.apply()
  }
  fun clear(context: Context) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply() }
  fun relay(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("relay", null)
  fun scheme(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("scheme", null)
  fun text(context: Context, key: String, fallback: String) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("text.$key", null) ?: fallback
  fun token(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("token", null)?.let { runCatching { decrypt(it) }.getOrNull() }

  /**
   * Thread titles and device names the app already decrypted ("<device>/<thread>" and
   * "device:<id>"), so a notice can name its thread. Sealed with the same Keystore key.
   */
  fun saveNames(context: Context, names: Map<String, String>) {
    val json = org.json.JSONObject().apply { names.entries.take(400).forEach { (k, v) -> put(k, v.take(120)) } }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("names", encrypt(json.toString())).apply()
  }
  fun names(context: Context): org.json.JSONObject = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("names", null)
    ?.let { runCatching { org.json.JSONObject(decrypt(it)) }.getOrNull() } ?: org.json.JSONObject()

  /** The app's monochrome notification icon (expo-notifications `icon`), else a system one. */
  fun smallIcon(context: Context, fallback: Int): Int =
    context.resources.getIdentifier("notification_icon", "drawable", context.packageName).takeIf { it != 0 } ?: fallback
  /** The accent expo-notifications writes as `notification_icon_color`, if any. */
  fun accent(context: Context): Int? =
    context.resources.getIdentifier("notification_icon_color", "color", context.packageName).takeIf { it != 0 }?.let { context.getColor(it) }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
    return generator.generateKey()
  }
  private fun encrypt(plain: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val sealed = cipher.doFinal(plain.toByteArray())
    return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + "." + Base64.encodeToString(sealed, Base64.NO_WRAP)
  }
  private fun decrypt(value: String): String {
    val (iv, sealed) = value.split(".", limit = 2)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))) }
    return String(cipher.doFinal(Base64.decode(sealed, Base64.NO_WRAP)))
  }
}
