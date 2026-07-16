// swiftlint:disable file_length
import Foundation
import React

@objc(DownloadManagerModule)
class DownloadManagerModule: RCTEventEmitter {

  private struct LosslessStringId: Codable {
    let value: String

    init(_ value: String) {
      self.value = value
    }

    init(from decoder: Decoder) throws {
      let container = try decoder.singleValueContainer()
      if let stringValue = try? container.decode(String.self) {
        value = stringValue
        return
      }
      if let intValue = try? container.decode(Int64.self) {
        value = String(intValue)
        return
      }
      if let doubleValue = try? container.decode(Double.self) {
        value = String(Int64(doubleValue))
        return
      }
      throw DecodingError.typeMismatch(
        String.self,
        DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "downloadId must be string-like")
      )
    }

    func encode(to encoder: Encoder) throws {
      var container = encoder.singleValueContainer()
      try container.encode(value)
    }
  }

  // MARK: - Types

  struct FileTask {
    let url: URL
    let relativePath: String
    let destinationDir: String
    var task: URLSessionDownloadTask?
    var taskIdentifier: Int
    var bytesDownloaded: Int64
    var totalBytes: Int64
    var completed: Bool
  }

  struct DownloadInfo {
    let downloadId: String
    let fileName: String
    let modelId: String
    var totalBytes: Int64
    var bytesDownloaded: Int64
    var status: String // pending, running, paused, completed, failed
    var startedAt: Double
    // v3 fields — mirrors Android WorkManager columns so JS hydration works on both platforms
    var modelKey: String?
    var modelType: String
    var combinedTotalBytes: Int64
    var metadataJson: String?
    // Single-file download
    var task: URLSessionDownloadTask?
    var taskIdentifier: Int?
    var localUri: String?
    // Multi-file download
    var fileTasks: [Int: FileTask] // taskIdentifier -> FileTask
    var multiFileDestDir: String?
    var isMultiFile: Bool
  }

  struct PersistedFileTask: Codable {
    let taskIdentifier: Int
    let url: String
    let relativePath: String
    let destinationDir: String
    let bytesDownloaded: Int64
    let totalBytes: Int64
    let completed: Bool
  }

  struct PersistedDownloadInfo: Codable {
    let downloadId: String
    let fileName: String
    let modelId: String
    let totalBytes: Int64
    let bytesDownloaded: Int64
    let status: String
    let startedAt: Double
    let modelKey: String?
    let modelType: String
    let combinedTotalBytes: Int64
    let metadataJson: String?
    let taskIdentifier: Int?
    let localUri: String?
    let multiFileDestDir: String?
    let isMultiFile: Bool
    let fileTasks: [PersistedFileTask]

    enum CodingKeys: String, CodingKey {
      case downloadId, fileName, modelId, totalBytes, bytesDownloaded, status,
           startedAt, modelKey, modelType, combinedTotalBytes, metadataJson,
           taskIdentifier, localUri, multiFileDestDir, isMultiFile, fileTasks
    }

    init(
      downloadId: String,
      fileName: String,
      modelId: String,
      totalBytes: Int64,
      bytesDownloaded: Int64,
      status: String,
      startedAt: Double,
      modelKey: String?,
      modelType: String,
      combinedTotalBytes: Int64,
      metadataJson: String?,
      taskIdentifier: Int?,
      localUri: String?,
      multiFileDestDir: String?,
      isMultiFile: Bool,
      fileTasks: [PersistedFileTask]
    ) {
      self.downloadId = downloadId
      self.fileName = fileName
      self.modelId = modelId
      self.totalBytes = totalBytes
      self.bytesDownloaded = bytesDownloaded
      self.status = status
      self.startedAt = startedAt
      self.modelKey = modelKey
      self.modelType = modelType
      self.combinedTotalBytes = combinedTotalBytes
      self.metadataJson = metadataJson
      self.taskIdentifier = taskIdentifier
      self.localUri = localUri
      self.multiFileDestDir = multiFileDestDir
      self.isMultiFile = isMultiFile
      self.fileTasks = fileTasks
    }

    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      downloadId = try container.decode(LosslessStringId.self, forKey: .downloadId).value
      fileName = try container.decode(String.self, forKey: .fileName)
      modelId = try container.decode(String.self, forKey: .modelId)
      totalBytes = try container.decode(Int64.self, forKey: .totalBytes)
      bytesDownloaded = try container.decode(Int64.self, forKey: .bytesDownloaded)
      status = try container.decode(String.self, forKey: .status)
      startedAt = try container.decode(Double.self, forKey: .startedAt)
      // Decode with defaults so old persisted state (pre-v3) deserialises without crashing
      modelKey = try container.decodeIfPresent(String.self, forKey: .modelKey)
      modelType = (try container.decodeIfPresent(String.self, forKey: .modelType)) ?? "text"
      combinedTotalBytes = (try container.decodeIfPresent(Int64.self, forKey: .combinedTotalBytes)) ?? 0
      metadataJson = try container.decodeIfPresent(String.self, forKey: .metadataJson)
      taskIdentifier = try container.decodeIfPresent(Int.self, forKey: .taskIdentifier)
      localUri = try container.decodeIfPresent(String.self, forKey: .localUri)
      multiFileDestDir = try container.decodeIfPresent(String.self, forKey: .multiFileDestDir)
      isMultiFile = try container.decode(Bool.self, forKey: .isMultiFile)
      fileTasks = try container.decode([PersistedFileTask].self, forKey: .fileTasks)
    }
  }

  struct TaskDescription: Codable {
    let downloadId: String
    let fileName: String
    let modelId: String
    let isMultiFile: Bool
    let relativePath: String?
    let destinationDir: String?
    let fileSize: Int64?
    let totalBytes: Int64?

    enum CodingKeys: String, CodingKey {
      case downloadId, fileName, modelId, isMultiFile, relativePath, destinationDir, fileSize, totalBytes
    }

    init(
      downloadId: String,
      fileName: String,
      modelId: String,
      isMultiFile: Bool,
      relativePath: String?,
      destinationDir: String?,
      fileSize: Int64?,
      totalBytes: Int64?
    ) {
      self.downloadId = downloadId
      self.fileName = fileName
      self.modelId = modelId
      self.isMultiFile = isMultiFile
      self.relativePath = relativePath
      self.destinationDir = destinationDir
      self.fileSize = fileSize
      self.totalBytes = totalBytes
    }

    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      downloadId = try container.decode(LosslessStringId.self, forKey: .downloadId).value
      fileName = try container.decode(String.self, forKey: .fileName)
      modelId = try container.decode(String.self, forKey: .modelId)
      isMultiFile = try container.decode(Bool.self, forKey: .isMultiFile)
      relativePath = try container.decodeIfPresent(String.self, forKey: .relativePath)
      destinationDir = try container.decodeIfPresent(String.self, forKey: .destinationDir)
      fileSize = try container.decodeIfPresent(Int64.self, forKey: .fileSize)
      totalBytes = try container.decodeIfPresent(Int64.self, forKey: .totalBytes)
    }
  }

  // MARK: - State

  static var sharedSession: URLSession?
  static var sessionDelegate: DownloadSessionDelegate?

  var downloads: [String: DownloadInfo] = [:]
  var taskToDownloadId: [Int: String] = [:] // URLSessionTask.taskIdentifier -> downloadId
  var nextDownloadId: Int64 = 1
  var pollingTimer: Timer?
  let queue = DispatchQueue(label: "ai.offgridmobile.downloadmanager", attributes: .concurrent)
  var hasListeners = false
  private let storageKey = "ai.offgridmobile.downloadmanager.state.v1"

  // MARK: - Backup Exclusion

  @discardableResult
  static func excludeFromBackup(at url: URL) -> Bool {
    var mutableURL = url
    do {
      var resourceValues = URLResourceValues()
      resourceValues.isExcludedFromBackup = true
      try mutableURL.setResourceValues(resourceValues)
      NSLog("[DownloadManager] Excluded from backup: %@", url.path)
      return true
    } catch {
      NSLog("[DownloadManager] Failed to exclude from backup %@: %@", url.path, error.localizedDescription)
      return false
    }
  }

  private static func isPathWithinAppSandbox(_ path: String) -> Bool {
    let documentsDir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first ?? ""
    let cachesDir = NSSearchPathForDirectoriesInDomains(.cachesDirectory, .userDomainMask, true).first ?? ""
    let tmpDir = NSTemporaryDirectory()
    let resolved = (path as NSString).standardizingPath
    return resolved.hasPrefix(documentsDir) || resolved.hasPrefix(cachesDir) || resolved.hasPrefix(tmpDir)
  }

  // MARK: - Durable staging

  /// A DURABLE directory to stage a completed download until JS finalizes it (moves it to the model
  /// dir / unzips it). This MUST NOT be NSTemporaryDirectory(): iOS reaps the temp dir across app
  /// relaunches and under memory pressure, so a completed-but-not-yet-finalized file staged there is
  /// gone by the time finalization runs — especially after the queued-survival rework, which now
  /// restores and finalizes downloads AFTER a relaunch. A large image zip (multi-GB) is the worst case:
  /// it commonly spans a backgrounding/relaunch before its unzip completes, and the vanished staged
  /// zip surfaced as "…couldn't be opened because there is no such file" on iOS. Documents is durable
  /// (never auto-purged), inside the sandbox allowlist, and we exclude it from iCloud backup.
  static func completedStagingDirectory() -> String {
    let documentsDir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first
      ?? NSTemporaryDirectory()
    let dir = (documentsDir as NSString).appendingPathComponent(".download-staging")
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    excludeFromBackup(at: URL(fileURLWithPath: dir))
    return dir
  }

  // MARK: - RCTEventEmitter

  override init() {
    super.init()
    NSLog("[DownloadManager] Module initialized")
    setupSession()
  }

  @objc override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["DownloadProgress", "DownloadComplete", "DownloadError"]
  }

  override func startObserving() {
    hasListeners = true
    NSLog("[DownloadManager] startObserving called — hasListeners = true")
  }

  override func stopObserving() {
    // Do NOT set hasListeners = false.
    // Our JS listeners (from BackgroundDownloadService singleton) are permanent.
    // RN's listener lifecycle sometimes calls stop/start in quick succession,
    // which would cause us to drop events during active downloads.
    NSLog("[DownloadManager] stopObserving called — KEEPING hasListeners=true (listeners are permanent)")
  }

  // MARK: - Session Setup

  func setupSession() {
    if DownloadManagerModule.sharedSession == nil {
      NSLog("[DownloadManager] Creating NEW foreground URLSession")
      // A foreground (.default) session is used instead of a background session:
      // background sessions run out-of-process in nsurlsessiond and iOS throttles
      // them for battery/reliability, which made large model downloads far slower
      // than Android (same file, same network). A default session downloads at full
      // line speed while the app is in the foreground. The trade-off is that
      // in-flight downloads do not continue after the app is suspended/killed; the
      // JS layer restarts them on next launch.
      let config = URLSessionConfiguration.default
      config.allowsCellularAccess = true
      config.httpMaximumConnectionsPerHost = 6
      config.waitsForConnectivity = true
      config.timeoutIntervalForRequest = 60
      config.timeoutIntervalForResource = 60 * 60 * 24 * 7 // 7 days for very large models
      // Multi-GB model files are never reusable cache entries; attaching a URLCache
      // is pure overhead, so disable it and always read from the network.
      config.urlCache = nil
      config.requestCachePolicy = .reloadIgnoringLocalCacheData

      let delegate = DownloadSessionDelegate(module: self)
      DownloadManagerModule.sessionDelegate = delegate
      DownloadManagerModule.sharedSession = URLSession(
        configuration: config,
        delegate: delegate,
        delegateQueue: nil
      )
      NSLog("[DownloadManager] Foreground URLSession created successfully")
    } else {
      NSLog("[DownloadManager] Reusing existing URLSession, updating delegate.module")
      DownloadManagerModule.sessionDelegate?.module = self
    }

    loadPersistedState()
    restoreTasksFromSession()
  }

  var session: URLSession {
    guard let urlSession = DownloadManagerModule.sharedSession else {
      fatalError("URLSession not initialized — setupSession() must be called before any download operations")
    }
    return urlSession
  }

  /// Builds the request used for every download task. Disables eager HTTP/3 (QUIC):
  /// for a single large transfer it is often slower than HTTP/2 on iOS (Android's
  /// OkHttp downloads over HTTP/2 and is noticeably faster). Also bypasses the cache
  /// for these large, non-reusable files.
  private func makeDownloadRequest(_ url: URL) -> URLRequest {
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    if #available(iOS 14.5, *) {
      request.assumesHTTP3Capable = false
    }
    return request
  }

  private func statusString(from taskState: URLSessionTask.State) -> String {
    switch taskState {
    case .running:
      return "running"
    case .suspended:
      return "paused"
    case .canceling:
      return "failed"
    case .completed:
      return "completed"
    @unknown default:
      return "pending"
    }
  }

  private func encodeTaskDescription(_ desc: TaskDescription) -> String? {
    guard let data = try? JSONEncoder().encode(desc) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private func decodeTaskDescription(_ raw: String?) -> TaskDescription? {
    guard let raw, let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(TaskDescription.self, from: data)
  }

  private func toPersisted(_ info: DownloadInfo) -> PersistedDownloadInfo {
    let persistedFileTasks = info.fileTasks.values.map { fileTask in
      PersistedFileTask(
        taskIdentifier: fileTask.taskIdentifier,
        url: fileTask.url.absoluteString,
        relativePath: fileTask.relativePath,
        destinationDir: fileTask.destinationDir,
        bytesDownloaded: fileTask.bytesDownloaded,
        totalBytes: fileTask.totalBytes,
        completed: fileTask.completed
      )
    }
    return PersistedDownloadInfo(
      downloadId: info.downloadId,
      fileName: info.fileName,
      modelId: info.modelId,
      totalBytes: info.totalBytes,
      bytesDownloaded: info.bytesDownloaded,
      status: info.status,
      startedAt: info.startedAt,
      modelKey: info.modelKey,
      modelType: info.modelType,
      combinedTotalBytes: info.combinedTotalBytes,
      metadataJson: info.metadataJson,
      taskIdentifier: info.taskIdentifier ?? info.task?.taskIdentifier,
      localUri: info.localUri,
      multiFileDestDir: info.multiFileDestDir,
      isMultiFile: info.isMultiFile,
      fileTasks: persistedFileTasks
    )
  }

  private func fromPersisted(_ persisted: PersistedDownloadInfo) -> DownloadInfo {
    var fileTasks: [Int: FileTask] = [:]
    for persistedTask in persisted.fileTasks {
      guard let url = URL(string: persistedTask.url) else { continue }
      fileTasks[persistedTask.taskIdentifier] = FileTask(
        url: url,
        relativePath: persistedTask.relativePath,
        destinationDir: persistedTask.destinationDir,
        task: nil,
        taskIdentifier: persistedTask.taskIdentifier,
        bytesDownloaded: persistedTask.bytesDownloaded,
        totalBytes: persistedTask.totalBytes,
        completed: persistedTask.completed
      )
    }
    return DownloadInfo(
      downloadId: persisted.downloadId,
      fileName: persisted.fileName,
      modelId: persisted.modelId,
      totalBytes: persisted.totalBytes,
      bytesDownloaded: persisted.bytesDownloaded,
      status: persisted.status,
      startedAt: persisted.startedAt,
      modelKey: persisted.modelKey,
      modelType: persisted.modelType,
      combinedTotalBytes: persisted.combinedTotalBytes,
      metadataJson: persisted.metadataJson,
      task: nil,
      taskIdentifier: persisted.taskIdentifier,
      localUri: persisted.localUri,
      fileTasks: fileTasks,
      multiFileDestDir: persisted.multiFileDestDir,
      isMultiFile: persisted.isMultiFile
    )
  }

  private func persistStateLocked() {
    let payload = downloads.values.map(toPersisted)
    do {
      let data = try JSONEncoder().encode(payload)
      UserDefaults.standard.set(data, forKey: storageKey)
    } catch {
      NSLog("[DownloadManager] Failed to persist download state: %@", error.localizedDescription)
    }
  }

  private func loadPersistedState() {
    queue.sync(flags: .barrier) {
      guard let data = UserDefaults.standard.data(forKey: storageKey) else { return }
      do {
        let payload = try JSONDecoder().decode([PersistedDownloadInfo].self, from: data)
        var restored: [String: DownloadInfo] = [:]
        var maxId: Int64 = 0
        for item in payload {
          restored[item.downloadId] = fromPersisted(item)
          if let numericId = Int64(item.downloadId), numericId > maxId { maxId = numericId }
        }
        downloads = restored
        nextDownloadId = max(maxId + 1, nextDownloadId)
        NSLog("[DownloadManager] Loaded %d persisted downloads", restored.count)
      } catch {
        NSLog("[DownloadManager] Failed to decode persisted state: %@", error.localizedDescription)
      }
    }
  }

  private func restoreMultiFileTask(
    _ downloadTask: URLSessionDownloadTask,
    desc: TaskDescription,
    relativePath: String,
    destinationDir: String,
    info: inout DownloadInfo
  ) {
    let totalBytes = downloadTask.countOfBytesExpectedToReceive > 0
      ? downloadTask.countOfBytesExpectedToReceive
      : (desc.fileSize ?? 0)
    // swiftlint:disable:next force_unwrapping
    let fallbackURL = URL(string: "about:blank")!
    let fileTask = FileTask(
      url: downloadTask.originalRequest?.url ?? fallbackURL,
      relativePath: relativePath,
      destinationDir: destinationDir,
      task: downloadTask,
      taskIdentifier: downloadTask.taskIdentifier,
      bytesDownloaded: downloadTask.countOfBytesReceived,
      totalBytes: totalBytes,
      completed: false
    )
    info.fileTasks[downloadTask.taskIdentifier] = fileTask
    info.multiFileDestDir = destinationDir
    var aggregateBytes: Int64 = 0
    for (_, file) in info.fileTasks { aggregateBytes += file.bytesDownloaded }
    info.bytesDownloaded = aggregateBytes
    if info.totalBytes <= 0 {
      var aggregateTotal: Int64 = 0
      for (_, file) in info.fileTasks { aggregateTotal += file.totalBytes }
      info.totalBytes = aggregateTotal
    }
  }

  private func restoreTasksFromSession() {
    session.getAllTasks { [weak self] tasks in
      guard let self else { return }
      self.queue.async(flags: .barrier) {
        var maxId: Int64 = self.nextDownloadId - 1
        self.taskToDownloadId = [:]

        for task in tasks {
          guard let downloadTask = task as? URLSessionDownloadTask else { continue }
          guard let desc = self.decodeTaskDescription(downloadTask.taskDescription) else {
            NSLog("[DownloadManager] Task #%d missing taskDescription; cancelling stale task", downloadTask.taskIdentifier)
            downloadTask.cancel()
            continue
          }

          var info = self.downloads[desc.downloadId] ?? DownloadInfo(
            downloadId: desc.downloadId,
            fileName: desc.fileName,
            modelId: desc.modelId,
            totalBytes: desc.totalBytes ?? 0,
            bytesDownloaded: 0,
            status: self.statusString(from: downloadTask.state),
            startedAt: Date().timeIntervalSince1970 * 1000,
            modelKey: nil,
            modelType: "text",
            combinedTotalBytes: 0,
            metadataJson: nil,
            task: nil,
            taskIdentifier: nil,
            localUri: nil,
            fileTasks: [:],
            multiFileDestDir: desc.destinationDir,
            isMultiFile: desc.isMultiFile
          )

          if desc.isMultiFile {
            guard let relativePath = desc.relativePath, let destinationDir = desc.destinationDir else {
              continue
            }
            self.restoreMultiFileTask(downloadTask, desc: desc, relativePath: relativePath, destinationDir: destinationDir, info: &info)
          } else {
            info.task = downloadTask
            info.taskIdentifier = downloadTask.taskIdentifier
            info.bytesDownloaded = downloadTask.countOfBytesReceived
            if downloadTask.countOfBytesExpectedToReceive > 0 {
              info.totalBytes = downloadTask.countOfBytesExpectedToReceive
            }
          }

          info.status = self.statusString(from: downloadTask.state)
          self.downloads[desc.downloadId] = info
          self.taskToDownloadId[downloadTask.taskIdentifier] = desc.downloadId
          if let numericId = Int64(desc.downloadId), numericId > maxId { maxId = numericId }
        }

        self.nextDownloadId = max(self.nextDownloadId, maxId + 1)

        // Reconcile persisted downloads whose live task is gone after relaunch.
        // The foreground (.default) session does not survive suspension/kill, so a
        // previously 'running'/'pending' download has no URLSessionTask now. Left
        // as-is, getActiveDownloads() rehydrates dead work frozen at its last byte
        // count (a download that sits at 0% forever). Mark such orphans 'failed' so
        // the Download Manager shows a retry affordance and the retry path restarts
        // them cleanly (e.g. STT re-downloads via whisperService).
        let orphanedIds = self.downloads
          .filter { (_, info) in
            (info.status == "running" || info.status == "pending")
              && !self.taskToDownloadId.values.contains(info.downloadId)
          }
          .map { $0.key }
        for downloadId in orphanedIds {
          self.downloads[downloadId]?.status = "failed"
          NSLog("[DownloadManager] Orphaned download #%@ marked failed — no live task after relaunch", downloadId)
        }

        self.persistStateLocked()
        NSLog("[DownloadManager] Restored %d URLSession tasks (%d downloads), %d orphaned → failed", self.taskToDownloadId.count, self.downloads.count, orphanedIds.count)
      }
    }
  }
}

