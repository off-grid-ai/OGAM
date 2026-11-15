import UIKit
import UniformTypeIdentifiers

/**
 * Share -> Improve. Takes the shared text, puts it on a named pasteboard only Off Grid AI reads,
 * and opens the app on `<its bundle id>://improve`. Both are named after the app this extension
 * ships in, so with a dev and a release build installed the text reaches the build it was shared
 * to. The model runs in the app: an extension's memory limit is far below what a text model needs.
 */
final class ShareViewController: UIViewController {
  /** The containing app's bundle id: this extension's, without its own last component. */
  private static let appBundleId: String = {
    let own = Bundle.main.bundleIdentifier ?? "ai.offgridmobile.ImproveShare"
    return own.components(separatedBy: ".").dropLast().joined(separator: ".")
  }()
  private static let pasteboardName = UIPasteboard.Name("\(appBundleId).scribe.improve")

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    loadSharedText { [weak self] text in
      guard let self else { return }
      guard let text, !text.isEmpty else {
        self.extensionContext?.cancelRequest(withError: NSError(domain: "ImproveShare", code: 1))
        return
      }
      UIPasteboard(name: Self.pasteboardName, create: true)?.string = text
      self.openApp(URL(string: "\(Self.appBundleId)://improve")!)
      self.extensionContext?.completeRequest(returningItems: nil)
    }
  }

  private func loadSharedText(_ done: @escaping (String?) -> Void) {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
      .flatMap { $0.attachments ?? [] }
    guard let provider = providers.first(where: {
      $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
    }) else {
      done(nil)
      return
    }
    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
      DispatchQueue.main.async { done(item as? String) }
    }
  }

  /** Extensions have no UIApplication; the responder chain reaches the host's `open`. */
  private func openApp(_ url: URL) {
    var responder: UIResponder? = self
    while let next = responder {
      if let app = next as? UIApplication {
        app.open(url, options: [:], completionHandler: nil)
        return
      }
      responder = next.next
    }
  }
}
