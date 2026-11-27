// The iOS shell's ActivityPolicy and relay fixture tests (feat/mobile-ios ios/ActivityPolicyTests),
// as a plain runner for CI: swiftc -parse-as-library targets/live-activity/ActivityPolicy.swift <this file>
// Usage: ./live-activity-tests <fixtures dir>. Exits non-zero on the first failed check.
import Foundation

var failures = 0
func check(_ ok: @autoclosure () -> Bool, _ what: String, line: Int = #line) {
    if !ok() { failures += 1; print("FAIL line \(line): \(what)") }
}

let now = Date(timeIntervalSince1970: 1_800_000_000)
func item(_ state: String, _ key: String = "d:t", root: String? = nil, seconds: Double = 0) -> ActivityItem {
    .init(key: key, deviceId: "d", deviceName: "Mac", workspaceLabel: "ws", threadId: key, title: "Private title", state: state, since: ISO8601DateFormatter().string(from: now.addingTimeInterval(seconds)), rootThreadKey: root)
}

func testPriorityAndEarliestRunningTurn() {
    var policy = ActivityPolicy()
    let state = policy.sync(.init(accountId: "a", items: [item("running", "d:r", seconds: -300), item("failed", "d:f"), item("needsInput", "d:w")]), now: now)
    check(state.rows.map(\.state) == ["needsInput", "failed", "running"], "priority order")
    check(state.status == "needsInput", "status")
    check(state.earliestStart == now.addingTimeInterval(-300), "earliest start")
    check(state.waitingCount == 1, "waiting count")
}
func testEndAfterFifteenMinutesAndMissingCompletedRows() {
    var policy = ActivityPolicy()
    _ = policy.sync(.init(accountId: "a", items: [item("running")]), now: now)
    let end = policy.sync(.init(accountId: "a", items: []), now: now.addingTimeInterval(30))
    check(end.completedCount == 1, "completed count")
    check(end.dismissalDate == now.addingTimeInterval(930), "dismissal date")
    check(policy.sync(.init(accountId: "a", items: []), now: now.addingTimeInterval(60)).endedAt == end.endedAt, "end stays")
}
func testWaitingNeverEndsAndOnlyForegroundRunningStarts() {
    var policy = ActivityPolicy()
    let waiting = policy.sync(.init(accountId: "a", items: [item("needsInput")]), now: now)
    check(waiting.endedAt == nil, "waiting not ended")
    check(!ActivityPolicy.shouldStart(waiting, foreground: true), "waiting does not start")
    let running = policy.sync(.init(accountId: "a", items: [item("running")]), now: now)
    check(!ActivityPolicy.shouldStart(running, foreground: false), "background does not start")
    check(ActivityPolicy.shouldStart(running, foreground: true), "foreground running starts")
}
func testConversationsCountOnceAndAccountReset() {
    var policy = ActivityPolicy()
    let grouped = policy.sync(.init(accountId: "a", items: [item("running"), item("needsInput", "d:child", root: "d:t")]), now: now)
    check(grouped.rows.count == 1, "one conversation")
    check(grouped.status == "needsInput", "grouped status")
    let other = policy.sync(.init(accountId: "b", items: [item("failed")]), now: now)
    check(other.endedAt == nil, "account reset end")
    check(other.completedCount == 0, "account reset count")
    check(other.status == "failed", "account reset status")
}
func testLargeSnapshotFitsActivityKitBudget() {
    var policy = ActivityPolicy()
    let state = policy.sync(.init(accountId: "a", items: (0..<200).map { item("running", "device:\($0)", seconds: -Double($0)) }), now: now)
    check(state.totalCount == 200, "total")
    check(state.rows.count == 3, "rows capped")
    check(state.earliestStart == now.addingTimeInterval(-199), "earliest")
    check(((try? JSONEncoder().encode(state))?.count ?? .max) < 4096, "under 4 KB")
}
func testRestoreAndNewBatchReset() {
    var original = ActivityPolicy()
    let active = original.sync(.init(accountId: "a", items: [item("running")]), now: now)
    var restored = ActivityPolicy()
    restored.restore(accountId: "a", state: active)
    check(restored.sync(.init(accountId: "a", items: []), now: now).completedCount == 1, "restored count")
    let next = restored.sync(.init(accountId: "a", items: [item("running", "d:next")]), now: now)
    check(next.endedAt == nil, "new batch running")
    check(next.completedCount == 1, "new batch count")
}
func testExpandedStatusWording() {
    let cases: [([String], String, String)] = [
        (["running"], "运行中", "Running"),
        (["running", "running", "running"], "还有 2 个线程在运行", "2 more running"),
        (["needsInput", "running"], "等待你处理", "Waiting for you"),
        (["failed"], "运行失败", "Failed"),
        (["failed", "running", "running"], "运行失败 · 还有 2 个线程在运行", "Failed · 2 more running"),
        (["interrupted"], "已中断", "Interrupted"),
    ]
    for (states, zh, en) in cases {
        var policy = ActivityPolicy()
        let state = policy.sync(ActivitySnapshot(accountId: "a", items: states.enumerated().map { item($0.element, "d:\($0.offset)") }), now: now)
        check(state.expandedStatusLine == zh, "zh wording \(states)")
        check(state.expandedStatusLine(english: true) == en, "en wording \(states)")
        check(!state.expandedStatusLine.contains("还有 0"), "no zero count")
    }
}
func testContentFreePushStateRoundTrip() {
    var policy = ActivityPolicy()
    let state = policy.sync(.init(accountId: "a", items: [item("running")]), now: now)
    guard let data = try? JSONEncoder().encode(state), let json = String(data: data, encoding: .utf8) else { return check(false, "encode") }
    for forbidden in ["Private title", "Mac", "workspace", "deviceName", "title"] { check(!json.contains(forbidden), "no \(forbidden) in push state") }
    check((try? JSONDecoder().decode(ActivityContentState.self, from: data)) == state, "round trip")
}