// MARK: - React Methods

extension DownloadManagerModule {

  @objc func startDownload(_ params: NSDictionary,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    NSLog("[DownloadManager] startDownload called with params: %@", params)

    guard let urlString = params["url"] as? String,
          let url = URL(string: urlString),
          let fileName = params["fileName"] as? String,
          let modelId = params["modelId"] as? String else {
      NSLog("[DownloadManager] startDownload: INVALID_PARAMS — missing url, fileName, or modelId")
      reject("INVALID_PARAMS", "Missing url, fileName, or modelId", nil)
      return
    }

    let totalBytes = (params["totalBytes"] as? NSNumber)?.int64Value ?? 0
    let modelKey = params["modelKey"] as? String
    let modelType = (params["modelType"] as? String) ?? "text"
    let combinedTotalBytes = (params["combinedTotalBytes"] as? NSNumber)?.int64Value ?? 0
    let metadataJson = params["metadataJson"] as? String
    let downloadId = queue.sync(flags: .barrier) { () -> String in
      let id = String(nextDownloadId)
      nextDownloadId += 1
      return id
    }

    NSLog("[DownloadManager] Starting download #%@: url=%@, fileName=%@, modelId=%@, totalBytes=%lld, modelType=%@",
          downloadId, urlString, fileName, modelId, totalBytes, modelType)

    let task = session.downloadTask(with: makeDownloadRequest(url))
    task.taskDescription = encodeTaskDescription(TaskDescription(
      downloadId: downloadId,
      fileName: fileName,
      modelId: modelId,
      isMultiFile: false,
      relativePath: nil,
      destinationDir: nil,
      fileSize: nil,
      totalBytes: totalBytes
    ))
    NSLog("[DownloadManager] Created URLSessionDownloadTask #%d for download #%@", task.taskIdentifier, downloadId)

    let info = DownloadInfo(
      downloadId: downloadId,
      fileName: fileName,
      modelId: modelId,
      totalBytes: totalBytes,
      bytesDownloaded: 0,
      status: "running",
      startedAt: Date().timeIntervalSince1970 * 1000,
      modelKey: modelKey,
      modelType: modelType,
      combinedTotalBytes: combinedTotalBytes,
      metadataJson: metadataJson,
      task: task,
      taskIdentifier: task.taskIdentifier,
      localUri: nil,
      fileTasks: [:],
      multiFileDestDir: nil,
      isMultiFile: false
    )

    queue.sync(flags: .barrier) {
      self.downloads[downloadId] = info
      self.taskToDownloadId[task.taskIdentifier] = downloadId
      self.persistStateLocked()
      NSLog("[DownloadManager] Stored download #%@ in state (total: %d, taskMap: %d)",
            downloadId, self.downloads.count, self.taskToDownloadId.count)
    }

    task.resume()
    NSLog("[DownloadManager] task.resume() called for download #%@", downloadId)

    resolve([
      "downloadId": downloadId,
      "fileName": fileName,
      "modelId": modelId
    ] as [String: Any])
  }

