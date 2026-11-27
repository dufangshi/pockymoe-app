// Shared between the app module and the Live Activity widget (byte-identical copies). ActivityKit
// matches an activity's attributes by this type's name in both processes.
import ActivityKit
import Foundation

struct PockymoeActivityAttributes: ActivityAttributes {
    typealias ContentState = ActivityContentState
    var accountId: String
}