// Byte-for-byte copies of the relay's golden APNs fixtures (crates/relay/test-fixtures).
struct Push: Decodable {
    struct APS: Decodable {
        let timestamp: Int
        let event: String
        let state: ActivityContentState
        let dismissalDate: Int?
        enum CodingKeys: String, CodingKey {
            case timestamp, event
            case state = "content-state"
            case dismissalDate = "dismissal-date"
        }
    }
    let aps: APS
}
func fixture(_ dir: String, _ name: String) -> Push? {
    guard let data = FileManager.default.contents(atPath: "\(dir)/\(name).json") else { check(false, "fixture \(name) missing"); return nil }
    do { return try JSONDecoder().decode(Push.self, from: data) } catch { check(false, "decode \(name): \(error)"); return nil }
}
func testRelayFixtures(_ dir: String) {
    if let push = fixture(dir, "live-activity-update") {
        check(push.aps.event == "update", "update event")
        check(push.aps.timestamp == 1_793_620_800, "timestamp unix")
        let state = push.aps.state
        check(state.status == "needsInput", "fixture status")
        check(state.rows.map(\.state) == ["needsInput", "failed", "running"], "fixture rows")
        check(state.totalCount == 3 && state.waitingCount == 1 && state.failedCount == 1 && state.runningCount == 1, "fixture counts")
        check(state.endedAt == nil, "fixture not ended")
        check(state.earliestStart.timeIntervalSinceReferenceDate == 815_313_300, "reference epoch")
        check(state.earliestStart.timeIntervalSince1970 == 1_793_620_500, "unix earliest")
        check(state.rows[0].startedAt.timeIntervalSince1970 == 1_793_620_740, "row 0 start")
        check(state.rows[1].startedAt.timeIntervalSince1970 == 1_793_620_680, "row 1 start")
        check(state.rows[2].startedAt == state.earliestStart, "row 2 start")
    }
    if let push = fixture(dir, "live-activity-end") {
        check(push.aps.event == "end", "end event")
        check(push.aps.state.completedCount == 3, "end count")
        check(push.aps.state.status == "completed", "end status")
        if let end = push.aps.state.endedAt {
            check(end.timeIntervalSinceReferenceDate == 815_313_600, "end reference epoch")
            check(end.timeIntervalSince1970 == Double(push.aps.timestamp), "end = timestamp")
        } else { check(false, "endedAt missing") }
        check(push.aps.dismissalDate == 1_793_621_700, "dismissal unix")
        check(push.aps.state.dismissalDate?.timeIntervalSince1970 == push.aps.dismissalDate.map(Double.init), "dismissal matches")
    }
}

@main
struct LiveActivityTests {
    static func main() {
        let dir = CommandLine.arguments.dropFirst().first ?? "fixtures"
        testPriorityAndEarliestRunningTurn()
        testEndAfterFifteenMinutesAndMissingCompletedRows()
        testWaitingNeverEndsAndOnlyForegroundRunningStarts()
        testConversationsCountOnceAndAccountReset()
        testLargeSnapshotFitsActivityKitBudget()
        testRestoreAndNewBatchReset()
        testExpandedStatusWording()
        testContentFreePushStateRoundTrip()
        testRelayFixtures(dir)
        if failures > 0 { print("\(failures) check(s) failed"); exit(1) }
        print("PASS: Live Activity policy and relay fixtures")
    }
}