  /// Start a multi-file download (for Core ML models that are directory trees, not zips)
  @objc func startMultiFileDownload(_ params: NSDictionary,
                                    resolver resolve: @escaping RCTPromiseResolveBlock,
                                    rejecter reject: @escaping RCTPromiseRejectBlock) {
    NSLog("[DownloadManager] startMultiFileDownload called with params: %@", params)

    guard let filesArray = params["files"] as? [[String: Any]],
          let fileName = params["fileName"] as? String,
          let modelId = params["modelId"] as? String,
          let destinationDir = params["destinationDir"] as? String else {
      NSLog("[DownloadManager] startMultiFileDownload: INVALID_PARAMS")
      reject("INVALID_PARAMS", "Missing files, fileName, modelId, or destinationDir", nil)
      return
    }

    let totalBytes = (params["totalBytes"] as? NSNumber)?.int64Value ?? 0
    let downloadId = queue.sync(flags: .barrier) { () -> String in
      let id = String(nextDownloadId)
      nextDownloadId += 1
      return id
    }

    NSLog("[DownloadManager] Starting multi-file download #%@: %d files, totalBytes=%lld, dest=%@",
          downloadId, filesArray.count, totalBytes, destinationDir)

    let fileManager = FileManager.default
    try? fileManager.createDirectory(atPath: destinationDir, withIntermediateDirectories: true)

    var fileTasks: [Int: FileTask] = [:]
    var tasks: [URLSessionDownloadTask] = []

    for (index, fileInfo) in filesArray.enumerated() {
      guard let urlString = fileInfo["url"] as? String,
            let url = URL(string: urlString),
            let relativePath = fileInfo["relativePath"] as? String else {
        NSLog("[DownloadManager] Skipping file %d: missing url or relativePath", index)
        continue
      }

      let fileSize = (fileInfo["size"] as? NSNumber)?.int64Value ?? 0
      let task = session.downloadTask(with: makeDownloadRequest(url))
      task.taskDescription = encodeTaskDescription(TaskDescription(
        downloadId: downloadId,
        fileName: fileName,
        modelId: modelId,
        isMultiFile: true,
        relativePath: relativePath,
        destinationDir: destinationDir,
        fileSize: fileSize,
        totalBytes: totalBytes
      ))

      NSLog("[DownloadManager] File %d/%d: task#%d, relativePath=%@, size=%lld, url=%@",
            index + 1, filesArray.count, task.taskIdentifier, relativePath, fileSize, urlString)

      let fileTask = FileTask(
        url: url,
        relativePath: relativePath,
        destinationDir: destinationDir,
        task: task,
        taskIdentifier: task.taskIdentifier,
        bytesDownloaded: 0,
        totalBytes: fileSize,
        completed: false
      )

      fileTasks[task.taskIdentifier] = fileTask
      tasks.append(task)
    }

    let info = DownloadInfo(
      downloadId: downloadId,
      fileName: fileName,
      modelId: modelId,
      totalBytes: totalBytes,
      bytesDownloaded: 0,
      status: "running",
      startedAt: Date().timeIntervalSince1970 * 1000,
      modelKey: params["modelKey"] as? String,
      modelType: (params["modelType"] as? String) ?? "text",
      combinedTotalBytes: (params["combinedTotalBytes"] as? NSNumber)?.int64Value ?? 0,
      metadataJson: params["metadataJson"] as? String,
      task: nil,
      taskIdentifier: nil,
      localUri: nil,
      fileTasks: fileTasks,
      multiFileDestDir: destinationDir,
      isMultiFile: true
    )

    queue.sync(flags: .barrier) {
      self.downloads[downloadId] = info
      for task in tasks {
        self.taskToDownloadId[task.taskIdentifier] = downloadId
      }
      self.persistStateLocked()
      NSLog("[DownloadManager] Stored multi-file download #%@ in state (taskMap entries: %d)",
            downloadId, self.taskToDownloadId.count)
    }

    for task in tasks {
      task.resume()
    }
    NSLog("[DownloadManager] Resumed all %d tasks for multi-file download #%@", tasks.count, downloadId)

    resolve([
      "downloadId": downloadId,
      "fileName": fileName,
      "modelId": modelId
    ] as [String: Any])
  }

