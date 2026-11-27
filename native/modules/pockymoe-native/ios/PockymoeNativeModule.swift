import ExpoModulesCore
import UIKit

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

    // Simulators, and iPads or Macs without a camera: presenting the camera picker there aborts
    // the app (UIImagePickerController rejects an unavailable source type).
    Function("cameraAvailable") { () -> Bool in
      UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    // iPadOS 26+ windowed apps: the window controls (close/minimise/resize) sit in the top-leading
    // corner over the app, outside the plain safe area. The safe area adapted vertically to that
    // corner starts below them; the app pads its top by it so headers stay clear (D21).
    AsyncFunction("windowControlsTop") { () -> Double in
      guard let view = Self.rootView() else { return 0 }
      if #available(iOS 26.0, *) {
        return Double(view.layoutGuide(for: .safeArea(cornerAdaptation: .vertical)).layoutFrame.minY)
      }
      return Double(view.safeAreaInsets.top)
    }.runOnQueue(.main)
  }

  private static func rootView() -> UIView? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let windows = scenes.flatMap { $0.windows }
    return (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController?.view
  }
}
