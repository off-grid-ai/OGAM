import XCTest

@testable import OffgridMobile

final class DownloadManagerModuleTests: XCTestCase {

  private var module: DownloadManagerModule!

  override func setUp() {
    super.setUp()
    // Every module shares one URLSession, so a download an earlier test started is still in it, and
    // a new module restores it in the background: "initially empty" then saw 1 now and then.
    // A cancelled task stays listed until it winds down, so wait until the session holds none.
    // Both sessions: the background one keeps tasks across runs, and it exists only once a module
    // has set the sessions up, so the first test makes one before clearing them.
    if DownloadManagerModule.sharedSession == nil || DownloadManagerModule.backgroundSession == nil {
      _ = DownloadManagerModule()
    }
    for session in [DownloadManagerModule.sharedSession, DownloadManagerModule.backgroundSession].compactMap({ $0 }) {
      let deadline = Date().addingTimeInterval(5)
      var remaining = 1
      while remaining > 0 && Date() < deadline {
        let listed = expectation(description: "session tasks listed")
        session.getAllTasks { tasks in
          tasks.forEach { $0.cancel() }
          remaining = tasks.count
          listed.fulfill()
        }
        wait(for: [listed], timeout: 2)
        if remaining > 0 { Thread.sleep(forTimeInterval: 0.1) }
      }
    }
    // Clear persisted download state keys so tests start clean.
    UserDefaults.standard.removeObject(forKey: "ai.offgridmobile.activeDownloads")
    UserDefaults.standard.removeObject(forKey: "ai.offgridmobile.downloadmanager.state.v1")
    module = DownloadManagerModule()
  }

  // MARK: requiresMainQueueSetup

  func testRequiresMainQueueSetupReturnsFalse() {
    XCTAssertFalse(DownloadManagerModule.requiresMainQueueSetup())
  }

  // MARK: supportedEvents

  func testSupportedEventsContainsAllExpectedEvents() {
    let events = module.supportedEvents()!
    XCTAssertTrue(events.contains("DownloadProgress"))
    XCTAssertTrue(events.contains("DownloadComplete"))
    XCTAssertTrue(events.contains("DownloadError"))
    XCTAssertEqual(events.count, 3)
  }

  // MARK: getActiveDownloads