  @objc func cancelDownload(_ downloadId: String,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
    let id = downloadId
    NSLog("[DownloadManager] cancelDownload called for #%@", id)
    queue.async(flags: .barrier) {
      guard let info = self.downloads[id] else {
        NSLog("[DownloadManager] cancelDownload: download #%@ NOT FOUND", id)
        reject("NOT_FOUND", "Download \(id) not found", nil)
        return
      }
      if info.isMultiFile {
        for (_, fileTask) in info.fileTasks {
          fileTask.task?.cancel()
          self.taskToDownloadId.removeValue(forKey: fileTask.taskIdentifier)
        }
      } else {
        info.task?.cancel()
        if let taskId = info.taskIdentifier ?? info.task?.taskIdentifier {
          self.taskToDownloadId.removeValue(forKey: taskId)
        }
      }
      self.downloads[id]?.status = "failed"
      self.downloads.removeValue(forKey: id)
      self.persistStateLocked()
      NSLog("[DownloadManager] Download #%@ cancelled and removed", id)
      resolve(nil)
    }
  }

  @objc func getActiveDownloads(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    queue.sync {
      NSLog("[DownloadManager] getActiveDownloads: %d downloads in state", downloads.count)
      let result = downloads.values.map { info -> [String: Any] in
        NSLog("[DownloadManager]   -> #%@: %@ status=%@ bytes=%lld/%lld",
              info.downloadId, info.fileName, info.status, info.bytesDownloaded, info.totalBytes)
        var entry: [String: Any] = [
          "downloadId": info.downloadId,
          "fileName": info.fileName,
          "modelId": info.modelId,
          "status": info.status,
          "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
          "totalBytes": NSNumber(value: info.totalBytes),
          "startedAt": NSNumber(value: info.startedAt),
          "modelType": info.modelType,
          "combinedTotalBytes": NSNumber(value: info.combinedTotalBytes),
          "createdAt": NSNumber(value: info.startedAt)
        ]
        if let modelKey = info.modelKey { entry["modelKey"] = modelKey }
        if let metadataJson = info.metadataJson { entry["metadataJson"] = metadataJson }
        return entry
      }
      resolve(result)
    }
  }

