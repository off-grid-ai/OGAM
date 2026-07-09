import XCTest
import PDFKit

@testable import OffgridMobile

// MARK: - Test Constants

private enum TestPaths {
  static let nonexistentPDF = "/tmp/nonexistent.pdf"
  static let tmpModelBin = "/tmp/model.bin"
  static let exampleModelURL = "https://example.com/model.gguf"
  static let tmpTestModelGGUF = "/tmp/test-model.gguf"
  static let tmpShouldNotExist = "/tmp/should-not-exist.gguf"
}

private func makeTempDirectory() -> URL {
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

// MARK: - PDFExtractorModule Tests

final class PDFExtractorModuleTests: XCTestCase {

  private var module: PDFExtractorModule!

  override func setUp() {
    super.setUp()
    module = PDFExtractorModule()
  }

  /// Creates an n-page PDF and returns its file URL in the temp directory.
  private func makeTempPDF(pages: [(text: String, rect: CGRect)] = []) -> URL {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString + ".pdf")
    let pageSize = CGRect(x: 0, y: 0, width: 612, height: 792)
    let renderer = UIGraphicsPDFRenderer(bounds: pageSize)
    let data = renderer.pdfData { ctx in
      let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 12)]
      for page in pages {
        ctx.beginPage()
        page.text.draw(in: page.rect, withAttributes: attrs)
      }
    }
    try! data.write(to: url)
    return url
  }

  private func singlePage(text: String) -> URL {
    makeTempPDF(pages: [(text, CGRect(x: 72, y: 72, width: 468, height: 648))])
  }

  // MARK: requiresMainQueueSetup

  func testRequiresMainQueueSetupReturnsFalse() {
    XCTAssertFalse(PDFExtractorModule.requiresMainQueueSetup())
  }

  // MARK: extractText — happy path

  func testExtractTextResolvesWithContent() {
    let url = singlePage(text: "Hello, PDF World!")
    let exp = expectation(description: "resolve")

    module.extractText(
      url.absoluteString,
      maxChars: 10_000,
      resolver: { result in
        XCTAssertNotNil(result)
        exp.fulfill()
      },
      rejecter: { _, _, _ in
        XCTFail("extractText should not reject a valid PDF")
        exp.fulfill()
      }
    )

    waitForExpectations(timeout: 5)
    try? FileManager.default.removeItem(at: url)
  }

  func testExtractTextFromMultiPagePDF() {
    let url = makeTempPDF(pages: [
      ("Page one content", CGRect(x: 72, y: 72, width: 468, height: 648)),
      ("Page two content", CGRect(x: 72, y: 72, width: 468, height: 648)),
    ])
    let exp = expectation(description: "multi-page resolve")

    module.extractText(
      url.absoluteString,
      maxChars: 10_000,
      resolver: { result in
        XCTAssertNotNil(result)
        exp.fulfill()
      },
      rejecter: { _, _, _ in
        XCTFail("multi-page extractText should not reject")
        exp.fulfill()
      }
    )

    waitForExpectations(timeout: 5)
    try? FileManager.default.removeItem(at: url)
  }

  func testExtractTextFromEmptyPDF() {
    // PDF with a page but no text drawn — should resolve with empty string
    let url = makeTempPDF(pages: [("", CGRect(x: 72, y: 72, width: 468, height: 648))])
    let exp = expectation(description: "empty pdf resolve")

    module.extractText(
      url.absoluteString,
      maxChars: 10_000,
      resolver: { result in
        XCTAssertNotNil(result)
        exp.fulfill()
      },
      rejecter: { _, _, _ in
        XCTFail("empty-page PDF should not reject")
        exp.fulfill()
      }
    )

    waitForExpectations(timeout: 5)
    try? FileManager.default.removeItem(at: url)
  }

  // MARK: extractText — truncation

  func testExtractTextTruncatesAtMaxChars() {
    let longText = String(repeating: "A", count: 300)
    let url = singlePage(text: longText)
    let exp = expectation(description: "truncate")

    module.extractText(
      url.absoluteString,
      maxChars: 50,
      resolver: { result in
        let text = (result as? String) ?? ""
        XCTAssertTrue(
          text.contains("... [Extracted"),
          "Truncated result should contain page marker, got: \(text.prefix(120))"
        )
        exp.fulfill()
      },
      rejecter: { _, _, _ in
        XCTFail("extractText should not reject")
        exp.fulfill()
      }
    )

    waitForExpectations(timeout: 5)
    try? FileManager.default.removeItem(at: url)
  }

  func testExtractTextDoesNotTruncateWhenUnderLimit() {
    let shortText = "Short"
    let url = singlePage(text: shortText)
    let exp = expectation(description: "no truncate")

    module.extractText(
      url.absoluteString,
      maxChars: 10_000,
      resolver: { result in
        let text = (result as? String) ?? ""
        XCTAssertFalse(
          text.contains("... [Extracted"),
          "Short text should not be truncated"
        )
        exp.fulfill()
      },
      rejecter: { _, _, _ in
        XCTFail("should not reject")
        exp.fulfill()
      }
    )

    waitForExpectations(timeout: 5)
    try? FileManager.default.removeItem(at: url)
  }

  // MARK: extractText — error cases

  func testExtractTextRejectsInvalidPath() {
    let exp = expectation(description: "reject invalid path")

    module.extractText(
      TestPaths.nonexistentPDF,
      maxChars: 10_000,
      resolver: { _ in
        XCTFail("extractText should reject a non-existent file")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "PDF_ERROR")
        exp.fulfill()
      }
    )

    waitForExpectations(timeout: 5)
  }

  func testExtractTextRejectsNonPDFFile() {
    // Write a plain-text file and pass it as a PDF
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString + ".pdf")
    try! "not a pdf".write(to: url, atomically: true, encoding: .utf8)
    let exp = expectation(description: "reject non-pdf")

    module.extractText(
      url.absoluteString,
      maxChars: 10_000,
      resolver: { _ in
        XCTFail("should reject a non-PDF file")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "PDF_ERROR")
        exp.fulfill()
      }
    )

    waitForExpectations(timeout: 5)
    try? FileManager.default.removeItem(at: url)
  }
}

