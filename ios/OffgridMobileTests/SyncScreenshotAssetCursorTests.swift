import XCTest

@testable import OffgridMobile

final class SyncScreenshotAssetCursorTests: XCTestCase {
  func testAcceptsOnlyScreenshotsNewerThanTheBaseline() {
    let baselineDate = Date(timeIntervalSince1970: 100)
    var cursor = SyncScreenshotAssetCursor(
      identifier: "baseline",
      creationDate: baselineDate
    )

    XCTAssertFalse(
      cursor.advanceIfNewer(
        identifier: "older-revealed-after-deletion",
        creationDate: baselineDate.addingTimeInterval(-1)
      )
    )
    XCTAssertFalse(
      cursor.advanceIfNewer(identifier: "missing-date", creationDate: nil)
    )
    XCTAssertTrue(
      cursor.advanceIfNewer(
        identifier: "new-screenshot",
        creationDate: baselineDate.addingTimeInterval(1)
      )
    )
    XCTAssertFalse(
      cursor.advanceIfNewer(
        identifier: "new-screenshot",
        creationDate: baselineDate.addingTimeInterval(1)
      )
    )
  }
}
