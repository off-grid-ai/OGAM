import AppIntents
import Foundation

/**
 * The Live Activity's Stop button. `LiveActivityIntent.perform()` runs in the APP process (iOS wakes
 * it if backgrounded), so it just posts a Darwin-free NotificationCenter signal that
 * RecordingLiveActivityModule observes and forwards to JS, which stops the recorder and ends the
 * activity. Compiled into both the app and the RecordWidget extension.
 */
@available(iOS 17.0, *)
struct StopRecordingIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Stop recording"

  func perform() async throws -> some IntentResult {
    NotificationCenter.default.post(name: Notification.Name("OffgridStopRecording"), object: nil)
    return .result()
  }
}
