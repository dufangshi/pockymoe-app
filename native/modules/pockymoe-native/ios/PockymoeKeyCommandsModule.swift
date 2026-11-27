import ExpoModulesCore
import UIKit

/// Hardware keyboard shortcuts: UIKeyCommands on a view around the app, so they reach the
/// responder chain while a text field inside it is focused (Cmd+Enter in the composer) and
/// appear in the iPad shortcut overlay. Same commands as Android. The plain list keys (arrows,
/// Home, End, Return) do not take priority over the system, so a focused text field keeps
/// them; a picker inside a Modal puts its own of these views inside its presented view.
public final class PockymoeKeyCommandsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PockymoeKeyCommands")
    View(PockymoeKeyCommandsView.self) {
      Prop("enabledCommands") { (view: PockymoeKeyCommandsView, commands: [String]) in
        view.enabledCommands = Set(commands)
      }
      Prop("takesKeys") { (view: PockymoeKeyCommandsView, takes: Bool) in
        view.takesKeys = takes
      }
      Events("onCommand")
    }
  }
}

public final class PockymoeKeyCommandsView: ExpoView {
  let onCommand = EventDispatcher()
  var enabledCommands = Set<String>()
  var takesKeys = false

  public override var keyCommands: [UIKeyCommand]? {
    let all: [(String, String, UIKeyModifierFlags, String)] = [
      ("send", "\r", .command, "Send"),
      ("newThread", "n", .command, "New Thread"),
      ("search", "k", .command, "Search"),
      ("search", "f", .command, "Find"),
      ("back", "[", .command, "Back"),
      ("git", "g", [.command, .shift], "Git"),
      ("files", "e", [.command, .shift], "Files"),
      ("up", UIKeyCommand.inputUpArrow, [], ""),
      ("down", UIKeyCommand.inputDownArrow, [], ""),
      ("left", UIKeyCommand.inputLeftArrow, [], ""),
      ("right", UIKeyCommand.inputRightArrow, [], ""),
      ("home", UIKeyCommand.inputHome, [], ""),
      ("end", UIKeyCommand.inputEnd, [], ""),
      ("enter", "\r", [], ""),
    ]
    return all.compactMap { id, input, modifiers, title in
      guard enabledCommands.contains(id) else { return nil }
      let command = UIKeyCommand(title: title, action: #selector(handle(_:)), input: input, modifierFlags: modifiers, propertyList: id)
      command.wantsPriorityOverSystemBehavior = !modifiers.isEmpty
      return command
    }
  }

  // A picker opened by touch has nothing focused: its own view takes the keys until a field is tapped.
  public override var canBecomeFirstResponder: Bool { takesKeys }
  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil && canBecomeFirstResponder { DispatchQueue.main.async { [weak self] in _ = self?.becomeFirstResponder() } }
  }

  @objc private func handle(_ sender: UIKeyCommand) {
    if let id = sender.propertyList as? String { onCommand(["command": id]) }
  }
}
