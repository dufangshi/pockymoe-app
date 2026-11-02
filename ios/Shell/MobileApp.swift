import SwiftUI
import UserNotifications

@main
struct RemoteCodexApp: App {
    @UIApplicationDelegateAdaptor(NativeAppDelegate.self) private var delegate
    @StateObject private var model = ShellModel()
    var body: some Scene {
        WindowGroup {
            ShellView(model: model).ignoresSafeArea()
                .onOpenURL { model.open($0) }
        }
    }
}

@MainActor
final class ShellModel: ObservableObject {
    @Published var origin: String
    var controller: ShellController?
    private var pendingPath: String?
    init() {
        origin = (UserDefaults.standard.string(forKey: "relay_url").flatMap(Self.validOrigin))?.absoluteString ?? ""
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitesting") {
            origin = (ProcessInfo.processInfo.environment["E2E_RELAY_URL"].flatMap(Self.validOrigin))?.absoluteString ?? ""
        }
        #endif
        NotificationDelegate.shared.open = { [weak self] path, relay in
            guard let self, relay == nil || relay.flatMap(Self.validOrigin)?.absoluteString == self.origin else { return }
            self.pendingPath = path
            self.controller?.navigate(path)
        }
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    }
    func connect(_ raw: String) -> Bool {
        guard let url = Self.validOrigin(raw) else { return false }
        origin = url.absoluteString
        UserDefaults.standard.set(origin, forKey: "relay_url")
        return true
    }
    static func validOrigin(_ raw: String) -> URL? {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.host != nil, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, ["", "/"].contains(url.path) else { return nil }
        if url.scheme != "https" {
            #if DEBUG
            guard url.scheme == "http", ["localhost", "127.0.0.1", "::1"].contains(url.host!) else { return nil }
            #else
            return nil
            #endif
        }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.scheme = url.scheme?.lowercased()
        components?.host = url.host?.lowercased()
        components?.path = ""
        if url.port == (url.scheme == "https" ? 443 : 80) { components?.port = nil }
        return components?.url
    }
    func attach(_ controller: ShellController) {
        self.controller = controller
        controller.navigate(pendingPath ?? UserDefaults.standard.string(forKey: "shell.lastPath.\(origin)") ?? "/")
        pendingPath = nil
    }
    func open(_ url: URL) {
        guard url.scheme == "remotecodex", url.host == "devices" else { return }
        let path = "/devices" + url.path
        pendingPath = path
        controller?.navigate(path)
    }
}

struct ShellView: View {
    @ObservedObject var model: ShellModel
    @State private var address = "https://app.lnz-study.com"
    @State private var invalid = false
    var body: some View {
        if model.origin.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                Text("连接 Relay").font(.headline)
                TextField("Relay 地址", text: $address).textContentType(.URL).keyboardType(.URL)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(12).overlay(RoundedRectangle(cornerRadius: 8).stroke(.secondary))
                    .accessibilityIdentifier("relayAddress")
                if invalid { Text("请输入有效的 HTTPS 地址").foregroundStyle(.red) }
                Button("连接") { invalid = !model.connect(address) }.frame(minHeight: 44).accessibilityIdentifier("connectRelay")
            }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(uiColor: ShellController.systemBackground))
        } else { ShellWebView(model: model).id(model.origin) }
    }
}

struct ShellWebView: UIViewControllerRepresentable {
    let model: ShellModel
    func makeUIViewController(context: Context) -> ShellController {
        let controller = ShellController(origin: model.origin)
        model.attach(controller)
        return controller
    }
    func updateUIViewController(_ controller: ShellController, context: Context) {}
    static func dismantleUIViewController(_ controller: ShellController, coordinator: ()) { controller.close() }
}

final class NativeAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NativePush.shared.finish(deviceToken.map { String(format: "%02x", $0) }.joined())
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NativePush.shared.finish(nil)
    }
}

@MainActor
final class NativePush {
    static let shared = NativePush()
    private var token: String?
    private var pending: [CheckedContinuation<String?, Never>] = []
    func register() async -> String? {
        guard (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) == true else { return nil }
        if let token { return token }
        return await withCheckedContinuation { continuation in
            pending.append(continuation)
            UIApplication.shared.registerForRemoteNotifications()
            Task { try? await Task.sleep(for: .seconds(20)); finish(nil) }
        }
    }
    func finish(_ value: String?) {
        if let value { token = value }
        let waiting = pending; pending = []
        waiting.forEach { $0.resume(returning: value) }
    }
}

final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()
    private var pending: (String, String?)?
    var open: ((String, String?) -> Void)? {
        didSet { if let pending { self.pending = nil; open?(pending.0, pending.1) } }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [] }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard let device = info["deviceId"] as? String, let thread = info["threadId"] as? String else { return }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        guard let d = device.addingPercentEncoding(withAllowedCharacters: allowed), let t = thread.addingPercentEncoding(withAllowedCharacters: allowed) else { return }
        let path = "/devices/\(d)/threads/\(t)"
        await MainActor.run {
            let relay = info["relayOrigin"] as? String
            if let open { open(path, relay) } else { pending = (path, relay) }
        }
    }
}
