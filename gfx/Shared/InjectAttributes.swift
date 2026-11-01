import ActivityKit
import Foundation

/// Live Activity «حقن LENSY»: идёт в Dynamic Island и на экране блокировки, пока открывается PUBG.
struct InjectAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var progress: Double      // 0…1
        var step: String          // что сейчас делается
        var done: Bool
    }
    var game: String
}