// MARK: - CoreMLDiffusionModule Tests

final class CoreMLDiffusionModuleTests: XCTestCase {

  private var module: CoreMLDiffusionModule!

  override func setUp() {
    super.setUp()
    module = CoreMLDiffusionModule()
  }

  private func makeModelDirectory(components: [String]) -> URL {
    let url = makeTempDirectory()
    for component in components {
      try! FileManager.default.createDirectory(
        at: url.appendingPathComponent(component),
        withIntermediateDirectories: true
      )
    }
    return url
  }

  // MARK: requiresMainQueueSetup

  func testRequiresMainQueueSetupReturnsFalse() {
    XCTAssertFalse(CoreMLDiffusionModule.requiresMainQueueSetup())
  }

  // MARK: supportedEvents

  func testSupportedEvents() {
    let events = module.supportedEvents()!
    XCTAssertTrue(events.contains("LocalDreamProgress"))
    XCTAssertTrue(events.contains("LocalDreamError"))
    XCTAssertEqual(events.count, 2)
  }

  func testValidateModelDirectoryAcceptsStandardUnetLayout() {
    let url = makeModelDirectory(components: [
      "TextEncoder.mlmodelc",
      "Unet.mlmodelc",
      "VAEDecoder.mlmodelc",
    ])
    addTeardownBlock {
      try FileManager.default.removeItem(at: url)
    }

    XCTAssertNil(CoreMLDiffusionModule.validateModelDirectory(at: url))
  }

  func testValidateModelDirectoryAcceptsChunkedSDXLLayout() {
    let url = makeModelDirectory(components: [
      "TextEncoder.mlmodelc",
      "TextEncoder2.mlmodelc",
      "UnetChunk1.mlmodelc",
      "UnetChunk2.mlmodelc",
      "VAEDecoder.mlmodelc",
    ])
    addTeardownBlock {
      try FileManager.default.removeItem(at: url)
    }

    XCTAssertTrue(CoreMLDiffusionModule.isXLModelDirectory(at: url))
    XCTAssertNil(CoreMLDiffusionModule.validateModelDirectory(at: url))
  }

  func testValidateModelDirectoryRejectsIncompleteChunkedSDXLLayout() {
    let url = makeModelDirectory(components: [
      "TextEncoder.mlmodelc",
      "TextEncoder2.mlmodelc",
      "UnetChunk1.mlmodelc",
      "VAEDecoder.mlmodelc",
    ])
    addTeardownBlock {
      try FileManager.default.removeItem(at: url)
    }

    XCTAssertEqual(
      CoreMLDiffusionModule.validateModelDirectory(at: url),
      "Missing required model component: Unet.mlmodelc or UnetChunk1.mlmodelc + UnetChunk2.mlmodelc"
    )
  }

