import Foundation
import React
import BackgroundAssets
import System

/// The bundled chat model's asset packs for JS (src/services/bundledModel): the same contract as
/// Android's BundledModelModule. Each pack's state, the folder that holds its files once it is on the
/// phone, and progress events while it downloads.
///
/// Apple hosts the packs (Background Assets, "prefetch" during install) on iOS 26 and later. On iOS 17-25
/// there is no pack: every pack is "not_installed", and the app's regular download serves.
@objc(BundledModel)
class BundledModelModule: RCTEventEmitter {

  private static let event = "BundledModelPack"
  private var listening = false
  private var watchers: [Task<Void, Never>] = []

  @objc override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { [Self.event] }
  override func startObserving() { listening = true }
  override func stopObserving() { listening = false }

  @objc(getPacks:resolver:rejecter:)
  func getPacks(_ names: [String], resolver resolve: @escaping RCTPromiseResolveBlock,
                rejecter _: @escaping RCTPromiseRejectBlock) {
    guard #available(iOS 26, *) else { resolve(Self.absent(names)); return }
    Task {
      var map: [String: Any] = [:]
      for name in names { map[name] = await Self.state(of: name) }
      resolve(map)
      self.watch(names)
    }
  }

  /// Ask for the packs now; the answer is their state when the request began.
  @objc(fetch:resolver:rejecter:)
  func fetch(_ names: [String], resolver resolve: @escaping RCTPromiseResolveBlock,
             rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard #available(iOS 26, *) else { resolve(Self.absent(names)); return }
    watch(names)
    Task {
      var map: [String: Any] = [:]
      for name in names {
        map[name] = await Self.state(of: name)
        if let pack = try? await AssetPackManager.shared.assetPack(withID: name) {
          Task.detached { try? await AssetPackManager.shared.ensureLocalAvailability(of: pack) }
        }
      }
      resolve(map)
    }
  }

  /// Forget a pack once its files are copied into the models folder, so the system frees the space.
  @objc(removePack:resolver:rejecter:)
  func removePack(_ name: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                  rejecter _: @escaping RCTPromiseRejectBlock) {
    guard #available(iOS 26, *) else { resolve(false); return }
    Task {
      do { try await AssetPackManager.shared.remove(assetPackWithID: name); resolve(true) } catch { resolve(false) }
    }
  }

  override func invalidate() {
    watchers.forEach { $0.cancel() }
    watchers.removeAll()
    super.invalidate()
  }

  @available(iOS 26, *)
  private func watch(_ names: [String]) {
    guard watchers.isEmpty else { return }
    watchers = names.map { name in
      Task { [weak self] in
        for await update in AssetPackManager.shared.statusUpdates(forAssetPackWithID: name) {
          guard let self, self.listening else { continue }
          self.sendEvent(withName: Self.event, body: Self.state(of: name, update: update))
        }
      }
    }
  }

  // MARK: - States

  private static func absent(_ names: [String]) -> [String: Any] {
    Dictionary(uniqueKeysWithValues: names.map { ($0, row($0, status: "not_installed")) })
  }

  private static func row(_ name: String, status: String, bytes: Int64 = 0, total: Int64 = 0,
                          path: String? = nil) -> [String: Any] {
    ["name": name, "status": status, "bytesDownloaded": bytes, "totalBytes": total, "errorCode": 0,
     "assetsPath": path ?? NSNull()]
  }

  /// The folder of an arrived pack: where its first file lives (files sit at the pack's root).
  @available(iOS 26, *)
  private static func folder(of name: String) -> String? {
    // url(for:) answers only for a file in a pack that is on the phone (an iOS 26.0 API; the
    // availability check is 26.4).
    let file = name == "chat_mmproj" ? "mmproj-LFM3-VL-2B-F16.gguf" : "LFM3-VL-2B-Q4_K_M.gguf"
    guard let url = try? AssetPackManager.shared.url(for: FilePath(file)),
          FileManager.default.fileExists(atPath: url.path) else { return nil }
    return url.deletingLastPathComponent().path
  }

  @available(iOS 26, *)
  private static func state(of name: String) async -> [String: Any] {
    if let path = folder(of: name) { return row(name, status: "completed", path: path) }
    guard let pack = try? await AssetPackManager.shared.assetPack(withID: name) else {
      return row(name, status: "not_installed")
    }
    // Known to the store and not here yet: prefetch is bringing it, or it will on request.
    return row(name, status: "pending", total: Int64(pack.downloadSize))
  }

  @available(iOS 26, *)
  private static func state(of name: String, update: AssetPackManager.DownloadStatusUpdate) -> [String: Any] {
    switch update {
    case .began(let pack):
      return row(name, status: "downloading", total: Int64(pack.downloadSize))
    case .paused(let pack):
      return row(name, status: "waiting_for_wifi", total: Int64(pack.downloadSize))
    case .downloading(let pack, let progress):
      let total = Int64(pack.downloadSize)
      return row(name, status: "downloading", bytes: Int64(Double(total) * progress.fractionCompleted), total: total)
    case .finished(let pack):
      let total = Int64(pack.downloadSize)
      return row(name, status: "completed", bytes: total, total: total, path: folder(of: name))
    case .failed(let pack, _):
      return row(name, status: "failed", total: Int64(pack.downloadSize))
    @unknown default:
      return row(name, status: "unknown")
    }
  }
}
