import SwiftUI
import UserNotifications

@main
struct RemoteCodexApp: App {
    @UIApplicationDelegateAdaptor(NativeAppDelegate.self) private var delegate
    @StateObject private var model = ShellModel()
    var body: some Scene {
        WindowGroup {
            GeometryReader { geometry in
                ShellView(model: model, safeArea: geometry.safeAreaInsets)
            }
            .ignoresSafeArea(.container)
            .ignoresSafeArea(.keyboard, edges: model.origin.isEmpty ? [] : .bottom)
            .onOpenURL { model.open($0) }
            .task { await model.prepare() }
        }
    }
}

@MainActor
final class ShellModel: ObservableObject {
    @Published var origin = ""
    @Published var relayOrigin = ""
    @Published var serviceInput = ""
    @Published var relayInput = ""
    @Published var errorMessage: String?
    @Published var busy = false
    @Published var silentProbe = false
    var controller: ShellController?
    private var pendingPath: String?
    private var started = false
    private var legacyProbe = false
    #if DEBUG
    private var debugConnect = false
    #endif
    private var revocation: LegacySessionCleanup.Revocation?
    private let probe = ConnectionProbe(fetch: ConnectionProbeTransport.fetch)

    init() {
        let defaults = UserDefaults.standard
        #if DEBUG
        var debugFixture: [String: Any]?
        if ProcessInfo.processInfo.arguments.contains("--debug-setup-fixture") {
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("setup-fixture.json")
            if let data = try? Data(contentsOf: url), let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                debugFixture = fixture
                debugConnect = fixture["pair"] as? Bool != true
                serviceInput = fixture["service"] as? String ?? ""
                relayInput = fixture["relay"] as? String ?? ""
                defaults.removeObject(forKey: "shell.connectionProbeAttempted")
                defaults.removeObject(forKey: "shell.connectionProbeError")
                if fixture["legacy"] as? Bool == true || fixture["pair"] as? Bool == true {
                    defaults.set(serviceInput, forKey: "relay_url")
                    if let token = fixture["legacyToken"] as? String { defaults.set(token, forKey: "relay_token") }
                    if fixture["legacy"] as? Bool == true { defaults.removeObject(forKey: "shell.relayOrigin") }
                    else { defaults.set(relayInput.isEmpty ? serviceInput : relayInput, forKey: "shell.relayOrigin") }
                } else {
                    defaults.removeObject(forKey: "relay_url")
                    defaults.removeObject(forKey: "shell.relayOrigin")
                }
            }
        }
        #endif
        revocation = LegacySessionCleanup.take(from: defaults)
        serviceInput = defaults.string(forKey: "relay_url") ?? ""
        relayInput = defaults.string(forKey: "shell.relayOrigin") ?? ""
        let embedded = ServiceConfiguration.embedded(in: Bundle.main.infoDictionary ?? [:])
        if let initial = ServiceConfiguration.initial(in: defaults, embedded: embedded),
           initial != ServiceConfiguration.stored(in: defaults) {
            initial.save(in: defaults)
            serviceInput = initial.webOrigin; relayInput = initial.relayOrigin
        }
        if let stored = ServiceConfiguration.stored(in: defaults), let savedRelay = defaults.string(forKey: "shell.relayOrigin"), !savedRelay.isEmpty {
            origin = stored.webOrigin; relayOrigin = stored.relayOrigin
        } else if !serviceInput.isEmpty {
            if !defaults.bool(forKey: "shell.connectionProbeAttempted") { legacyProbe = true; silentProbe = true }
            else { errorMessage = defaults.string(forKey: "shell.connectionProbeError") }
        }
        #if DEBUG
        if let fixture = debugFixture, fixture["legacy"] as? Bool != true, fixture["pair"] as? Bool != true {
            origin = ""; relayOrigin = ""
            serviceInput = fixture["service"] as? String ?? ""
            relayInput = fixture["relay"] as? String ?? ""
        }
        if ProcessInfo.processInfo.arguments.contains("--uitesting") {
            origin = (ProcessInfo.processInfo.environment["E2E_RELAY_URL"].flatMap(ServiceConfiguration.validOrigin))?.absoluteString ?? ""
            relayOrigin = ProcessInfo.processInfo.environment["E2E_SEPARATE_RELAY_URL"] ?? origin
        }
        #endif
        NotificationDelegate.shared.open = { [weak self] path, relay in
            guard let self, relay == nil || relay.flatMap(ServiceConfiguration.validOrigin)?.absoluteString == self.relayOrigin else { return }
            self.pendingPath = path; self.controller?.navigate(path)
        }
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    }
    func prepare() async {
        guard !started else { return }; started = true
        if let revocation { Task { await LegacySessionRevoker.revoke(revocation) }; self.revocation = nil }
        if legacyProbe {
            UserDefaults.standard.set(true, forKey: "shell.connectionProbeAttempted")
            await connect()
            silentProbe = false
        }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--debug-setup-fixture") && debugConnect && !legacyProbe { await connect() }
        recordDebugSetup()
        #endif
    }
    func connect() async {
        guard !busy else { return }; busy = true; errorMessage = nil
        defer { busy = false }
        do {
            let configuration = try await probe.discover(service: serviceInput, relay: relayInput)
            let hosts = Bundle.main.object(forInfoDictionaryKey: "WKAppBoundDomains") as? [String] ?? []
            guard let host = URL(string: configuration.webOrigin)?.host, hosts.contains(host) else { throw ConnectionFailure.unsupportedHost }
            configuration.save(in: .standard)
            UserDefaults.standard.removeObject(forKey: "shell.connectionProbeError")
            relayOrigin = configuration.relayOrigin; origin = configuration.webOrigin
            serviceInput = configuration.webOrigin; relayInput = configuration.relayOrigin
            #if DEBUG
            recordDebugSetup()
            #endif
        } catch { errorMessage = error.localizedDescription
            if legacyProbe { UserDefaults.standard.set(error.localizedDescription, forKey: "shell.connectionProbeError") }
            #if DEBUG
            recordDebugSetup()
            #endif
        }
    }
    func changeAddress() {
        serviceInput = origin; relayInput = relayOrigin
        controller = nil; origin = ""; errorMessage = nil
        #if DEBUG
        recordDebugSetup()
        #endif
    }
    func attach(_ controller: ShellController) {
        self.controller = controller
        controller.onChangeAddress = { [weak self] in self?.changeAddress() }
        controller.navigate(pendingPath ?? UserDefaults.standard.string(forKey: "shell.lastPath.\(origin)") ?? "/")
        pendingPath = nil
    }
    func open(_ url: URL) {
        #if DEBUG
        if url.scheme == "remotecodex", url.host == "debug", ProcessInfo.processInfo.arguments.contains("--debug-harness") { controller?.runDebugHarness(); return }
        #endif
        guard url.scheme == "remotecodex", url.host == "devices" else { return }
        let path = "/devices" + url.path
        pendingPath = path; controller?.navigate(path)
    }
    #if DEBUG
    private func recordDebugSetup() {
        guard ProcessInfo.processInfo.arguments.contains("--debug-setup-fixture") || ProcessInfo.processInfo.arguments.contains("--debug-record-setup") else { return }
        let result: [String: Any] = ["webOrigin": origin, "relayOrigin": relayOrigin, "input": serviceInput, "error": errorMessage ?? "", "legacyProbe": legacyProbe, "savedWeb": UserDefaults.standard.string(forKey: "relay_url") ?? "", "legacyTokenRemoved": UserDefaults.standard.object(forKey: "relay_token") == nil]
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        if let data = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted) { try? data.write(to: directory.appendingPathComponent("setup-result.json"), options: .atomic) }
    }
    #endif
}

