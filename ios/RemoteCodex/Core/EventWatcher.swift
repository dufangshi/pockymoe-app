import BackgroundTasks
import CryptoKit
import Foundation
import UIKit
import UserNotifications

// Durable relay events survive encrypted device connections, reconnects and app restarts.
// Polling is a foreground fallback; APNs is responsible for suspended-app delivery.
final class EventWatcher {
    static let shared = EventWatcher()
    static let backgroundTaskId = "com.remotecodex.app.watch"
    var store: SessionStore?
    var isForeground = true { didSet { refresh() } }
    // Only a page that explicitly owns notification delivery may suppress the fallback.
    var webDeliversEvents = false { didSet { refresh() } }
    var openThread: (deviceId: String, threadId: String)?
    var onBanner: ((String, String, String, String) -> Void)?
    private var polling: Task<Void, Never>?
    private var enabled = false
    private var inFlight = false
    private var pollDelay: UInt64 = 4
    private var generation = 0
    private var pollIdentity = ""
    private var needsPolling: Bool {
        guard let store, store.isSignedIn else { return false }
        return enabled && isForeground && !webDeliversEvents && NativePush.shared.registeredSession != store.relayUrl + "|" + store.token
    }
    func registerBackgroundTasks() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.backgroundTaskId, using: .main) { [weak self] task in
            let work = Task { @MainActor in await self?.tick(background: true); task.setTaskCompleted(success: !Task.isCancelled) }
            task.expirationHandler = { work.cancel() }
            self?.scheduleBackgroundRefresh()
        }
    }
    func scheduleBackgroundRefresh() {
        guard let store, store.isSignedIn, NativePush.shared.registeredSession != store.relayUrl + "|" + store.token else { return }
        let task = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskId)
        task.earliestBeginDate = Date(timeIntervalSinceNow: 60)
        try? BGTaskScheduler.shared.submit(task)
    }
    func start() {
        enabled = true
        // First signed-in start asks for notifications; later calls return at once.
        requestPermission()
        NativePush.shared.register()
        refresh()
    }
    private func cancelPolling() {
        generation += 1
        polling?.cancel()
        polling = nil
    }
    func stop() {
        enabled = false
        cancelPolling()
        pollIdentity = ""
        NativePush.shared.registeredSession = nil
    }
    func refresh() {
        let identity = (store?.relayUrl ?? "") + "|" + (store?.token ?? "")
        if identity != pollIdentity {
            cancelPolling()
            pollIdentity = identity
            pollDelay = 4
        }
        guard needsPolling else { cancelPolling(); return }
        guard polling == nil else { return }
        let current = generation
        polling = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self, self.generation == current, self.needsPolling else { break }
                NativePush.shared.register()
                let delivered = await self.tick()
                guard !Task.isCancelled, self.generation == current, self.needsPolling else { break }
                // Idle feeds and failures back off; new fallback alerts restore responsiveness.
                self.pollDelay = delivered ? 4 : min(self.pollDelay * 2, 60)
                do { try await Task.sleep(nanoseconds: self.pollDelay * 1_000_000_000) } catch { break }
            }
        }
    }
    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { allowed, _ in
            if allowed { DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() } }
        }
    }
    @MainActor @discardableResult private func tick(background: Bool = false) async -> Bool {
        guard !inFlight, !Task.isCancelled, let store, store.isSignedIn,
              NativePush.shared.registeredSession != store.relayUrl + "|" + store.token,
              background || needsPolling else { return false }
        inFlight = true
        defer { inFlight = false }
        let origin = store.relayUrl, token = store.token
        let identity = origin + "|" + token
        let key = "native-notifications." + SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        let defaults = UserDefaults.standard
        let since = defaults.object(forKey: key + ".since") as? Date ?? Date()
        if defaults.object(forKey: key + ".since") == nil { defaults.set(since, forKey: key + ".since") }
        guard let url = URL(string: origin + "/relay/account/workbench") else { return false }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard !Task.isCancelled, (background || needsPolling), (response as? HTTPURLResponse)?.statusCode == 200, origin == store.relayUrl, token == store.token,
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any], let events = body["notifications"] as? [[String: Any]] else { return false }
            var seen = Set(defaults.stringArray(forKey: key + ".seen") ?? [])
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            var delivered = false
            for event in events.reversed() {
                guard !Task.isCancelled, (background || needsPolling), origin == store.relayUrl, token == store.token else { return false }
                guard let id = event["id"] as? String, !seen.contains(id), let raw = event["occurredAt"] as? String,
                      let date = Self.date(raw), let path = event["href"] as? String, let link = URL(string: origin + path),
                      case .threadDetail(let device, let thread, _) = nativeRoute(for: link, deviceId: "") else { continue }
                if date < since { seen.insert(id); continue }
                if isForeground && openThread?.deviceId == device && openThread?.threadId == thread { seen.insert(id); continue }
                if NativePush.shared.registeredSession == identity { return false }
                guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { continue }
                let content = UNMutableNotificationContent()
                content.title = event["title"] as? String ?? "Thread completed"
                content.body = event["summary"] as? String ?? "Agent run finished. Tap to open this thread."
                content.sound = .default
                content.threadIdentifier = "\(device):\(thread)"
                content.userInfo = ["deviceId": device, "threadId": thread, "eventId": id, "relayOrigin": origin]
                try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
                seen.insert(id)
                delivered = true
            }
            let retained = seen.intersection(events.compactMap { $0["id"] as? String })
            if retained != Set(defaults.stringArray(forKey: key + ".seen") ?? []) {
                defaults.set(Array(retained), forKey: key + ".seen")
            }
            return delivered
        } catch { /* Retry the durable feed with backoff; never advance on failure. */ }
        return false
    }
    func isRecent(_ value: String?) -> Bool {
        guard let value, let date = Self.date(value) else { return false }
        return (0..<30).contains(Date().timeIntervalSince(date))
    }
    private static let fractionalDate: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let wholeDate = ISO8601DateFormatter()
    private static func date(_ raw: String) -> Date? {
        fractionalDate.date(from: raw) ?? wholeDate.date(from: raw)
    }
}

final class NativePush {
    static let shared = NativePush()
    var registeredSession: String? { didSet { if oldValue != registeredSession { EventWatcher.shared.refresh() } } }
    var token = "" { didSet { if token != oldValue { registeredSession = nil }; register() } }
    private var registering = false
    func register() {
        guard !registering, !token.isEmpty, let store = EventWatcher.shared.store, store.isSignedIn else { return }
        let identity = store.relayUrl + "|" + store.token
        guard registeredSession != identity, let url = URL(string: store.relayUrl + "/relay/account/notifications/native") else { return }
        registering = true
        let deviceToken = token
        let sessionToken = store.token
        let relayOrigin = store.relayUrl
        Task { @MainActor in
            defer { registering = false }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            #if DEBUG
            let sandbox = true
            #else
            let sandbox = false
            #endif
            request.httpBody = try? JSONSerialization.data(withJSONObject: ["nativePlatform": "apns", "deviceToken": deviceToken, "sandbox": sandbox, "relayOrigin": relayOrigin])
            if let (_, response) = try? await URLSession.shared.data(for: request), (response as? HTTPURLResponse)?.statusCode == 200,
               identity == store.relayUrl + "|" + store.token, token == deviceToken { registeredSession = identity }
        }
    }
}

final class NativeAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        NativePush.shared.token = token.map { String(format: "%02x", $0) }.joined()
    }
}
extension Notification.Name { static let agentRunFinished = Notification.Name("remoteCodex.agentRunFinished") }
