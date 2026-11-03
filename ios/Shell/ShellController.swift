import ActivityKit
import AuthenticationServices
import UIKit
import UniformTypeIdentifiers
import UserNotifications
import WebKit

private final class MessageProxy: NSObject, WKScriptMessageHandler {
    weak var owner: ShellController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { owner?.receive(message) }
}

final class NativeWebView: WKWebView {
    override var inputAccessoryView: UIView? { nil }
    // The full-screen SwiftUI host has no inherited safe area; WebKit still
    // needs the physical window insets for the page's CSS env() values.
    var hostSafeArea = UIEdgeInsets.zero
    override var safeAreaInsets: UIEdgeInsets { window?.safeAreaInsets ?? hostSafeArea }
}

@MainActor
final class ShellController: UIViewController, WKNavigationDelegate, WKUIDelegate, ASWebAuthenticationPresentationContextProviding, UIDocumentPickerDelegate, UIScrollViewDelegate {
    #if DEBUG
    private let debugHarness = DebugHarness()
    func runDebugHarness() { loadViewIfNeeded(); debugHarness.run(web: web) }
    #endif
    var hostSafeArea = UIEdgeInsets.zero {
        didSet { web?.hostSafeArea = hostSafeArea; web?.setNeedsLayout() }
    }
    let origin: String
    private let relayOrigin: String
    var onChangeAddress: (() -> Void)?
    private var web: NativeWebView!
    private let proxy = MessageProxy()
    private let live = LiveActivityManager()
    private var auth: ASWebAuthenticationSession?
    private var saveReply: ((Any) -> Void)?
    private var saveURL: URL?
    private var commandReplies: [String: ([String: Any]) -> Void] = [:]
    private var path = "/"
    private var pendingPath: String?
    private var dark: Bool?
    private var offline: UIView?
    private var ready = false
    private var launchLogo: UIImageView?
    private var keyboardVisible = false
    private var fullHeight: NSLayoutConstraint?
    private var documentGeneration = UUID()
    private var commandQueue: [[String: Any]] = []
    private var routeObservation: NSKeyValueObservation?
    static let systemBackground = UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 23/255, green: 23/255, blue: 26/255, alpha: 1) : UIColor(red: 250/255, green: 250/255, blue: 248/255, alpha: 1) }
    override var preferredStatusBarStyle: UIStatusBarStyle { (dark ?? (traitCollection.userInterfaceStyle == .dark)) ? .lightContent : .darkContent }

    init(origin: String, relayOrigin: String) { self.origin = origin; self.relayOrigin = relayOrigin; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override func viewDidLoad() {
        super.viewDidLoad()
        let background = UserDefaults.standard.string(forKey: "shell.background").flatMap(Self.color) ?? Self.systemBackground
        if let savedDark = UserDefaults.standard.object(forKey: "shell.dark") as? Bool {
            dark = savedDark; overrideUserInterfaceStyle = savedDark ? .dark : .light
        }
        view.backgroundColor = background
        let logo = UIImageView(image: UIImage(named: "PockymoeLogo"))
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.layer.cornerRadius = 20; logo.clipsToBounds = true
        view.addSubview(logo)
        NSLayoutConstraint.activate([logo.centerXAnchor.constraint(equalTo: view.centerXAnchor), logo.centerYAnchor.constraint(equalTo: view.centerYAnchor), logo.widthAnchor.constraint(equalToConstant: 88), logo.heightAnchor.constraint(equalToConstant: 88)])
        launchLogo = logo
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        // Encrypted routing needs Service Workers, which iOS only enables for
        // app-bound domains. Self-hosted Web origins must be included at build time.
        configuration.limitsNavigationsToAppBoundDomains = true
        proxy.owner = self
        configuration.userContentController.add(proxy, name: "remoteCodex")
        if let url = Bundle.main.url(forResource: "pockymoe-host", withExtension: "js"), let source = try? String(contentsOf: url), let encoded = Self.json(origin) {
            configuration.userContentController.addUserScript(WKUserScript(source: source.replacingOccurrences(of: "__POCKYMOE_ORIGIN__", with: encoded), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        configuration.userContentController.addUserScript(WKUserScript(source: "if (window === window.top) { const viewport = document.querySelector('meta[name=viewport]'); if (viewport && !viewport.content.includes('viewport-fit')) viewport.content += ', viewport-fit=cover'; }", injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        if let url = Bundle.main.url(forResource: "ios-viewport", withExtension: "js"), let source = try? String(contentsOf: url) {
            configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        web = NativeWebView(frame: .zero, configuration: configuration)
        #if DEBUG
        web.isInspectable = true
        #endif
        web.hostSafeArea = hostSafeArea
        web.isOpaque = false; web.backgroundColor = background; web.scrollView.backgroundColor = background
        web.alpha = 0
        web.navigationDelegate = self; web.uiDelegate = self
        web.allowsLinkPreview = false
        web.scrollView.bounces = false
        web.scrollView.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardDidHideNotification, object: nil)
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.inputAssistantItem.leadingBarButtonGroups = []; web.inputAssistantItem.trailingBarButtonGroups = []
        web.accessibilityIdentifier = "productWebView"
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo: view.topAnchor), web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        let height = web.heightAnchor.constraint(equalToConstant: view.bounds.height)
        height.isActive = true; fullHeight = height
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(backGesture(_:)))
        edge.edges = .left; web.addGestureRecognizer(edge)
        routeObservation = web.observe(\.url, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in self?.rememberRoute() }
        }
        live.onToken = { [weak self] token in self?.command(["type": "liveActivityToken", "token": token]) }
        #if DEBUG
        debugHarness.cancelAuth = { [weak self] in self?.auth?.cancel() }
        debugHarness.inspectPrivacy = {
            let value = ["cachedMetadataCount": ActivityMetadataCache.load().count]
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("privacy-state.json")
            if let data = try? JSONSerialization.data(withJSONObject: value) { try? data.write(to: url, options: .atomic) }
        }
        debugHarness.changeAddress = { [weak self] in self?.changeAddress() }
        debugHarness.retry = { [weak self] in self?.retryLoad() }
        debugHarness.watch(web: web)
        if let state = ProcessInfo.processInfo.environment["E2E_ACTIVITY_STATE"] { Task {
            if UIApplication.shared.applicationState != .active {
                for await _ in NotificationCenter.default.notifications(named: UIApplication.didBecomeActiveNotification) { break }
            }
            await live.drive(state)
            if ProcessInfo.processInfo.environment["E2E_RENDER_ISLANDS"] == "1" { DebugIslandRenderer.renderAll() }
        } }
        #endif
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // SwiftUI may propose a safe-area/keyboard-reduced controller height.
        // Keep the product WebView at the physical window height; WebKit owns
        // the visible viewport when the keyboard appears.
        if let window = view.window {
            fullHeight?.constant = max(0, window.bounds.height - view.convert(.zero, to: window).y)
        }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--debug-harness") {
            let value: [String: Any] = ["webHeight": web.bounds.height, "controllerHeight": view.bounds.height, "windowHeight": view.window?.bounds.height ?? 0, "scrollHeight": web.scrollView.bounds.height, "insetBottom": web.scrollView.contentInset.bottom, "offsetY": web.scrollView.contentOffset.y]
            let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            if let data = try? JSONSerialization.data(withJSONObject: value) { try? data.write(to: directory.appendingPathComponent("native-geometry.json"), options: .atomic) }
        }
        #endif
        if let insets = view.window?.safeAreaInsets, web.hostSafeArea != insets {
            web.hostSafeArea = insets
            web.setNeedsLayout()
        }
    }
    @objc private func keyboardChanged(_ notification: Notification) {
        guard let window = view.window else { return }
        if notification.name == UIResponder.keyboardDidHideNotification { keyboardVisible = false }
        else if let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
            keyboardVisible = window.bounds.intersection(window.convert(frame, from: nil)).height > 100
        }
        // WebKit pans its outer UIScrollView to a focused DOM field even when
        // the SPA has already positioned its composer in the visible viewport.
        // Only inner DOM scrollers should move while the keyboard is present.
        web.scrollView.setContentOffset(.zero, animated: false)
    }
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if keyboardVisible && scrollView.contentOffset != .zero { scrollView.setContentOffset(.zero, animated: false) }
    }
    func navigate(_ route: String) {
        guard route.hasPrefix("/"), !route.hasPrefix("//"), let url = URL(string: origin + route), trusted(url) else { return }
        path = route
        loadViewIfNeeded()
        pendingPath = route
        web.load(URLRequest(url: url))
    }
    func close() {
        NotificationCenter.default.removeObserver(self)
        #if DEBUG
        debugHarness.stop()
        #endif
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "remoteCodex")
        routeObservation = nil; auth?.cancel()
    }
    private func trusted(_ url: URL?) -> Bool { sameOrigin(url, origin: origin) }
    private func sameOrigin(_ url: URL?, origin: String) -> Bool {
        guard let url, let base = URL(string: origin) else { return false }
        return url.scheme == base.scheme && url.host == base.host && (url.port ?? (url.scheme == "http" ? 80 : 443)) == (base.port ?? (base.scheme == "http" ? 80 : 443)) && url.user == nil && url.password == nil
    }
    private func rememberRoute() {
        guard trusted(web.url), let url = web.url else { return }
        path = url.path + (url.query.map { "?" + $0 } ?? "") + (url.fragment.map { "#" + $0 } ?? "")
        UserDefaults.standard.set(path, forKey: "shell.lastPath.\(origin)")
        #if DEBUG
        web.accessibilityValue = path
        #endif
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        guard trusted(url) else {
            decisionHandler(.cancel)
            if action.navigationType == .linkActivated { external(url) }
            return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { if trusted(url) { navigate(url.path + (url.query.map { "?" + $0 } ?? "")) } else { external(url) } }
        return nil
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        ready = false; documentGeneration = UUID(); commandReplies.removeAll()
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { pendingPath = nil; rememberRoute() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showOffline(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showOffline(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { navigate(path) }
    private func showOffline(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled, offline == nil else { return }
        web.alpha = 0
        launchLogo?.isHidden = true
        #if DEBUG
        debugHarness.record(state: "offline", path: path)
        #endif
        let label = UILabel(); label.text = "无法连接服务"; label.textColor = UserDefaults.standard.string(forKey: "shell.foreground").flatMap(Self.color) ?? .label
        let retry = UIButton(type: .system); retry.setTitle("重试", for: .normal); retry.accessibilityIdentifier = "retryConnection"
        retry.configuration = .filled()
        retry.tintColor = UserDefaults.standard.string(forKey: "shell.accent").flatMap(Self.color) ?? .systemTeal
        retry.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        retry.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)
        let change = UIButton(type: .system); change.setTitle("更改地址", for: .normal)
        change.tintColor = retry.tintColor
        change.accessibilityIdentifier = "changeAddress"
        change.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        change.addTarget(self, action: #selector(changeAddress), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [label, retry, change]); stack.axis = .vertical; stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: view.centerXAnchor), stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
        offline = stack
    }
    @objc private func changeAddress() { live.clear(); onChangeAddress?() }
    @objc private func retryLoad() { offline?.removeFromSuperview(); offline = nil; navigate(path) }
    @objc private func backGesture(_ gesture: UIScreenEdgePanGestureRecognizer) {
        let x = max(0, gesture.translation(in: web).x)
        if gesture.state == .changed { web.transform = CGAffineTransform(translationX: min(view.bounds.width, x), y: 0) }
        if [.ended, .cancelled, .failed].contains(gesture.state) {
            UIView.animate(withDuration: 0.12) { self.web.transform = .identity }
            if gesture.state == .ended && (x > view.bounds.width * 0.28 || gesture.velocity(in: web).x > 700) {
                command(["type": "back"]) { _ in /* Web owns modal and route ordering, including the root. */ }
            }
        }
    }
    private func external(_ url: URL) {
        guard ["https", "http", "mailto", "tel"].contains(url.scheme ?? ""), url.user == nil, url.password == nil else { return }
        UIApplication.shared.open(url)
    }
    private func command(_ body: [String: Any], completion: (([String: Any]) -> Void)? = nil) {
        var value = body; let id = UUID().uuidString; value["id"] = id
        if let completion {
            commandReplies[id] = completion
            Task { try? await Task.sleep(for: .seconds(5)); commandReplies.removeValue(forKey: id)?(["ok": false]) }
        }
        if !ready { commandQueue.append(value); return }
        evaluate("window.__pockymoeCommand(\(Self.json(value) ?? "{}"))")
    }
    private func evaluate(_ source: String) {
        guard trusted(web.url) else { return }
        web.evaluateJavaScript(source, completionHandler: nil)
    }
    func receive(_ message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url), trusted(web.url),
              let body = message.body as? [String: Any], let method = body["method"] as? String else { return }
        let args = body["args"] as? [Any] ?? []
        let id = body["id"] as? String
        // A reply belongs to the requesting document, never a later navigation.
        let generation = documentGeneration
        let reply: (Any) -> Void = { [weak self] value in
            guard let self, let id, self.documentGeneration == generation else { return }
            self.evaluate("window.__pockymoeReply(\(Self.json(id) ?? "null"),\(Self.json(value) ?? "null"))")
        }
        let reject: (String) -> Void = { [weak self] error in
            guard let self, let id, self.documentGeneration == generation else { return }
            self.evaluate("window.__pockymoeReply(\(Self.json(id) ?? "null"),null,\(Self.json(error) ?? "null"))")
        }
        switch method {
        case "firstFrame":
            guard offline == nil else { return }
            #if DEBUG
            debugHarness.record(state: "online", path: path)
            #endif
            UIView.animate(withDuration: 0.12, animations: { self.web.alpha = 1; self.launchLogo?.alpha = 0 }) { _ in
                self.launchLogo?.removeFromSuperview(); self.launchLogo = nil
            }
        case "ready":
            ready = true
            let queue = commandQueue; commandQueue = []
            for value in queue { evaluate("window.__pockymoeCommand(\(Self.json(value) ?? "{}"))") }
            live.resendToken()
        case "capabilities":
            reply(["surface": "mobile", "platform": "ios", "bridgeVersion": 2, "shellVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0", "liveActivity": ActivityAuthorizationInfo().areActivitiesEnabled, "nativePush": Bundle.main.object(forInfoDictionaryKey: "PockymoeNativePush") as? Bool ?? false, "haptics": true])
        case "session.clear":
            live.clear()
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--debug-harness") {
                let result: [String: Any] = ["metadataEmpty": ActivityMetadataCache.load().isEmpty, "policyRemoved": UserDefaults.standard.object(forKey: "shell.activityPolicy") == nil, "legacyTokenRemoved": UserDefaults.standard.object(forKey: "relay_token") == nil]
                let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                if let data = try? JSONSerialization.data(withJSONObject: result) { try? data.write(to: directory.appendingPathComponent("session-cleanup.json"), options: .atomic) }
            }
            #endif
        case "activity.sync":
            #if DEBUG
            if ProcessInfo.processInfo.environment["E2E_ACTIVITY_STATE"] != nil { return }
            #endif
            if let raw = args.first, let data = try? JSONSerialization.data(withJSONObject: raw), let snapshot = try? JSONDecoder().decode(ActivitySnapshot.self, from: data) { Task { await live.sync(snapshot) } }
        case "commandResult":
            if args.count == 2, let key = args[0] as? String, let result = args[1] as? [String: Any] { commandReplies.removeValue(forKey: key)?(result) }
        case "window.openThread": if let path = args.first as? String { command(["type": "navigate", "path": path]) }
        case "window.setTitle": title = args.first as? String
        case "settings.get": reply(settings())
        case "settings.set":
            if let patch = args.first as? [String: Any] {
                var values = settings()
                // Keep the configured origin immutable to the page; never expose native session data.
                for key in ["alertMode", "snoozeUntil"] { if let value = patch[key] { values[key] = value } }
                UserDefaults.standard.set(values, forKey: "shell.pageSettings")
            }
            reply(settings())
        case "badge.set":
            if let count = args.first as? Int { UNUserNotificationCenter.current().setBadgeCount(max(0, count)) }
        case "appearance.sync": if let appearance = args.first as? [String: Any] { syncAppearance(appearance) }
        case "shell.openExternal": if let raw = args.first as? String, let url = URL(string: raw) { external(url) }
        case "auth.openExternal":
            #if DEBUG
            let authRecord: (String) -> Void = { stage in
                guard ProcessInfo.processInfo.arguments.contains("--debug-harness") else { return }
                let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("auth-state.json")
                if let data = try? JSONSerialization.data(withJSONObject: ["stage": stage]) { try? data.write(to: url, options: .atomic) }
            }
            #endif
            guard let raw = args.first as? String, let url = URL(string: raw),
                  SystemAuthPolicy.allows(url, service: origin, relay: relayOrigin) else { reject("登录地址不属于已配置的服务"); return }
            guard auth == nil else { reject("登录页面已打开"); return }
            auth = ASWebAuthenticationSession(url: url, callbackURLScheme: "remotecodex") { [weak self] callback, error in
                Task { @MainActor in
                    self?.auth = nil
                    #if DEBUG
                    authRecord(callback == nil ? "closed" : "callback")
                    #endif
                    if let callback { reply(["callbackUrl": callback.absoluteString]) }
                    else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { reply(NSNull()) }
                    else { reject("系统登录未完成，请重试") }
                }
            }
            auth?.presentationContextProvider = self
            let started = auth?.start() == true
            if !started { auth = nil; reject("无法打开系统登录页面，请重试") }
            #if DEBUG
            if started { authRecord("started") }
            #endif
        case "push.register":
            guard Bundle.main.object(forInfoDictionaryKey: "PockymoeNativePush") as? Bool == true else { reply(NSNull()); return }
            Task {
                guard let token = await NativePush.shared.register() else { reply(NSNull()); return }
                #if DEBUG
                let sandbox = true
                #else
                let sandbox = false
                #endif
                reply(["token": token, "sandbox": sandbox, "kind": "ios"])
            }
        case "haptics.play":
            switch args.first as? String {
            case "sent": UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case "attention": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            default: break
            }
        case "files.saveAs":
            guard args.count == 2, let name = args[0] as? String, let bytes = args[1] as? [UInt8], bytes.count <= 32 * 1024 * 1024, saveReply == nil else { reply(["saved": false]); return }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let filename = URL(fileURLWithPath: name).lastPathComponent
                let url = directory.appendingPathComponent(filename.isEmpty ? "export" : filename)
                try Data(bytes).write(to: url)
                saveURL = directory; saveReply = reply
                let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
                picker.delegate = self; present(picker, animated: true)
            } catch { reply(["saved": false]) }
        default: break
        }
    }
    private func settings() -> [String: Any] {
        var value = UserDefaults.standard.dictionary(forKey: "shell.pageSettings") ?? [:]
        value["webOrigin"] = origin; value["relayOrigin"] = relayOrigin
        value["petVisible"] = false
        return value
    }
    private func syncAppearance(_ appearance: [String: Any]) {
        dark = (appearance["effective"] as? String) == "dark"
        overrideUserInterfaceStyle = dark == true ? .dark : .light
        setNeedsStatusBarAppearanceUpdate()
        UserDefaults.standard.set(dark, forKey: "shell.dark")
        let generation = documentGeneration
        // Convert the actual Web theme tokens (including CSS Color 4) to sRGB
        // for the local screens and the next launch, without recreating a theme.
        let resolveColors = """
        (() => {
          const surface = [...document.querySelectorAll('.thread-ui-shell, .auth-shell')].find(node => node.getClientRects().length) || document.documentElement;
          const style = getComputedStyle(surface);
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d');
          const colors = {};
          for (const [name, token] of Object.entries({background:'--app-bg', foreground:'--theme-fg', panel:'--theme-panel', border:'--theme-border', accent:'--theme-accent-solid', accentForeground:'--theme-accent-solid-fg'})) {
            const value = style.getPropertyValue(token).trim();
            if (!value || !CSS.supports('color', value)) continue;
            context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
            const pixel = context.getImageData(0, 0, 1, 1).data;
            if (pixel[3]) colors[name] = '#' + [...pixel.slice(0, 3)].map(n => n.toString(16).padStart(2, '0')).join('');
          }
          return colors;
        })()
        """
        web.evaluateJavaScript(resolveColors) { [weak self] value, _ in
            guard let self, self.documentGeneration == generation, let colors = value as? [String: String] else { return }
            for (name, raw) in colors where Self.color(raw) != nil { UserDefaults.standard.set(raw, forKey: "shell." + name) }
            if let raw = colors["background"] { self.applyBackground(raw) }
        }
    }

    private func applyBackground(_ raw: String) {
        guard let color = Self.color(raw) else { return }
        view.backgroundColor = color; web.backgroundColor = color; web.scrollView.backgroundColor = color
        UserDefaults.standard.set(raw, forKey: "shell.background")
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { view.window ?? ASPresentationAnchor() }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finishSave(false) }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finishSave(!urls.isEmpty) }
    private func finishSave(_ saved: Bool) {
        saveReply?(["saved": saved]); saveReply = nil
        if let saveURL { try? FileManager.default.removeItem(at: saveURL) }; saveURL = nil
    }
    static func json(_ value: Any) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]) else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func color(_ raw: String) -> UIColor? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#"), value.count == 7, let number = UInt(value.dropFirst(), radix: 16) {
            return UIColor(red: CGFloat((number >> 16) & 255)/255, green: CGFloat((number >> 8) & 255)/255, blue: CGFloat(number & 255)/255, alpha: 1)
        }
        if value.hasPrefix("rgb"), let start = value.firstIndex(of: "("), let end = value.firstIndex(of: ")") {
            let parts = value[value.index(after: start)..<end].split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            if parts.count >= 4 && parts[3] == 0 { return nil }
            if parts.count >= 3 { return UIColor(red: parts[0]/255, green: parts[1]/255, blue: parts[2]/255, alpha: 1) }
        }
        return nil
    }
}
