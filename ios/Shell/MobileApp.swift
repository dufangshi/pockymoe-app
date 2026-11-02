import SwiftUI
import UserNotifications

@main
struct RemoteCodexApp: App {
    @UIApplicationDelegateAdaptor(NativeAppDelegate.self) private var delegate
    @StateObject private var model = ShellModel()
    var body: some Scene {
        WindowGroup {
            GeometryReader { geometry in
                ShellView(model: model, safeArea: geometry.safeAreaInsets).ignoresSafeArea()
            }
            .onOpenURL { model.open($0) }
        }
    }
}

@MainActor
final class ShellModel: ObservableObject {
    @Published var origin: String
    @Published var relayOrigin: String
    var controller: ShellController?
    private var pendingPath: String?
    init() {
        let stored = ServiceConfiguration.stored(in: .standard)
        origin = stored?.webOrigin ?? ""
        relayOrigin = stored?.relayOrigin ?? ""
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitesting") {
            origin = (ProcessInfo.processInfo.environment["E2E_RELAY_URL"].flatMap(Self.validOrigin))?.absoluteString ?? ""
            relayOrigin = origin
        }
        #endif
        NotificationDelegate.shared.open = { [weak self] path, relay in
            guard let self, relay == nil || relay.flatMap(Self.validOrigin)?.absoluteString == self.relayOrigin else { return }
            self.pendingPath = path
            self.controller?.navigate(path)
        }
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    }
    func connect(_ raw: String, relay: String) -> Bool {
        guard let configuration = ServiceConfiguration(service: raw, relay: relay) else { return false }
        configuration.save(in: .standard)
        relayOrigin = configuration.relayOrigin
        origin = configuration.webOrigin
        return true
    }
    static func validOrigin(_ raw: String) -> URL? { ServiceConfiguration.validOrigin(raw) }
    func attach(_ controller: ShellController) {
        self.controller = controller
        controller.navigate(pendingPath ?? UserDefaults.standard.string(forKey: "shell.lastPath.\(origin)") ?? "/")
        pendingPath = nil
    }
    func open(_ url: URL) {
        #if DEBUG
        if url.scheme == "remotecodex", url.host == "debug", ProcessInfo.processInfo.arguments.contains("--debug-harness") {
            controller?.runDebugHarness(); return
        }
        #endif
        guard url.scheme == "remotecodex", url.host == "devices" else { return }
        let path = "/devices" + url.path
        pendingPath = path
        controller?.navigate(path)
    }
}

struct ShellView: View {
    @ObservedObject var model: ShellModel
    let safeArea: EdgeInsets
    @State private var address = ""
    @State private var relayAddress = ""
    @State private var advanced = false
    @State private var invalid = false
    var body: some View {
        if model.origin.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                Text("连接服务").font(.headline)
                TextField("https://app.example.com", text: $address).textContentType(.URL).keyboardType(.URL)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(12).overlay(RoundedRectangle(cornerRadius: 8).stroke(.secondary))
                    .accessibilityIdentifier("serviceAddress")
                DisclosureGroup("高级", isExpanded: $advanced) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("单独的 Relay 地址").font(.subheadline)
                        TextField("留空以使用服务地址", text: $relayAddress)
                            .textContentType(.URL).keyboardType(.URL)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .padding(12).overlay(RoundedRectangle(cornerRadius: 8).stroke(.secondary))
                           .accessibilityIdentifier("separateRelayAddress")
                    }.padding(.top, 8)
                }
                if invalid { Text("请输入有效的 HTTPS 地址").foregroundStyle(.red) }
                Button("连接") { invalid = !model.connect(address, relay: relayAddress) }.frame(minHeight: 44).accessibilityIdentifier("connectRelay")
            }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(uiColor: ShellController.systemBackground))
                #if DEBUG
                .onAppear { advanced = ProcessInfo.processInfo.arguments.contains("--debug-connection-advanced") }
                #endif
        } else { ShellWebView(model: model, safeArea: safeArea).id(model.origin) }
    }
}

struct ShellWebView: UIViewControllerRepresentable {
    let model: ShellModel
    let safeArea: EdgeInsets
    func makeUIViewController(context: Context) -> ShellController {
        let controller = ShellController(origin: model.origin, relayOrigin: model.relayOrigin)
        controller.hostSafeArea = UIEdgeInsets(top: safeArea.top, left: safeArea.leading, bottom: safeArea.bottom, right: safeArea.trailing)
        model.attach(controller)
        return controller
    }
    func updateUIViewController(_ controller: ShellController, context: Context) { controller.hostSafeArea = UIEdgeInsets(top: safeArea.top, left: safeArea.leading, bottom: safeArea.bottom, right: safeArea.trailing) }
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
