import XCTest
@testable import ActivityPolicy

final class ActivityPolicyTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func item(_ state: String, _ key: String = "d:t", root: String? = nil, seconds: Double = 0) -> ActivityItem {
        .init(key: key, deviceId: "d", deviceName: "Mac", workspaceLabel: "ws", threadId: key, title: "Private title", state: state, since: ISO8601DateFormatter().string(from: now.addingTimeInterval(seconds)), rootThreadKey: root)
    }
    func testPriorityAndEarliestRunningTurn() {
        var policy = ActivityPolicy()
        let state = policy.sync(.init(accountId: "a", items: [item("running", "d:r", seconds: -300), item("failed", "d:f"), item("needsInput", "d:w")]), now: now)
        XCTAssertEqual(state.rows.map(\.state), ["needsInput", "failed", "running"])
        XCTAssertEqual(state.status, "needsInput")
        XCTAssertEqual(state.earliestStart, now.addingTimeInterval(-300))
        XCTAssertEqual(state.waitingCount, 1)
    }
    func testEndAfterFifteenMinutesAndMissingCompletedRows() {
        var policy = ActivityPolicy()
        _ = policy.sync(.init(accountId: "a", items: [item("running")]), now: now)
        let end = policy.sync(.init(accountId: "a", items: []), now: now.addingTimeInterval(30))
        XCTAssertEqual(end.completedCount, 1)
        XCTAssertEqual(end.dismissalDate, now.addingTimeInterval(930))
        XCTAssertEqual(policy.sync(.init(accountId: "a", items: []), now: now.addingTimeInterval(60)).endedAt, end.endedAt)
    }
    func testWaitingNeverEndsAndOnlyForegroundRunningStarts() {
        var policy = ActivityPolicy()
        let waiting = policy.sync(.init(accountId: "a", items: [item("needsInput")]), now: now)
        XCTAssertNil(waiting.endedAt)
        XCTAssertFalse(ActivityPolicy.shouldStart(waiting, foreground: true))
        let running = policy.sync(.init(accountId: "a", items: [item("running")]), now: now)
        XCTAssertFalse(ActivityPolicy.shouldStart(running, foreground: false))
        XCTAssertTrue(ActivityPolicy.shouldStart(running, foreground: true))
    }
    func testConversationsCountOnceAndAccountReset() {
        var policy = ActivityPolicy()
        let grouped = policy.sync(.init(accountId: "a", items: [item("running"), item("needsInput", "d:child", root: "d:t")]), now: now)
        XCTAssertEqual(grouped.rows.count, 1)
        XCTAssertEqual(grouped.status, "needsInput")
        let other = policy.sync(.init(accountId: "b", items: [item("failed")]), now: now)
        XCTAssertNil(other.endedAt)
        XCTAssertEqual(other.completedCount, 0)
        XCTAssertEqual(other.status, "failed")
    }
    func testLargeSnapshotFitsActivityKitBudget() throws {
        var policy = ActivityPolicy()
        let state = policy.sync(.init(accountId: "a", items: (0..<200).map { item("running", "device:\($0)", seconds: -Double($0)) }), now: now)
        XCTAssertEqual(state.totalCount, 200)
        XCTAssertEqual(state.rows.count, 3)
        XCTAssertEqual(state.earliestStart, now.addingTimeInterval(-199))
        XCTAssertLessThan(try JSONEncoder().encode(state).count, 4096)
    }
    func testRestoreAndNewBatchReset() {
        var original = ActivityPolicy()
        let active = original.sync(.init(accountId: "a", items: [item("running")]), now: now)
        var restored = ActivityPolicy()
        restored.restore(accountId: "a", state: active)
        XCTAssertEqual(restored.sync(.init(accountId: "a", items: []), now: now).completedCount, 1)
        let next = restored.sync(.init(accountId: "a", items: [item("running", "d:next")]), now: now)
        XCTAssertNil(next.endedAt)
        XCTAssertEqual(next.completedCount, 1)
    }
    func testContentFreePushStateRoundTrip() throws {
        var policy = ActivityPolicy()
        let state = policy.sync(.init(accountId: "a", items: [item("running")]), now: now)
        let data = try JSONEncoder().encode(state)
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        for forbidden in ["Private title", "Mac", "workspace", "deviceName", "title"] { XCTAssertFalse(json.contains(forbidden)) }
        XCTAssertEqual(try JSONDecoder().decode(ActivityContentState.self, from: data), state)
    }
}