  // MARK: initial state queries

  func testIsNpuSupportedReturnsTrue() {
    let exp = expectation(description: "isNpuSupported")
    module.isNpuSupported(
      { value in
        XCTAssertEqual(value as? Bool, true)
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  func testIsGeneratingReturnsFalseInitially() {
    let exp = expectation(description: "isGenerating")
    module.isGenerating(
      { value in
        XCTAssertEqual(value as? Bool, false)
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  func testIsModelLoadedReturnsFalseInitially() {
    let exp = expectation(description: "isModelLoaded")
    module.isModelLoaded(
      { value in
        XCTAssertEqual(value as? Bool, false)
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  func testGetLoadedModelPathReturnsNilInitially() {
    let exp = expectation(description: "getLoadedModelPath")
    module.getLoadedModelPath(
      { value in
        // No model loaded — path must be nil or non-String
        XCTAssertNil(value as? String)
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  // MARK: cancel / unload

  func testCancelGenerationSucceeds() {
    let exp = expectation(description: "cancelGeneration")
    module.cancelGeneration(
      { value in
        XCTAssertEqual(value as? Bool, true)
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  func testCancelGenerationDoesNotAffectGeneratingState() {
    // cancelGeneration with no active generation must leave isGenerating = false
    let cancelExp = expectation(description: "cancel")
    module.cancelGeneration(
      { _ in cancelExp.fulfill() },
      rejecter: { _, _, _ in cancelExp.fulfill() }
    )
    waitForExpectations(timeout: 2)

    let stateExp = expectation(description: "isGenerating after cancel")
    module.isGenerating(
      { value in
        XCTAssertEqual(value as? Bool, false)
        stateExp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail(); stateExp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  func testUnloadModelSucceeds() {
    // Unloading when no model is loaded should still resolve true
    let exp = expectation(description: "unloadModel")
    module.unloadModel(
      { value in
        XCTAssertEqual(value as? Bool, true)
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  func testUnloadModelKeepsIsModelLoadedFalse() {
    let unloadExp = expectation(description: "unload")
    module.unloadModel(
      { _ in unloadExp.fulfill() },
      rejecter: { _, _, _ in unloadExp.fulfill() }
    )
    waitForExpectations(timeout: 2)

    let checkExp = expectation(description: "isModelLoaded after unload")
    module.isModelLoaded(
      { value in
        XCTAssertEqual(value as? Bool, false)
        checkExp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail(); checkExp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  // MARK: generateImage guard — no model loaded

  func testGenerateImageWithoutModelRejectsWithNoModel() {
    let exp = expectation(description: "generateImage rejects without model")
    module.generateImage(
      ["prompt": "a cat"],
      resolver: { _ in
        XCTFail("should reject when no model is loaded")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "ERR_NO_MODEL")
        exp.fulfill()
      }
    )
    waitForExpectations(timeout: 2)
  }

  // MARK: getGeneratedImages

  func testGetGeneratedImagesReturnsArray() {
    let exp = expectation(description: "getGeneratedImages")
    module.getGeneratedImages(
      { value in
        XCTAssertNotNil(value as? [[String: Any]], "Expected an array of image dictionaries")
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }
}

// MARK: - DownloadManagerModule Tests

final class DownloadManagerModuleTests: XCTestCase {

  private var module: DownloadManagerModule!

  override func setUp() {
    super.setUp()
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

/// Verifies that AppDelegate correctly implements the background URL session
/// delegate method required by RNFS for background downloads to complete.
/// If the method signature were wrong (e.g., wrong RNFSManager method name),
/// the build itself would fail — making this test a compile-time guard.
final class AppDelegateBackgroundSessionTests: XCTestCase {

  func testAppDelegateRespondsToBackgroundURLSessionSelector() {
    let appDelegate = AppDelegate()
    let responds = appDelegate.responds(
      to: #selector(
        UIApplicationDelegate.application(_:handleEventsForBackgroundURLSession:completionHandler:)
      )
    )
    XCTAssertTrue(
      responds,
      "AppDelegate must implement handleEventsForBackgroundURLSession to properly finalise RNFS background downloads"
    )
  }

  func testAppDelegateIsUIApplicationDelegate() {
    let appDelegate = AppDelegate()
    XCTAssertTrue(
      appDelegate is UIApplicationDelegate,
      "AppDelegate must conform to UIApplicationDelegate"
    )
  }
}
