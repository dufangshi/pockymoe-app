import ActivityKit
import Foundation

struct PockymoeActivityAttributes: ActivityAttributes {
    typealias ContentState = ActivityContentState
    var accountId: String
}

struct ActivityMetadata: Codable {
    var title: String
    var device: String
    var workspace: String
    var path: String
}

enum ActivityMetadataCache {
    static let suite = "group.com.remotecodex.app"
    static func save(_ snapshot: ActivitySnapshot) {
        let defaults = UserDefaults(suiteName: suite)
        if defaults?.string(forKey: "activityAccount") != snapshot.accountId {
            defaults?.removeObject(forKey: "activityMetadata")
            defaults?.set(snapshot.accountId, forKey: "activityAccount")
        }
        var values = load()
        for item in snapshot.items {
            let key = item.conversationKey
            let parts = key.split(separator: ":", maxSplits: 1).map(String.init)
            let device = parts.first ?? item.deviceId
            let thread = parts.count == 2 ? parts[1] : item.threadId
            let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
            let path = "/devices/\(device.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")/threads/\(thread.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
            values[key] = ActivityMetadata(title: item.rootThreadTitle ?? item.title, device: item.deviceName, workspace: item.workspaceLabel, path: path)
        }
        if values.count > 500 { values = values.filter { key, _ in snapshot.items.contains { $0.conversationKey == key } } }
        if let data = try? JSONEncoder().encode(values) { UserDefaults(suiteName: suite)?.set(data, forKey: "activityMetadata") }
    }
    static func load() -> [String: ActivityMetadata] {
        guard let data = UserDefaults(suiteName: suite)?.data(forKey: "activityMetadata") else { return [:] }
        return (try? JSONDecoder().decode([String: ActivityMetadata].self, from: data)) ?? [:]
    }
}
