import Foundation
import UIKit

/**
 * JS side of Share -> Improve on iOS. The ImproveShare extension hands the text over in the link it
 * opens (`<bundle id>://improve?text=…`), which JS reads through Linking; nothing waits here. The
 * pick is copied, so `finish` has nothing to return. Android's module holds PROCESS_TEXT requests.
 */
@objc(ScribeEntryModule)
final class ScribeEntryModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func takePending(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(nil)
  }

  @objc func finish(
    _ requestId: String,
    text: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(false)
  }
}
