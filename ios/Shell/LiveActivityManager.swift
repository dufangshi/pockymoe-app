import ActivityKit
import UIKit

@MainActor
final class LiveActivityManager {
    private var policy: ActivityPolicy = {
        guard let data = UserDefaults.standard.data(forKey: "shell.activityPolicy"),
              let policy = try? JSONDecoder().decode(ActivityPolicy.self, from: data) else { return ActivityPolicy() }
        return policy
    }()
    private var activity: Activity<PockymoeActivityAttributes>?
    private var tokenTask: Task<Void, Never>?
    private var generation = UUID()
    private var syncTask: Task<Void, Never>?
    #if DEBUG
    private var debugError: String?
    #endif
    var onToken: ((String) -> Void)?
    private var lastToken: String?

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
        UserDefaults.standard.removeObject(forKey: "shell.activityPolicy")
        policy = ActivityPolicy(); activity = nil
        tokenTask?.cancel(); tokenTask = nil; lastToken = nil
        let old = Activity<PockymoeActivityAttributes>.activities
        Task { for value in old { await value.end(nil, dismissalPolicy: .immediate) } }
    }

    private func apply(_ snapshot: ActivitySnapshot, generation: UUID) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        ActivityMetadataCache.save(snapshot)
        if activity == nil { activity = Activity.activities.first { $0.attributes.accountId == snapshot.accountId && $0.activityState == .active } }
        if policy.accountId == nil, let activity { policy.restore(accountId: activity.attributes.accountId, state: activity.content.state) }
        let state = policy.sync(snapshot, now: .now)
        if let data = try? JSONEncoder().encode(policy) { UserDefaults.standard.set(data, forKey: "shell.activityPolicy") }
        // Account changes must never leave another account's titles on a system surface.
        for old in Activity<PockymoeActivityAttributes>.activities where old.attributes.accountId != snapshot.accountId {
            await old.end(nil, dismissalPolicy: .immediate)
        }
        guard generation == self.generation else { return }
        if activity?.attributes.accountId != snapshot.accountId {
            activity = nil; tokenTask?.cancel(); tokenTask = nil; lastToken = nil
        }
        if activity == nil, ActivityPolicy.shouldStart(state, foreground: UIApplication.shared.applicationState == .active) {
            do {
                var pushType: PushType? = .token
                #if DEBUG
                if ProcessInfo.processInfo.environment["E2E_ACTIVITY_STATE"] != nil { pushType = nil }
                #endif
                activity = try Activity.request(attributes: PockymoeActivityAttributes(accountId: snapshot.accountId), content: ActivityContent(state: state, staleDate: nil), pushType: pushType)
            } catch {
                #if DEBUG
                debugError = String(describing: error)
                #endif
            }
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

    #if DEBUG
    func drive(_ state: String) async {
        for old in Activity<PockymoeActivityAttributes>.activities { await old.end(nil, dismissalPolicy: .immediate) }
        activity = nil; tokenTask?.cancel(); tokenTask = nil; policy = ActivityPolicy()
        let states = state == "failed" ? ["failed", "running"] : state == "overflow" ? ["needsInput", "failed", "running", "running", "running"] : [state]
        // Terminal fixtures first start a real activity; production never uses push-to-start.
        if state != "running" { await sync(.init(accountId: "screenshots", items: [fixture("running", index: 0)])) }
        if state == "interrupted", let activity {
            // Review the interrupted mark independently of the production terminal summary.
            await activity.update(ActivityContent(state: DebugIslandRenderer.fixture(state), staleDate: nil))
        } else {
            await sync(.init(accountId: "screenshots", items: states.enumerated().map { fixture($0.element, index: $0.offset) }))
        }
        if ProcessInfo.processInfo.environment["E2E_ACTIVITY_MINIMAL"] == "1" {
            _ = try? Activity.request(attributes: PockymoeActivityAttributes(accountId: "debug-companion"), content: ActivityContent(state: DebugIslandRenderer.fixture("running"), staleDate: nil), pushType: nil)
        }
        let info: [String: Any] = ["error": debugError ?? "", "fixture": state, "enabled": ActivityAuthorizationInfo().areActivitiesEnabled, "activities": Activity<PockymoeActivityAttributes>.activities.map { ["id": $0.id, "status": String(describing: $0.activityState)] }]
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        if let data = try? JSONSerialization.data(withJSONObject: info, options: .prettyPrinted) { try? data.write(to: directory.appendingPathComponent("activity-debug.json")) }
    }
    private func fixture(_ state: String, index: Int) -> ActivityItem {
        .init(key: "fixture:\(index)", deviceId: "fixture", deviceName: "Mac", workspaceLabel: "Pockymoe", threadId: "\(index)", title: "修复登录与连接状态 \(index + 1)", state: state, since: ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: -134)))
    }
    #endif
}