  @objc func getDownloadProgress(_ downloadId: String,
                                 resolver resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    let id = downloadId
    queue.sync {
      guard let info = downloads[id] else {
        NSLog("[DownloadManager] getDownloadProgress: #%@ NOT FOUND", id)
        reject("NOT_FOUND", "Download \(id) not found", nil)
        return
      }
      NSLog("[DownloadManager] getDownloadProgress #%@: %@ %lld/%lld",
            id, info.status, info.bytesDownloaded, info.totalBytes)
      resolve([
        "downloadId": info.downloadId,
        "fileName": info.fileName,
        "modelId": info.modelId,
        "status": info.status,
        "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
        "totalBytes": NSNumber(value: info.totalBytes)
      ] as [String: Any])
    }
  }

  @objc func moveCompletedDownload(_ downloadId: String,
                                   targetPath: String,
                                   resolver resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    let id = downloadId
    NSLog("[DownloadManager] moveCompletedDownload #%@ -> %@", id, targetPath)

    // Read download info with a short sync read, then do heavy I/O async
    // so the RN bridge thread is not blocked during large file moves.
    var snapshotInfo: DownloadInfo?
    queue.sync { snapshotInfo = downloads[id] }

    guard let info = snapshotInfo else {
      NSLog("[DownloadManager] moveCompletedDownload: #%@ NOT FOUND", id)
      reject("NOT_FOUND", "Download \(id) not found or not completed", nil)
      return
    }

    if info.isMultiFile {
      NSLog("[DownloadManager] Multi-file download already at: %@", info.multiFileDestDir ?? "nil")
      let destDir = info.multiFileDestDir ?? targetPath
      DownloadManagerModule.excludeFromBackup(at: URL(fileURLWithPath: destDir))
      // Multi-file: no heavy I/O — just cleanup state and resolve immediately
      queue.async(flags: .barrier) {
        self.downloads.removeValue(forKey: id)
        self.persistStateLocked()
      }
      resolve(destDir)
      return
    }

    guard let localUri = info.localUri else {
      NSLog("[DownloadManager] moveCompletedDownload: #%@ localUri is nil (not completed yet)", id)
      reject("NOT_COMPLETED", "Download \(id) not completed yet", nil)
      return
    }

    // Perform heavy file I/O on a background queue so the JS thread stays free
    DispatchQueue.global(qos: .userInitiated).async {
      NSLog("[DownloadManager] Moving from %@ to %@ (background)", localUri, targetPath)

      let fileManager = FileManager.default
      let sourceURL = URL(fileURLWithPath: localUri)
      let targetURL = URL(fileURLWithPath: targetPath)
      let parentDir = targetURL.deletingLastPathComponent()
      try? fileManager.createDirectory(at: parentDir, withIntermediateDirectories: true)
      try? fileManager.removeItem(at: targetURL)

      do {
        do {
          try fileManager.moveItem(at: sourceURL, to: targetURL)
          NSLog("[DownloadManager] File moved successfully")
        } catch {
          NSLog("[DownloadManager] moveItem failed: %@, trying copyItem", error.localizedDescription)
          try fileManager.copyItem(at: sourceURL, to: targetURL)
          try? fileManager.removeItem(at: sourceURL)
          NSLog("[DownloadManager] File copied successfully")
        }
        DownloadManagerModule.excludeFromBackup(at: targetURL)
        self.queue.async(flags: .barrier) {
          self.downloads.removeValue(forKey: id)
          self.persistStateLocked()
          resolve(targetPath)
        }
      } catch {
        NSLog("[DownloadManager] copyItem also failed: %@", error.localizedDescription)
        reject("MOVE_FAILED", "Failed to move file: \(error.localizedDescription)", error)
      }
    }
  }

