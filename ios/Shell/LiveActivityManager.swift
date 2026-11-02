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
    private var syncTask: Task<Void, Never>?
    var onToken: ((String) -> Void)?
    private var lastToken: String?

    func resendToken() { if let lastToken { onToken?(lastToken) } }

    func sync(_ snapshot: ActivitySnapshot) async {
        // ActivityKit awaits are reentrant; preserve snapshot order across end/account changes.
        let previous = syncTask
        let next = Task { await previous?.value; await apply(snapshot) }
        syncTask = next
        await next.value
    }

    private func apply(_ snapshot: ActivitySnapshot) async {
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
        if activity?.attributes.accountId != snapshot.accountId {
            activity = nil; tokenTask?.cancel(); tokenTask = nil; lastToken = nil
        }
        if activity == nil, ActivityPolicy.shouldStart(state, foreground: UIApplication.shared.applicationState == .active) {
            activity = try? Activity.request(attributes: PockymoeActivityAttributes(accountId: snapshot.accountId), content: ActivityContent(state: state, staleDate: nil), pushType: .token)
        }
        guard let activity else { return }
        if tokenTask == nil {
            tokenTask = Task { [weak self] in
                for await token in activity.pushTokenUpdates {
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
        await sync(.init(accountId: "screenshots", items: states.enumerated().map { fixture($0.element, index: $0.offset) }))
    }
    private func fixture(_ state: String, index: Int) -> ActivityItem {
        .init(key: "fixture:\(index)", deviceId: "fixture", deviceName: "Mac", workspaceLabel: "Pockymoe", threadId: "\(index)", title: "修复登录与连接状态 \(index + 1)", state: state, since: ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: -134)))
    }
    #endif
}
