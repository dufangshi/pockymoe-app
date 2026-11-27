// Shared between the app module and the Live Activity widget (byte-identical copies). Ported from
// the iOS shell's ActivityMetadataCache: titles, device and workspace names stay on this phone in
// the app group; the relay's pushes carry only ids, states and times.
import Foundation

struct ActivityMetadata: Codable {
    var title: String
    var device: String
    var workspace: String
    var path: String
}

enum ActivityMetadataCache {
    /// The app's id, also from the widget (`<app id>.liveactivity`).
    static var appIdentifier: String {
        let id = Bundle.main.bundleIdentifier ?? ""
        return id.hasSuffix(".liveactivity") ? String(id.dropLast(".liveactivity".count)) : id
    }
    /// `group.<app id>`, opened only when this process is entitled to it (a build without the
    /// group renders generic titles instead).
    static var sharedDefaults: UserDefaults? {
        let group = "group.\(appIdentifier)"
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil else { return nil }
        return UserDefaults(suiteName: group)
    }
    /// The app's language choice, so the widget speaks it too ("en" or "zh").
    static func language(in defaults: UserDefaults? = sharedDefaults) -> String {
        defaults?.string(forKey: "activityLanguage") ?? (Locale.preferredLanguages.first?.hasPrefix("zh") == true ? "zh" : "en")
    }
    static func setLanguage(_ language: String, in defaults: UserDefaults? = sharedDefaults) {
        defaults?.set(language, forKey: "activityLanguage")
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
            values[key] = ActivityMetadata(title: item.rootThreadTitle ?? item.title, device: item.deviceName, workspace: item.workspaceLabel, path: threadPath(device: device, thread: thread))
        }
        if values.count > 500 { values = values.filter { key, _ in snapshot.items.contains { $0.conversationKey == key } } }
        if let data = try? JSONEncoder().encode(values) { defaults?.set(data, forKey: "activityMetadata") }
    }
    static func load(in defaults: UserDefaults? = sharedDefaults) -> [String: ActivityMetadata] {
        guard let data = defaults?.data(forKey: "activityMetadata") else { return [:] }
        return (try? JSONDecoder().decode([String: ActivityMetadata].self, from: data)) ?? [:]
    }
    /// The app's link to a relay thread: `thread/<device>/<thread>` (notifications.ts openUrl).
    static func threadPath(device: String, thread: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        return "thread/\(device.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")/\(thread.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
    }
    /// The app's URL scheme for this build (app.config.ts: pockymoe-app, -preview, -dev).
    static var scheme: String {
        let id = appIdentifier
        return id.hasSuffix(".dev") ? "pockymoe-app-dev" : id.hasSuffix(".preview") ? "pockymoe-app-preview" : "pockymoe-app"
    }
}