  @objc func excludePathFromBackup(
    _ path: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard DownloadManagerModule.isPathWithinAppSandbox(path) else {
      NSLog("[DownloadManager] excludePathFromBackup: path outside sandbox: %@", path)
      reject("INVALID_PATH", "Path is outside the app sandbox", nil)
      return
    }
    guard FileManager.default.fileExists(atPath: path) else {
      resolve(false)
      return
    }
    let result = DownloadManagerModule.excludeFromBackup(at: URL(fileURLWithPath: path))
    resolve(result)
  }

  @objc func startProgressPolling() {
    NSLog("[DownloadManager] startProgressPolling called (hasListeners=%d)", hasListeners ? 1 : 0)
    DispatchQueue.main.async {
      guard self.pollingTimer == nil else {
        NSLog("[DownloadManager] Polling timer already running, skipping")
        return
      }
      self.pollingTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
        self?.pollProgress()
      }
      NSLog("[DownloadManager] Polling timer STARTED (1.5s interval)")
    }
  }

  @objc func stopProgressPolling() {
    NSLog("[DownloadManager] stopProgressPolling called")
    DispatchQueue.main.async {
      self.pollingTimer?.invalidate()
      self.pollingTimer = nil
      NSLog("[DownloadManager] Polling timer STOPPED")
    }
  }

  @objc override func addListener(_ eventName: String) {
    NSLog("[DownloadManager] addListener('%@') called — calling super", eventName)
    super.addListener(eventName)
    NSLog("[DownloadManager] addListener('%@') done — hasListeners should now be true", eventName)
  }

  @objc override func removeListeners(_ count: Double) {
    NSLog("[DownloadManager] removeListeners(%d) called — calling super", count)
    super.removeListeners(count)
  }

  // MARK: - Progress Polling

  func pollProgress() {
    guard hasListeners else { return }
    queue.async(flags: .barrier) { [weak self] in
      guard let self = self else { return }
      let activeDownloads = self.downloads.filter { $0.value.status == "running" || $0.value.status == "pending" || $0.value.status == "paused" }
      var events: [[String: Any]] = []
      for (_, var info) in activeDownloads {
        if info.isMultiFile {
          var aggregateBytes: Int64 = 0
          var aggregateTotal: Int64 = 0
          for (taskId, var fileTask) in info.fileTasks {
            if let task = fileTask.task {
              fileTask.bytesDownloaded = task.countOfBytesReceived
              if task.countOfBytesExpectedToReceive > 0 {
                fileTask.totalBytes = task.countOfBytesExpectedToReceive
              }
              info.fileTasks[taskId] = fileTask
            }
            aggregateBytes += fileTask.bytesDownloaded
            aggregateTotal += fileTask.totalBytes
          }
          info.bytesDownloaded = aggregateBytes
          if info.totalBytes <= 0 { info.totalBytes = aggregateTotal }
        } else if let task = info.task {
          info.bytesDownloaded = task.countOfBytesReceived
          if task.countOfBytesExpectedToReceive > 0 {
            info.totalBytes = task.countOfBytesExpectedToReceive
          }
          info.status = self.statusString(from: task.state)
        }
        self.downloads[info.downloadId] = info
        events.append([
          "downloadId": info.downloadId,
          "fileName": info.fileName,
          "modelId": info.modelId,
          "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
          "totalBytes": NSNumber(value: info.totalBytes),
          "status": info.status
        ] as [String: Any])
      }
      if !events.isEmpty {
        DispatchQueue.main.async { [weak self] in
          for event in events {
            self?.sendEvent(withName: "DownloadProgress", body: event)
          }
        }
      }
    }
  }
}

// MARK: - URLSession Delegate Callbacks

