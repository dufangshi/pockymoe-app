import ExpoModulesCore

/// iPhones and iPads do not fold. The module answers the same API as Android so the
/// workspace shell needs no platform branch: no hinge, never separating.
public class PockymoeNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PockymoeNative")
    Events("fold")

    Function("startFoldUpdates") {
      self.sendEvent("fold", ["hingeX": NSNull(), "hingeWidth": 0, "separating": false, "halfOpened": false])
    }

    Function("stopFoldUpdates") {}

    // iOS delivers thread notices through APNs (the relay's native push); no background poller.
    Function("startThreadWatch") { (_: String, _: String, _: String, _: [String: String]) -> Bool in false }
    Function("stopThreadWatch") {}
    Function("rememberThreadNames") { (_: [String: String]) in }
  }
}
