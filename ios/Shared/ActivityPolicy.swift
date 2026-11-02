import Foundation

struct ActivityItem: Codable, Equatable {
    var key: String
    var deviceId: String
    var deviceName: String
    var workspaceLabel: String
    var threadId: String
    var title: String
    var state: String
    var since: String
    var rootThreadKey: String?
    var rootThreadTitle: String?

    var startedAt: Date {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return iso.date(from: since) ?? ISO8601DateFormatter().date(from: since) ?? .now
    }
    var conversationKey: String { rootThreadKey ?? key }
}

struct ActivitySnapshot: Decodable {
    var accountId: String
    var items: [ActivityItem]
}

// The APNs content-state has no titles, device names, workspace names or summaries.
struct ActivityContentState: Codable, Hashable {
    struct Row: Codable, Hashable {
        var key: String
        var state: String
        var startedAt: Date
    }
    var rows: [Row]
    var totalCount: Int
    var waitingCount: Int
    var failedCount: Int
    var runningCount: Int
    var completedCount: Int
    var endedAt: Date?
    var status: String {
        endedAt != nil ? "completed" : waitingCount > 0 ? "needsInput" : failedCount > 0 ? "failed" : runningCount > 0 ? "running" : rows.first?.state == "interrupted" ? "interrupted" : "completed"
    }
    var earliestStart: Date
    var dismissalDate: Date? { endedAt?.addingTimeInterval(15 * 60) }
}

struct ActivityPolicy: Codable {
    private(set) var accountId: String?
    private(set) var tracked = Set<String>()
    private(set) var endedAt: Date?

    mutating func restore(accountId: String, state: ActivityContentState) {
        self.accountId = accountId
        tracked = Set(state.rows.map(\.key))
        endedAt = state.endedAt
    }

    static func priority(_ state: String) -> Int {
        switch state {
        case "needsInput": return 0
        case "failed": return 1
        case "running": return 2
        case "interrupted": return 3
        default: return 4
        }
    }

    mutating func sync(_ snapshot: ActivitySnapshot, now: Date) -> ActivityContentState {
        if accountId != snapshot.accountId { tracked = []; endedAt = nil; accountId = snapshot.accountId }
        let grouped = Dictionary(grouping: snapshot.items, by: \.conversationKey)
        let rows = grouped.compactMap { key, items -> ActivityContentState.Row? in
            guard let item = items.min(by: { a, b in
                if Self.priority(a.state) != Self.priority(b.state) { return Self.priority(a.state) < Self.priority(b.state) }
                return a.startedAt < b.startedAt
            }) else { return nil }
            return .init(key: key, state: item.state, startedAt: items.filter { $0.state == "running" }.map(\.startedAt).min() ?? item.startedAt)
        }.sorted { a, b in
            if Self.priority(a.state) != Self.priority(b.state) { return Self.priority(a.state) < Self.priority(b.state) }
            if a.startedAt != b.startedAt { return a.startedAt < b.startedAt }
            return a.key < b.key
        }
        let running = rows.filter { $0.state == "running" }.count
        let waiting = rows.filter { $0.state == "needsInput" }.count
        if endedAt != nil && (running > 0 || waiting > 0) { tracked = [] }
        tracked.formUnion(rows.filter { ["running", "needsInput"].contains($0.state) }.map(\.key))
        if running > 0 || waiting > 0 { endedAt = nil }
        else if !tracked.isEmpty && endedAt == nil { endedAt = now }
        return .init(rows: Array(rows.prefix(3)), totalCount: rows.count, waitingCount: waiting,
                     failedCount: rows.filter { $0.state == "failed" }.count,
                     runningCount: running, completedCount: tracked.count, endedAt: endedAt,
                     earliestStart: snapshot.items.filter { $0.state == "running" }.map(\.startedAt).min() ?? rows.first?.startedAt ?? now)
    }

    static func shouldStart(_ state: ActivityContentState, foreground: Bool) -> Bool {
        foreground && state.runningCount > 0
    }
}
