import ActivityKit
import Foundation

/**
 * Shared attributes for the Day-recorder Live Activity (Dynamic Island + lock screen).
 *
 * Compiled into BOTH the app (which starts/updates/ends the activity) and the RecordWidget extension
 * (which renders it). The dynamic `startedAt` drives a live count-up timer via `Text(timerInterval:)`
 * so the widget updates itself without the app pushing a tick every second.
 */
public struct RecordingActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var startedAt: Date
    public init(startedAt: Date) { self.startedAt = startedAt }
  }

  public var title: String
  public init(title: String) { self.title = title }
}