extension DownloadManagerModule {

  fileprivate func handleProgress(taskId: Int,
                                  bytesWritten: Int64,
                                  totalBytesWritten: Int64,
                                  totalBytesExpected: Int64) {
    queue.async(flags: .barrier) {
      guard let downloadId = self.taskToDownloadId[taskId],
            var info = self.downloads[downloadId] else {
        NSLog("[DownloadManager] handleProgress: task#%d NOT FOUND in taskToDownloadId (map has %d entries)",
              taskId, self.taskToDownloadId.count)
        return
      }

      if info.isMultiFile {
        if var fileTask = info.fileTasks[taskId] {
          fileTask.bytesDownloaded = totalBytesWritten
          if totalBytesExpected > 0 { fileTask.totalBytes = totalBytesExpected }
          info.fileTasks[taskId] = fileTask
        }
        var totalDown: Int64 = 0
        for (_, fileTask) in info.fileTasks { totalDown += fileTask.bytesDownloaded }
        info.bytesDownloaded = totalDown
        info.status = "running"
        if totalBytesWritten % (5 * 1024 * 1024) < bytesWritten || totalBytesWritten == bytesWritten {
          NSLog("[DownloadManager] Multi-file progress: download#%@ task#%d: %lld/%lld (aggregate: %lld/%lld)",
                downloadId, taskId, totalBytesWritten, totalBytesExpected, info.bytesDownloaded, info.totalBytes)
        }
      } else {
        info.bytesDownloaded = totalBytesWritten
        if totalBytesExpected > 0 { info.totalBytes = totalBytesExpected }
        info.status = "running"
        info.taskIdentifier = taskId
        if totalBytesWritten % (5 * 1024 * 1024) < bytesWritten || totalBytesWritten == bytesWritten {
          NSLog("[DownloadManager] Progress: download#%@ task#%d: %lld/%lld",
                downloadId, taskId, totalBytesWritten, totalBytesExpected)
        }
      }

      self.downloads[downloadId] = info
    }
  }

  fileprivate func handleCompletion(taskId: Int, location: URL) {
    NSLog("[DownloadManager] handleCompletion: task#%d, location=%@", taskId, location.path)
    queue.async(flags: .barrier) {
      guard let downloadId = self.taskToDownloadId[taskId],
            var info = self.downloads[downloadId] else {
        NSLog("[DownloadManager] handleCompletion: task#%d NOT FOUND in taskToDownloadId", taskId)
        return
      }

      let fileManager = FileManager.default
      NSLog("[DownloadManager] handleCompletion for download#%@ (%@), isMultiFile=%d, hasListeners=%d",
            downloadId, info.fileName, info.isMultiFile ? 1 : 0, self.hasListeners ? 1 : 0)

      if info.isMultiFile {
        self.handleMultiFileTaskCompletion(
          taskId: taskId, location: location, downloadId: downloadId,
          info: &info, fileManager: fileManager
        )
      } else {
        self.handleSingleFileCompletion(
          taskId: taskId, location: location, downloadId: downloadId,
          info: &info, fileManager: fileManager
        )
      }
    }
  }

  private func handleMultiFileTaskCompletion(taskId: Int,
                                             location: URL,
                                             downloadId: String,
                                             info: inout DownloadInfo,
                                             fileManager: FileManager) {
    guard var fileTask = info.fileTasks[taskId] else {
      NSLog("[DownloadManager] handleCompletion: task#%d NOT FOUND in fileTasks", taskId)
      return
    }
    let destPath = "\(fileTask.destinationDir)/\(fileTask.relativePath)"
    let destURL = URL(fileURLWithPath: destPath)

    NSLog("[DownloadManager] Moving file task#%d: %@ -> %@", taskId, location.path, destPath)

    let parentDir = destURL.deletingLastPathComponent()
    try? fileManager.createDirectory(at: parentDir, withIntermediateDirectories: true)
    try? fileManager.removeItem(at: destURL)

    do {
      try fileManager.moveItem(at: location, to: destURL)
      NSLog("[DownloadManager] File moved: %@", fileTask.relativePath)
    } catch {
      NSLog("[DownloadManager] moveItem failed for %@: %@, trying copy",
            fileTask.relativePath, error.localizedDescription)
      do {
        try fileManager.copyItem(at: location, to: destURL)
        NSLog("[DownloadManager] File copied: %@", fileTask.relativePath)
      } catch {
        NSLog("[DownloadManager] Failed to save file %@: %@",
              fileTask.relativePath, error.localizedDescription)
      }
    }

    fileTask.completed = true
    info.fileTasks[taskId] = fileTask
    taskToDownloadId.removeValue(forKey: taskId)

    let completedCount = info.fileTasks.values.filter { $0.completed }.count
    NSLog("[DownloadManager] Multi-file progress: %d/%d files completed for download#%@",
          completedCount, info.fileTasks.count, downloadId)

    let allDone = info.fileTasks.values.allSatisfy { $0.completed }
    if allDone {
      NSLog("[DownloadManager] ALL files complete for download#%@!", downloadId)
      if let destDir = info.multiFileDestDir {
        DownloadManagerModule.excludeFromBackup(at: URL(fileURLWithPath: destDir))
      }
      info.status = "completed"
      info.bytesDownloaded = info.totalBytes
      info.localUri = info.multiFileDestDir
      downloads[downloadId] = info
      persistStateLocked()

      if hasListeners {
        NSLog("[DownloadManager] SENDING DownloadComplete event for #%@", downloadId)
        sendEvent(withName: "DownloadComplete", body: [
          "downloadId": info.downloadId,
          "fileName": info.fileName,
          "modelId": info.modelId,
          "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
          "totalBytes": NSNumber(value: info.totalBytes),
          "status": "completed",
          "localUri": info.multiFileDestDir ?? ""
        ] as [String: Any])
      } else {
        NSLog("[DownloadManager] Download#%@ completed but hasListeners=false, NOT sending event!", downloadId)
      }
    } else {
      downloads[downloadId] = info
      persistStateLocked()
    }
  }

