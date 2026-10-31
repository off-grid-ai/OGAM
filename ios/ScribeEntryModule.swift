import Foundation
import UIKit

/**
 * JS side of Share -> Improve. The ImproveShare extension puts the shared text on a named
 * pasteboard only this team's apps can read (no paste prompt, no App Group) and opens
 * offgrid://improve. The app takes it once; the pick is copied, so `finish` has nothing to return.
 */
@objc(ScribeEntryModule)
final class ScribeEntryModule: NSObject {
  static let pasteboardName = UIPasteboard.Name("ai.offgridmobile.scribe.improve")

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func takePending(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard
        let board = UIPasteboard(name: Self.pasteboardName, create: false),
        let text = board.string, !text.isEmpty
      else {
        resolve(nil)
        return
      }
      UIPasteboard.remove(withName: Self.pasteboardName)
      resolve(["id": UUID().uuidString, "text": text, "apply": "copy"])
    }
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
