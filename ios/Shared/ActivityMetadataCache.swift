import Foundation

struct ActivityMetadata: Codable {
    var title: String
    var device: String
    var workspace: String
    var path: String
}

enum ActivityMetadataCache {
    // A free-team build has no group entitlement. Never open an unauthorized
    // suite: the widget intentionally renders generic titles without this cache.
    static var sharedDefaults: UserDefaults? {
        guard let suite = Bundle.main.object(forInfoDictionaryKey: "PockymoeAppGroup") as? String,
              !suite.isEmpty, !suite.contains("$(") else { return nil }
        return UserDefaults(suiteName: suite)
    }
    static func clear(in defaults: UserDefaults? = sharedDefaults) {
        defaults?.removeObject(forKey: "activityMetadata")
        defaults?.removeObject(forKey: "activityAccount")
    }
    static func save(_ snapshot: ActivitySnapshot, in defaults: UserDefaults? = sharedDefaults) {
        if defaults?.string(forKey: "activityAccount") != snapshot.accountId {
            defaults?.removeObject(forKey: "activityMetadata")
            defaults?.set(snapshot.accountId, forKey: "activityAccount")
        }
        var values = load(in: defaults)
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
        if let data = try? JSONEncoder().encode(values) { defaults?.set(data, forKey: "activityMetadata") }
    }
    static func load(in defaults: UserDefaults? = sharedDefaults) -> [String: ActivityMetadata] {
        guard let data = defaults?.data(forKey: "activityMetadata") else { return [:] }
        return (try? JSONDecoder().decode([String: ActivityMetadata].self, from: data)) ?? [:]
    }
}