  private func handleSingleFileCompletion(taskId: Int,
                                          location: URL,
                                          downloadId: String,
                                          info: inout DownloadInfo,
                                          fileManager: FileManager) {
    // Stage the completed file in a DURABLE dir (not NSTemporaryDirectory, which iOS purges across
    // relaunch / under memory pressure) so a finalize that runs after a relaunch can still find it.
    let stagingDir = DownloadManagerModule.completedStagingDirectory()
    let destPath = "\(stagingDir)/download_\(downloadId)_\(info.fileName)"
    let destURL = URL(fileURLWithPath: destPath)
    try? fileManager.removeItem(at: destURL)

    NSLog("[DownloadManager] Moving single file: %@ -> %@", location.path, destPath)

    do {
      try fileManager.moveItem(at: location, to: destURL)
      NSLog("[DownloadManager] Single file saved to: %@", destPath)
      // Exclude the staged file itself from backup (per-file flag; the dir flag is not inherited by
      // files created later). These are large model artifacts we never want in an iCloud backup.
      DownloadManagerModule.excludeFromBackup(at: destURL)
      info.localUri = destPath
      info.status = "completed"
      info.bytesDownloaded = info.totalBytes
      info.taskIdentifier = nil
      taskToDownloadId.removeValue(forKey: taskId)
      downloads[downloadId] = info
      persistStateLocked()

      if hasListeners {
      NSLog("[DownloadManager] SENDING DownloadComplete event for #%@ (single file)", downloadId)
        sendEvent(withName: "DownloadComplete", body: [
          "downloadId": info.downloadId,
          "fileName": info.fileName,
          "modelId": info.modelId,
          "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
          "totalBytes": NSNumber(value: info.totalBytes),
          "status": "completed",
          "localUri": destPath
        ] as [String: Any])
      } else {
        NSLog("[DownloadManager] Download#%@ completed but hasListeners=false, NOT sending event!", downloadId)
      }
    } catch {
      NSLog("[DownloadManager] Failed to move single file: %@", error.localizedDescription)
      info.status = "failed"
      taskToDownloadId.removeValue(forKey: taskId)
      downloads[downloadId] = info
      persistStateLocked()
      if hasListeners {
        sendEvent(withName: "DownloadError", body: [
          "downloadId": info.downloadId,
          "fileName": info.fileName,
          "modelId": info.modelId,
          "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
          "totalBytes": NSNumber(value: info.totalBytes),
          "status": "failed",
          "reason": "Failed to save download: \(error.localizedDescription)"
        ] as [String: Any])
      }
    }
  }

  fileprivate func handleError(taskId: Int, error: Error?) {
    NSLog("[DownloadManager] handleError: task#%d, error=%@", taskId, error?.localizedDescription ?? "nil")
    queue.async(flags: .barrier) {
      guard let downloadId = self.taskToDownloadId[taskId],
            var info = self.downloads[downloadId] else {
        NSLog("[DownloadManager] handleError: task#%d NOT FOUND in taskToDownloadId", taskId)
        return
      }

      NSLog("[DownloadManager] Download#%@ (%@) FAILED: %@",
            downloadId, info.fileName, error?.localizedDescription ?? "Unknown")

      if info.isMultiFile {
        NSLog("[DownloadManager] Cancelling all remaining tasks for multi-file download#%@", downloadId)
        for (_, fileTask) in info.fileTasks where !fileTask.completed {
          fileTask.task?.cancel()
          self.taskToDownloadId.removeValue(forKey: fileTask.taskIdentifier)
        }
      } else {
        self.taskToDownloadId.removeValue(forKey: taskId)
      }

      info.status = "failed"
      self.downloads[downloadId] = info
      self.persistStateLocked()

      if self.hasListeners {
        NSLog("[DownloadManager] SENDING DownloadError event for #%@", downloadId)
        self.sendEvent(withName: "DownloadError", body: [
          "downloadId": info.downloadId,
          "fileName": info.fileName,
          "modelId": info.modelId,
          "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
          "totalBytes": NSNumber(value: info.totalBytes),
          "status": "failed",
          "reason": error?.localizedDescription ?? "Unknown error"
        ] as [String: Any])
      } else {
        NSLog("[DownloadManager] Download#%@ errored but hasListeners=false, NOT sending event!", downloadId)
      }
    }
  }
}

// MARK: - URLSession Delegate

class DownloadSessionDelegate: NSObject, URLSessionDownloadDelegate {
  weak var module: DownloadManagerModule?

  init(module: DownloadManagerModule) {
    self.module = module
    super.init()
    NSLog("[DownloadManager] DownloadSessionDelegate created")
  }

  func urlSession(_: URLSession,
                  downloadTask: URLSessionDownloadTask,
                  didWriteData bytesWritten: Int64,
                  totalBytesWritten: Int64,
                  totalBytesExpectedToWrite: Int64) {
    module?.handleProgress(
      taskId: downloadTask.taskIdentifier,
      bytesWritten: bytesWritten,
      totalBytesWritten: totalBytesWritten,
      totalBytesExpected: totalBytesExpectedToWrite
    )
  }

  func urlSession(_: URLSession,
                  downloadTask: URLSessionDownloadTask,
                  didFinishDownloadingTo location: URL) {
    NSLog("[DownloadManager] Delegate: didFinishDownloadingTo for task#%d at %@",
          downloadTask.taskIdentifier, location.path)

    // CRITICAL: The file at `location` is deleted by URLSession as soon as this method returns.
    // We must copy it to a safe location SYNCHRONOUSLY before returning. That location must be
    // DURABLE (not NSTemporaryDirectory) — if the app is killed between here and handleCompletion,
    // a temp copy would be reaped and the completed bytes lost. See completedStagingDirectory().
    let fileManager = FileManager.default
    let stagingDir = DownloadManagerModule.completedStagingDirectory()
    let safeTmp = "\(stagingDir)/dl_task_\(downloadTask.taskIdentifier)_\(UUID().uuidString).tmp"
    let safeURL = URL(fileURLWithPath: safeTmp)

    do {
      try fileManager.copyItem(at: location, to: safeURL)
      NSLog("[DownloadManager] Delegate: copied temp file to safe location: %@", safeTmp)
      module?.handleCompletion(taskId: downloadTask.taskIdentifier, location: safeURL)
    } catch {
      NSLog("[DownloadManager] Delegate: FAILED to copy temp file: %@", error.localizedDescription)
      module?.handleError(taskId: downloadTask.taskIdentifier, error: error)
    }
  }

  func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error = error {
      NSLog("[DownloadManager] Delegate: didCompleteWithError for task#%d: %@",
            task.taskIdentifier, error.localizedDescription)
      module?.handleError(taskId: task.taskIdentifier, error: error)
    } else {
      NSLog("[DownloadManager] Delegate: didCompleteWithError for task#%d: NO error (success)",
            task.taskIdentifier)
    }
  }
}