  func testGetActiveDownloadsInitiallyEmpty() {
    let exp = expectation(description: "getActiveDownloads empty")
    module.getActiveDownloads(
      { value in
        let downloads = value as? [[String: Any]] ?? []
        XCTAssertEqual(downloads.count, 0, "No active downloads expected after fresh init")
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  // MARK: getDownloadProgress — unknown id

  func testGetDownloadProgressRejectsUnknownId() {
    let exp = expectation(description: "getDownloadProgress rejects unknown id")
    module.getDownloadProgress(
      "99_999",
      resolver: { _ in
        XCTFail("should reject for unknown download id")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "NOT_FOUND")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }

  // MARK: cancelDownload — unknown id

  func testCancelDownloadRejectsUnknownId() {
    let exp = expectation(description: "cancelDownload rejects unknown id")
    module.cancelDownload(
      "99_999",
      resolver: { _ in
        XCTFail("should reject for unknown download id")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "NOT_FOUND")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }

  // MARK: moveCompletedDownload — unknown id

  func testMoveCompletedDownloadRejectsUnknownId() {
    let exp = expectation(description: "moveCompletedDownload rejects unknown id")
    module.moveCompletedDownload(
      "99_999",
      targetPath: TestPaths.tmpModelBin,
      resolver: { _ in
        XCTFail("should reject for unknown download id")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "NOT_FOUND")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }

  // MARK: startDownload — invalid params

  func testStartDownloadRejectsMissingUrl() {
    let exp = expectation(description: "startDownload rejects missing url")
    module.startDownload(
      ["fileName": "model.bin", "modelId": "m1"],
      resolver: { _ in
        XCTFail("should reject when url is missing")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "INVALID_PARAMS")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }

  func testStartDownloadRejectsMissingFileName() {
    let exp = expectation(description: "startDownload rejects missing fileName")
    module.startDownload(
      ["url": TestPaths.exampleModelURL, "modelId": "m1"],
      resolver: { _ in
        XCTFail("should reject when fileName is missing")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "INVALID_PARAMS")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }

  func testStartDownloadRejectsMissingModelId() {
    let exp = expectation(description: "startDownload rejects missing modelId")
    module.startDownload(
      ["url": TestPaths.exampleModelURL, "fileName": "model.bin"],
      resolver: { _ in
        XCTFail("should reject when modelId is missing")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "INVALID_PARAMS")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }

  // MARK: startMultiFileDownload — invalid params

  func testStartMultiFileDownloadRejectsMissingParams() {
    let exp = expectation(description: "startMultiFileDownload rejects missing params")
    module.startMultiFileDownload(
      [:],
      resolver: { _ in
        XCTFail("should reject when params are missing")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "INVALID_PARAMS")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }

  // MARK: hideNotification parameter handling

  /// hideNotification is a silent-download flag for dependency files (e.g. mmproj).
  /// The module must not crash or reject INVALID_PARAMS because this key is present.
  /// We verify by omitting URL (which is always required) — the rejection code must
  /// be INVALID_PARAMS (missing URL), not an unexpected crash or different code.
  func testStartDownloadAcceptsHideNotificationParamWithoutCrash() {
    let exp = expectation(description: "startDownload with hideNotification rejects for missing URL only")
    module.startDownload(
      ["fileName": "dep.gguf", "modelId": "test/model", "hideNotification": true],
      resolver: { _ in
        XCTFail("should reject because URL is missing, not resolve")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "INVALID_PARAMS", "Expected INVALID_PARAMS for missing URL, not a crash from hideNotification")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }

  func testStartDownloadWithHideNotificationFalseRejectsMissingUrl() {
    let exp = expectation(description: "startDownload with hideNotification:false rejects missing url")
    module.startDownload(
      ["fileName": "dep.gguf", "modelId": "test/model", "hideNotification": false],
      resolver: { _ in
        XCTFail("should reject because URL is missing")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "INVALID_PARAMS")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }

  // MARK: - Download entry persistence (no time-based removal)

  /// Verifies that a completed download entry stays in the downloads dictionary
  /// and is returned by getActiveDownloads — iOS does not use time-based cleanup.
  func testCompletedDownloadEntryPersistsUntilMoved() {
    // Inject a completed download entry directly
    let info = DownloadManagerModule.DownloadInfo(
      downloadId: "100",
      fileName: "test-model.gguf",
      modelId: "test/model",
      totalBytes: 1_000_000,
      bytesDownloaded: 1_000_000,
      status: "completed",
      startedAt: Date().timeIntervalSince1970 * 1000,
      modelKey: nil,
      modelType: "text",
      combinedTotalBytes: 1_000_000,
      metadataJson: nil,
      task: nil,
      taskIdentifier: nil,
      localUri: TestPaths.tmpTestModelGGUF,
      fileTasks: [:],
      multiFileDestDir: nil,
      isMultiFile: false
    )
    module.queue.sync(flags: .barrier) {
      self.module.downloads["100"] = info
    }

    let exp = expectation(description: "getActiveDownloads returns completed entry")
    module.getActiveDownloads(
      { value in
        let downloads = value as? [[String: Any]] ?? []
        XCTAssertEqual(downloads.count, 1, "Completed download must persist until moveCompletedDownload is called")
        if let first = downloads.first {
          XCTAssertEqual(first["status"] as? String, "completed")
          XCTAssertEqual(first["fileName"] as? String, "test-model.gguf")
        }
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  /// Verifies that moveCompletedDownload actually moves a file from source to target.
  func testMoveCompletedDownloadMovesFileToTargetPath() {
    let fileManager = FileManager.default
    let tmpDir = NSTemporaryDirectory()
    let sourceFile = tmpDir + "dl_test_\(UUID().uuidString).bin"
    let targetFile = tmpDir + "moved_\(UUID().uuidString).bin"

    // Create a small source file
    let testData = Data(repeating: 0xAB, count: 256)
    fileManager.createFile(atPath: sourceFile, contents: testData)
    XCTAssertTrue(fileManager.fileExists(atPath: sourceFile))

    // Inject download entry pointing to the source file
    let info = DownloadManagerModule.DownloadInfo(
      downloadId: "200",
      fileName: "model.gguf",
      modelId: "test/model",
      totalBytes: 256,
      bytesDownloaded: 256,
      status: "completed",
      startedAt: Date().timeIntervalSince1970 * 1000,
      modelKey: nil,
      modelType: "text",
      combinedTotalBytes: 256,
      metadataJson: nil,
      task: nil,
      taskIdentifier: nil,
      localUri: sourceFile,
      fileTasks: [:],
      multiFileDestDir: nil,
      isMultiFile: false
    )
    module.queue.sync(flags: .barrier) {
      self.module.downloads["200"] = info
    }

    let exp = expectation(description: "moveCompletedDownload moves file")
    module.moveCompletedDownload(
      "200",
      targetPath: targetFile,
      resolver: { result in
        XCTAssertEqual(result as? String, targetFile)
        XCTAssertTrue(fileManager.fileExists(atPath: targetFile), "Target file must exist after move")
        XCTAssertFalse(fileManager.fileExists(atPath: sourceFile), "Source file must be removed after move")

        // Verify file contents
        if let movedData = fileManager.contents(atPath: targetFile) {
          XCTAssertEqual(movedData.count, 256)
        } else {
          XCTFail("Could not read moved file")
        }

        // Cleanup
        try? fileManager.removeItem(atPath: targetFile)
        exp.fulfill()
      },
      rejecter: { code, msg, _ in
        XCTFail("moveCompletedDownload should succeed but got \(code ?? ""): \(msg ?? "")")
        // Cleanup
        try? fileManager.removeItem(atPath: sourceFile)
        try? fileManager.removeItem(atPath: targetFile)
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 5)
  }

  /// Verifies that moveCompletedDownload rejects when the download is not yet completed (no localUri).
  func testMoveCompletedDownloadRejectsNotCompletedDownload() {
    // Inject a running (not completed) download entry — no localUri
    let info = DownloadManagerModule.DownloadInfo(
      downloadId: "300",
      fileName: "running-model.gguf",
      modelId: "test/model",
      totalBytes: 1_000_000,
      bytesDownloaded: 500_000,
      status: "running",
      startedAt: Date().timeIntervalSince1970 * 1000,
      modelKey: nil,
      modelType: "text",
      combinedTotalBytes: 0,
      metadataJson: nil,
      task: nil,
      taskIdentifier: nil,
      localUri: nil,
      fileTasks: [:],
      multiFileDestDir: nil,
      isMultiFile: false
    )
    module.queue.sync(flags: .barrier) {
      self.module.downloads["300"] = info
    }

    let exp = expectation(description: "moveCompletedDownload rejects not-completed download")
    module.moveCompletedDownload(
      "300",
      targetPath: TestPaths.tmpShouldNotExist,
      resolver: { _ in
        XCTFail("should reject for download that hasn't completed")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "NOT_COMPLETED")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }
}

// MARK: - AppDelegate Background URL Session Tests
