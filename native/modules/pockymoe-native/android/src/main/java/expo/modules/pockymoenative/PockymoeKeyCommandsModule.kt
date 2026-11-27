package expo.modules.pockymoenative

import android.content.Context
import android.view.KeyEvent
import android.view.View
import android.view.Window
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import androidx.core.view.ViewCompat

/**
 * Hardware keyboard shortcuts (T3's keyboard commands): a view around the app that sees a key
 * before the focused text field does, and reports the shortcuts the screens registered. It
 * wraps the activity window's callback while attached, because with nothing focused (touch
 * mode) Android dispatches keys to no view at all.
 * Ctrl or Meta: Enter send, N new thread, K/F search, [ back, Shift+G Git, Shift+E files.
 *
 * Plain arrows, Home, End and Enter (lists such as the model picker) are taken only when no
 * view handled them (the unhandled-key listener runs before Android's focus search), so a
 * focused text field keeps its caret keys. A picker inside a Modal is another window: it puts
 * its own of these views inside, since keys there never reach the activity's.
 */
class PockymoeKeyCommandsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PockymoeKeyCommands")
    View(PockymoeKeyCommandsView::class) {
      Prop("enabledCommands") { view: PockymoeKeyCommandsView, commands: List<String> -> view.enabledCommands = commands.toSet() }
      Prop("takesKeys") { view: PockymoeKeyCommandsView, takes: Boolean -> view.takesKeys = takes }
      Events("onCommand")
    }
  }
}

class PockymoeKeyCommandsView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onCommand by EventDispatcher()
  var enabledCommands = emptySet<String>()

  private var window: Window? = null
  private val unhandled = ViewCompat.OnUnhandledKeyEventListenerCompat { _: View, event: KeyEvent -> handleNavigation(event) }

  init { ViewCompat.addOnUnhandledKeyEventListener(this, unhandled) }

  /**
   * A picker opened by touch has nothing focused, and Android spends the first arrow key on
   * leaving touch mode by focusing the first focusable view (the sheet's close button, which
   * Enter then presses). Inside a Modal the view holds focus itself instead, so every key
   * reaches the list; a tapped field or Tab still moves focus on as usual.
   */
  var takesKeys = false
    set(value) {
      field = value
      isFocusable = value
      isFocusableInTouchMode = value
      defaultFocusHighlightEnabled = false
      if (value && isAttachedToWindow) post { if (rootView.findFocus() == null) requestFocus() }
    }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    val target = appContext.currentActivity?.window ?: return
    val current = target.callback
    if (current !is KeyCommandsCallback) target.callback = KeyCommandsCallback(current, this)
    window = target
    if (takesKeys) post { if (rootView.findFocus() == null) requestFocus() }
  }

  override fun onDetachedFromWindow() {
    (window?.callback as? KeyCommandsCallback)?.takeIf { it.view === this }?.let { window?.callback = it.original }
    window = null
    super.onDetachedFromWindow()
  }

  /** True when the key is a registered shortcut (handled on key down, swallowed on key up). */
  fun handle(event: KeyEvent): Boolean {
    val command = commandFor(event)?.takeIf { enabledCommands.contains(it) } ?: return false
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) onCommand(mapOf("command" to command))
    return true
  }

  /** Plain list keys nothing else wanted (repeats move on while the key is held). */
  fun handleNavigation(event: KeyEvent): Boolean {
    if (event.isCtrlPressed || event.isMetaPressed || event.isAltPressed || event.isShiftPressed) return false
    val command = when (event.keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> "up"
      KeyEvent.KEYCODE_DPAD_DOWN -> "down"
      KeyEvent.KEYCODE_DPAD_LEFT -> "left"
      KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
      KeyEvent.KEYCODE_MOVE_HOME -> "home"
      KeyEvent.KEYCODE_MOVE_END -> "end"
      KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_SPACE -> "enter"
      else -> null
    }?.takeIf { enabledCommands.contains(it) } ?: return false
    if (event.action == KeyEvent.ACTION_DOWN && (event.repeatCount == 0 || command != "enter")) onCommand(mapOf("command" to command))
    return true
  }

  private fun commandFor(event: KeyEvent): String? {
    if (!(event.isCtrlPressed || event.isMetaPressed) || event.isAltPressed) return null
    val shift = event.isShiftPressed
    return when (event.keyCode) {
      KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> if (shift) null else "send"
      KeyEvent.KEYCODE_N -> if (shift) null else "newThread"
      KeyEvent.KEYCODE_K -> if (shift) null else "search"
      KeyEvent.KEYCODE_F -> if (shift) null else "search"
      KeyEvent.KEYCODE_LEFT_BRACKET -> if (shift) null else "back"
      KeyEvent.KEYCODE_G -> if (shift) "git" else null
      KeyEvent.KEYCODE_E -> if (shift) "files" else null
      else -> null
    }
  }
}

private class KeyCommandsCallback(val original: Window.Callback, val view: PockymoeKeyCommandsView) : Window.Callback by original {
  override fun dispatchKeyEvent(event: KeyEvent): Boolean = view.handle(event) || original.dispatchKeyEvent(event)
}
