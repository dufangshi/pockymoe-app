import SwiftUI
import UserNotifications
import WebKit
import BackgroundTasks

@main
struct RemoteCodexApp: App {
    @UIApplicationDelegateAdaptor(NativeAppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ProductRootView(model: model, store: model.store)
                .onOpenURL { url in
                    model.apply(url: url)
                }
        }
        .onChange(of: scenePhase) { _, phase in
            EventWatcher.shared.isForeground = phase == .active
            if phase == .active, model.store.isSignedIn {
                EventWatcher.shared.start()
            }
            if phase == .background {
                EventWatcher.shared.scheduleBackgroundRefresh()
            }
        }
    }
}

final class AppModel: ObservableObject {
    @Published var webTarget = "/"
    let store: SessionStore
    let nav: NavController
    let api: APIClient

    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitesting") {
            let defaults = UserDefaults.standard
            defaults.removePersistentDomain(forName: Bundle.main.bundleIdentifier ?? "com.remotecodex.app")
            HTTPCookieStorage.shared.removeCookies(since: .distantPast)
            URLCache.shared.removeAllCachedResponses()
        }
        #endif
        let store = SessionStore()
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitesting") {
            store.relayUrl = ProcessInfo.processInfo.environment["E2E_RELAY_URL"] ?? ""
            store.token = ProcessInfo.processInfo.environment["E2E_TOKEN"] ?? ""
        }
        #endif
        self.store = store
        self.nav = NavController(store.hasRelayUrl ? .home : .connect)
        self.api = APIClient(store: store)
        NotificationDelegate.shared.onOpen = { [weak self] device, thread in
            self?.openThread(device, thread)
        }
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
        EventWatcher.shared.registerBackgroundTasks()
        EventWatcher.shared.store = store
        if store.isSignedIn {
            EventWatcher.shared.start()
        }
    }

    func apply(url: URL) {
        let parts = url.path.split(separator: "/").map(String.init)
        if ["pockymoe", "remotecodex"].contains(url.scheme ?? ""), url.host == "devices", parts.count == 3, parts[1] == "threads" {
            openThread(parts[0], parts[2])
        }
    }

    func openThread(_ device: String, _ thread: String) {
        guard !device.isEmpty, !thread.isEmpty, thread != "new", thread != "import" else { return }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        guard let d = device.addingPercentEncoding(withAllowedCharacters: allowed), let t = thread.addingPercentEncoding(withAllowedCharacters: allowed) else { return }
        store.deviceId = device
        webTarget = "/devices/\(d)/threads/\(t)"
    }
}

final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()
    private var pending: (String, String)?
    var onOpen: ((String, String) -> Void)? {
        didSet { if let pending, let onOpen { self.pending = nil; onOpen(pending.0, pending.1) } }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        let info = notification.request.content.userInfo
        let open = EventWatcher.shared.openThread
        if EventWatcher.shared.isForeground, info["deviceId"] as? String == open?.deviceId,
           info["threadId"] as? String == open?.threadId { return [] }
        return [.banner, .sound, .list]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        if let deviceId = info["deviceId"] as? String, let threadId = info["threadId"] as? String {
            await MainActor.run {
                if let origin = info["relayOrigin"] as? String, origin != EventWatcher.shared.store?.relayUrl { return }
                if let onOpen { onOpen(deviceId, threadId) } else { pending = (deviceId, threadId) }
            }
        }
    }
}
