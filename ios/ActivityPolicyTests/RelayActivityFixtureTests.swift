import XCTest
@testable import ActivityPolicy

// These are byte-for-byte copies of the Relay's golden APNs fixtures, not
// synthesized Swift round trips. ActivityKit uses Date's default Codable epoch.
final class RelayActivityFixtureTests: XCTestCase {
    private struct Push: Decodable {
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
    private func fixture(_ name: String) throws -> Push {
        let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Push.self, from: Data(contentsOf: url))
    }
    func testExactRelayUpdateDecodesWithActivityKitDateStrategy() throws {
        let push = try fixture("live-activity-update")
        XCTAssertEqual(push.aps.event, "update")
        XCTAssertEqual(push.aps.timestamp, 1_793_620_800) // APNs envelope: Unix seconds.
        let state = push.aps.state
        XCTAssertEqual(state.status, "needsInput")
        XCTAssertEqual(state.rows.map(\.state), ["needsInput", "failed", "running"])
        XCTAssertEqual(state.totalCount, 3)
        XCTAssertEqual(state.waitingCount, 1)
        XCTAssertEqual(state.failedCount, 1)
        XCTAssertEqual(state.runningCount, 1)
        XCTAssertNil(state.endedAt)
        XCTAssertEqual(state.earliestStart.timeIntervalSinceReferenceDate, 815_313_300)
        XCTAssertEqual(state.earliestStart.timeIntervalSince1970, 1_793_620_500)
        XCTAssertEqual(state.rows[0].startedAt.timeIntervalSince1970, 1_793_620_740)
        XCTAssertEqual(state.rows[1].startedAt.timeIntervalSince1970, 1_793_620_680)
        XCTAssertEqual(state.rows[2].startedAt, state.earliestStart)
    }
    func testExactRelayEndUsesUnixDismissalAndReferenceDateContent() throws {
        let push = try fixture("live-activity-end")
        XCTAssertEqual(push.aps.event, "end")
        XCTAssertEqual(push.aps.state.completedCount, 3)
        XCTAssertEqual(push.aps.state.status, "completed")
        let end = try XCTUnwrap(push.aps.state.endedAt)
        XCTAssertEqual(end.timeIntervalSinceReferenceDate, 815_313_600)
        XCTAssertEqual(end.timeIntervalSince1970, Double(push.aps.timestamp))
        XCTAssertEqual(push.aps.dismissalDate, 1_793_621_700)
        XCTAssertEqual(try XCTUnwrap(push.aps.state.dismissalDate).timeIntervalSince1970, Double(try XCTUnwrap(push.aps.dismissalDate)))
    }
}
