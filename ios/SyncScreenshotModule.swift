import Foundation
import Photos
import UIKit
import UniformTypeIdentifiers

@objc(SyncScreenshotModule)
final class SyncScreenshotModule: RCTEventEmitter, PHPhotoLibraryChangeObserver {
  private var enabled = false
  private var hasListeners = false
  private var assetCursor = SyncScreenshotAssetCursor()
  private var observingPhotoLibrary = false

  @objc
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String] {
    ["SyncScreenshotCaptured"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc
  func setEnabled(_ next: Bool) {
    DispatchQueue.main.async { [weak self] in
      guard let self, enabled != next else { return }
      enabled = next
      guard next else {
        stopPhotoLibraryObservation()
        return
      }
      PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] status in
        guard status == .authorized || status == .limited else { return }
        DispatchQueue.main.async {
          guard let self, self.enabled else { return }
          self.startPhotoLibraryObservation()
        }
      }
    }
  }

  private func startPhotoLibraryObservation() {
    guard !observingPhotoLibrary else { return }
    // Existing screenshots are the baseline. Only assets added after sharing is enabled are sent.
    let baseline = latestScreenshotAsset()
    assetCursor = SyncScreenshotAssetCursor(
      identifier: baseline?.localIdentifier,
      creationDate: baseline?.creationDate
    )
    PHPhotoLibrary.shared().register(self)
    observingPhotoLibrary = true
  }

  private func stopPhotoLibraryObservation() {
    guard observingPhotoLibrary else { return }
    PHPhotoLibrary.shared().unregisterChangeObserver(self)
    observingPhotoLibrary = false
  }

  func photoLibraryDidChange(_ changeInstance: PHChange) {
    guard enabled else { return }
    // PhotoKit calls observers on its own serial queue. React Native events and module state stay on
    // the main queue. Reading the newest screenshot also covers changes delivered as a batch.
    DispatchQueue.main.async { [weak self] in
      guard let self, self.enabled else { return }
      self.captureLatestScreenshot()
    }
  }

  private func latestScreenshotAsset() -> PHAsset? {
    let options = PHFetchOptions()
    options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    options.fetchLimit = 1
    options.predicate = NSPredicate(
      format: "(mediaSubtype & %d) != 0",
      PHAssetMediaSubtype.photoScreenshot.rawValue
    )
    return PHAsset.fetchAssets(with: .image, options: options).firstObject
  }

  private func captureLatestScreenshot() {
    guard
      let asset = latestScreenshotAsset(),
      assetCursor.advanceIfNewer(
        identifier: asset.localIdentifier,
        creationDate: asset.creationDate
      )
    else { return }

    let requestOptions = PHImageRequestOptions()
    requestOptions.isNetworkAccessAllowed = false
    requestOptions.deliveryMode = .highQualityFormat
    requestOptions.version = .current
    PHImageManager.default().requestImageDataAndOrientation(
      for: asset,
      options: requestOptions
    ) { [weak self] data, typeIdentifier, _, _ in
      guard let self, let data else { return }
      self.persist(
        data: data,
        typeIdentifier: typeIdentifier,
        asset: asset
      )
    }
  }

  private func persist(
    data: Data,
    typeIdentifier: String?,
    asset: PHAsset
  ) {
    do {
      let documents = try FileManager.default.url(
        for: .documentDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let capture = try SyncScreenshotFileWriter.persist(
        data: data,
        typeIdentifier: typeIdentifier,
        createdAt: asset.creationDate ?? Date(),
        width: asset.pixelWidth,
        height: asset.pixelHeight,
        documentsURL: documents
      )
      guard hasListeners else { return }
      sendEvent(
        withName: "SyncScreenshotCaptured",
        body: capture
      )
    } catch {
      // The TypeScript owner retains queue/error state after a descriptor exists.
      // A local copy failure has no transferable file and is intentionally ignored.
    }
  }

  deinit {
    if observingPhotoLibrary {
      PHPhotoLibrary.shared().unregisterChangeObserver(self)
    }
  }
}

struct SyncScreenshotAssetCursor {
  private(set) var identifier: String?
  private(set) var creationDate: Date?

  mutating func advanceIfNewer(identifier: String, creationDate: Date?) -> Bool {
    guard
      identifier != self.identifier,
      let creationDate,
      creationDate > (self.creationDate ?? .distantPast)
    else { return false }
    self.identifier = identifier
    self.creationDate = creationDate
    return true
  }
}

enum SyncScreenshotFileWriter {
  static func persist(
    data: Data,
    typeIdentifier: String?,
    createdAt: Date,
    width: Int,
    height: Int,
    documentsURL: URL,
    syncId: UUID = UUID()
  ) throws -> [String: Any] {
    let stableId = syncId.uuidString.lowercased()
    let fileType = typeIdentifier.flatMap(UTType.init)
    let fileExtension = fileType?.preferredFilenameExtension ?? "png"
    let mimeType = fileType?.preferredMIMEType ?? "image/png"
    let name = "Screenshot-\(stableId).\(fileExtension)"
    let directory = documentsURL.appendingPathComponent(
      "sync_screenshots",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )
    let destination = directory.appendingPathComponent(name)
    try data.write(to: destination, options: .atomic)
    return [
      "syncId": stableId,
      "name": name,
      "mimeType": mimeType,
      "filePath": destination.path,
      "fileSize": data.count,
      "createdAt": createdAt.iso8601String,
      "width": width,
      "height": height,
    ]
  }
}

private extension Date {
  var iso8601String: String {
    ISO8601DateFormatter().string(from: self)
  }
}
