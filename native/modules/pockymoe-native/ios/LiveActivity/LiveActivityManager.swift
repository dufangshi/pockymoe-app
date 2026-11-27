// The account Live Activity from the app side, ported from the iOS shell's LiveActivityManager
// (feat/mobile-ios ios/Shell/LiveActivityManager.swift): the app hands it a snapshot of its
// threads while open; it starts an activity in the foreground when something runs, updates it,
// ends it 15 minutes after the last turn, and reports the activity's push token so the relay can
// keep it current while the app is closed (docs/thread-notifications.md, Live Activity updates).
import ActivityKit
import UIKit

@MainActor
final class LiveActivityManager {
    private var policy: ActivityPolicy = {
        guard let data = UserDefaults.standard.data(forKey: "pockymoe.activityPolicy"),
              let policy = try? JSONDecoder().decode(ActivityPolicy.self, from: data) else { return ActivityPolicy() }
        return policy
    }()
    private var activity: Activity<PockymoeActivityAttributes>?
    private var tokenTask: Task<Void, Never>?
    private var generation = UUID()
    private var syncTask: Task<Void, Never>?
    var onToken: ((String) -> Void)?
    private var lastToken: String?
    /// The last ActivityKit refusal, for diagnostics (Debug builds log it).
    private(set) var lastError: String?

    func info() -> [String: Any] {
        ["enabled": ActivityAuthorizationInfo().areActivitiesEnabled, "error": lastError ?? "", "token": lastToken != nil,
         "activities": Activity<PockymoeActivityAttributes>.activities.map { ["id": $0.id, "state": String(describing: $0.activityState)] }]
    }

    /// The app's own URL scheme (Info.plist CFBundleURLTypes), for the widget's links.
    static let appScheme: String? = ((Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]])?
        .compactMap { ($0["CFBundleURLSchemes"] as? [String])?.first }.first { $0.hasPrefix("pockymoe") })

    func resendToken() { if let lastToken { onToken?(lastToken) } }

    func sync(_ snapshot: ActivitySnapshot) async {
        // ActivityKit awaits are reentrant; preserve snapshot order across end/account changes.
        let previous = syncTask
        let generation = generation
        let next = Task {
            await previous?.value
            guard generation == self.generation else { return }
            await apply(snapshot, generation: generation)
        }
        syncTask = next
        await next.value
    }

    func clear() {
        generation = UUID()
        ActivityMetadataCache.clear()
        UserDefaults.standard.removeObject(forKey: "pockymoe.activityPolicy")
        policy = ActivityPolicy(); activity = nil
        tokenTask?.cancel(); tokenTask = nil; lastToken = nil
        let old = Activity<PockymoeActivityAttributes>.activities
        Task { for value in old { await value.end(nil, dismissalPolicy: .immediate) } }
    }

    /// CI's Live Activity check: launched with `-PockymoeActivityFixture` the app shows sample
    /// threads (a running one, one waiting) so the simulator's lock screen and Dynamic Island
    /// can be captured. Never used otherwise.
    func showFixture() async {
        let iso = ISO8601DateFormatter()
        func item(_ id: String, _ title: String, _ state: String, _ seconds: Double) -> ActivityItem {
            .init(key: "fixture:\(id)", deviceId: "fixture", deviceName: "Studio Linux", workspaceLabel: "notes", threadId: id, title: title, state: state, since: iso.string(from: Date(timeIntervalSinceNow: -seconds)))
        }
        await sync(.init(accountId: "fixture", items: [item("1", "Fix the login flow", "running", 134), item("2", "Explain the relay", "needsInput", 40)]))
    }

    private func apply(_ snapshot: ActivitySnapshot, generation: UUID) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        ActivityMetadataCache.save(snapshot)
        ActivityMetadataCache.setScheme(Self.appScheme)
        if activity == nil { activity = Activity.activities.first { $0.attributes.accountId == snapshot.accountId && $0.activityState == .active } }
        if policy.accountId == nil, let activity { policy.restore(accountId: activity.attributes.accountId, state: activity.content.state) }
        let state = policy.sync(snapshot, now: .now)
        if let data = try? JSONEncoder().encode(policy) { UserDefaults.standard.set(data, forKey: "pockymoe.activityPolicy") }
        // Account changes must never leave another account's titles on a system surface.
        for old in Activity<PockymoeActivityAttributes>.activities where old.attributes.accountId != snapshot.accountId {
            await old.end(nil, dismissalPolicy: .immediate)
        }
        guard generation == self.generation else { return }
        if activity?.attributes.accountId != snapshot.accountId {
            activity = nil; tokenTask?.cancel(); tokenTask = nil; lastToken = nil
        }
        if activity == nil, ActivityPolicy.shouldStart(state, foreground: UIApplication.shared.applicationState == .active) {
            // Push-updated: the relay sends liveactivity pushes to this activity's token.
            do {
                // Push-updated when this build may use APNs; a Personal Team build updates it only
                // while the app runs (PockymoeNativePush, app.config.ts).
                let push = Bundle.main.object(forInfoDictionaryKey: "PockymoeNativePush") as? Bool ?? true
                activity = try Activity.request(attributes: PockymoeActivityAttributes(accountId: snapshot.accountId), content: ActivityContent(state: state, staleDate: nil), pushType: push ? .token : nil)
                lastError = nil
            } catch { lastError = String(describing: error) }
        }
        guard let activity else { return }
        if tokenTask == nil {
            tokenTask = Task { [weak self] in
                for await token in activity.pushTokenUpdates {
                    guard generation == self?.generation, !Task.isCancelled else { return }
                    let value = token.map { String(format: "%02x", $0) }.joined()
                    self?.lastToken = value
                    self?.onToken?(value)
                }
            }
        }
        let content = ActivityContent(state: state, staleDate: nil)
        if let date = state.dismissalDate {
            await activity.end(content, dismissalPolicy: .after(date))
            self.activity = nil
            tokenTask?.cancel(); tokenTask = nil; lastToken = nil
        } else { await activity.update(content) }
    }
}