struct ShellView: View {
    @ObservedObject var model: ShellModel
    let safeArea: EdgeInsets
    @State private var advanced = false
    var body: some View {
        if model.silentProbe { Color(uiColor: ShellController.systemBackground) }
        else if model.origin.isEmpty {
            GeometryReader { bounds in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Image("PockymoeLogo").resizable().frame(width: 64, height: 64)
                            .clipShape(RoundedRectangle(cornerRadius: 16)).frame(maxWidth: .infinity)
                        Text("连接服务").font(.title2.weight(.semibold)).frame(maxWidth: .infinity)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("服务地址").font(.subheadline.weight(.medium))
                            addressField("https://app.example.com", text: $model.serviceInput, id: "serviceAddress")
                        }
                        DisclosureGroup("高级", isExpanded: $advanced) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("单独的 Relay 地址").font(.subheadline)
                                addressField("留空以使用服务地址", text: $model.relayInput, id: "separateRelayAddress")
                            }.padding(.top, 12)
                        }.tint(palette("foreground", fallback: .label))
                        if let error = model.errorMessage { Text(error).font(.footnote).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently) }
                        Button { Task { await model.connect() } } label: {
                            HStack {
                                if model.busy { ProgressView().tint(.white) }
                                Text(model.busy ? "正在连接…" : "连接").fontWeight(.semibold)
                            }.frame(maxWidth: .infinity, minHeight: 48)
                        }.buttonStyle(.borderedProminent).tint(palette("accent", fallback: .systemTeal))
                            .foregroundStyle(palette("accentForeground", fallback: .white))
                            .disabled(model.busy).accessibilityIdentifier("connectRelay")
                    }
                    .padding(24).frame(maxWidth: 448)
                    .frame(maxWidth: .infinity, minHeight: max(0, bounds.size.height - safeArea.top - safeArea.bottom))
                }.safeAreaPadding(.top, safeArea.top).safeAreaPadding(.bottom, safeArea.bottom)
            }
            .foregroundStyle(palette("foreground", fallback: .label))
            .background(palette("background", fallback: ShellController.systemBackground))
            .preferredColorScheme((UserDefaults.standard.object(forKey: "shell.dark") as? Bool).map { $0 ? .dark : .light })
                #if DEBUG
                .onAppear { advanced = ProcessInfo.processInfo.arguments.contains("--debug-connection-advanced") }
                #endif
        } else { ShellWebView(model: model, safeArea: safeArea).ignoresSafeArea(.keyboard).id(model.origin) }
    }
    private func palette(_ key: String, fallback: UIColor) -> Color {
        Color(uiColor: UserDefaults.standard.string(forKey: "shell." + key).flatMap(ShellController.color) ?? fallback)
    }
    private func addressField(_ placeholder: String, text: Binding<String>, id: String) -> some View {
        TextField(placeholder, text: text).textContentType(.URL).keyboardType(.URL)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(12).frame(minHeight: 48)
            .background(palette("panel", fallback: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(palette("border", fallback: .separator)))
            .accessibilityIdentifier(id)
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
