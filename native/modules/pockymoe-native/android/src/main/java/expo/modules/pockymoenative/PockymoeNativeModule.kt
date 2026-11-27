package expo.modules.pockymoenative

import android.app.Activity
import androidx.core.util.Consumer
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Fold posture for the workspace shell: where a vertical hinge or fold sits (in dp from the
 * window's left edge) and whether it separates the window into two panes. The layout then
 * puts the column edge on the hinge instead of under it.
 */
class PockymoeNativeModule : Module() {
  private var adapter: WindowInfoTrackerCallbackAdapter? = null
  private var listener: Consumer<WindowLayoutInfo>? = null
  private var activity: Activity? = null

  override fun definition() = ModuleDefinition {
    Name("PockymoeNative")
    Events("fold")

    Function("startFoldUpdates") {
      val current = appContext.currentActivity ?: return@Function null
      stop()
      val tracker = WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(current))
      val density = current.resources.displayMetrics.density
      val consumer = Consumer<WindowLayoutInfo> { info ->
        val fold = info.displayFeatures.filterIsInstance<FoldingFeature>().firstOrNull()
        val vertical = fold?.orientation == FoldingFeature.Orientation.VERTICAL
        sendEvent("fold", mapOf(
          "hingeX" to if (fold != null && vertical) fold.bounds.exactCenterX() / density else null,
          "hingeWidth" to (fold?.bounds?.width()?.div(density) ?: 0f),
          "separating" to (fold?.isSeparating == true && vertical),
          "halfOpened" to (fold?.state == FoldingFeature.State.HALF_OPENED),
        ))
      }
      tracker.addWindowLayoutInfoListener(current, current.mainExecutor, consumer)
      adapter = tracker; listener = consumer; activity = current
      null
    }

    Function("stopFoldUpdates") { stop() }

    // Background thread notices (ThreadWatchService): the app passes its relay session.
    Function("startThreadWatch") { relay: String, token: String, scheme: String, texts: Map<String, String> ->
      val context = appContext.reactContext ?: return@Function false
      Config.save(context, relay, token, scheme, texts)
      ThreadWatchService.start(context)
      true
    }
    Function("rememberThreadNames") { names: Map<String, String> ->
      val context = appContext.reactContext ?: return@Function null
      if (Config.relay(context) != null) Config.saveNames(context, names)
      null
    }
    Function("cameraAvailable") {
      appContext.reactContext?.packageManager?.hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY) ?: true
    }
    Function("stopThreadWatch") {
      val context = appContext.reactContext ?: return@Function null
      ThreadWatchService.stop(context)
      Config.clear(context)
      null
    }

    OnActivityEntersForeground {
      Foreground.visible = true
      // Android 15 stops a dataSync service at its time limit (onTimeout); coming back to the
      // app starts the watch again while a session is saved.
      appContext.reactContext?.let { context -> if (Config.relay(context) != null && Config.token(context) != null) runCatching { ThreadWatchService.start(context) } }
    }
    OnActivityEntersBackground { Foreground.visible = false }
    OnActivityDestroys { stop() }
  }

  private fun stop() {
    val l = listener
    if (l != null) adapter?.removeWindowLayoutInfoListener(l)
    adapter = null; listener = null; activity = null
  }
}
