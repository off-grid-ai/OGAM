import SwiftUI
import WidgetKit

/// Entry point for the RecordWidget extension — hosts the Day-recorder Live Activity.
@main
struct RecordWidgetBundle: WidgetBundle {
  var body: some Widget {
    RecordLiveActivity()
  }
}
