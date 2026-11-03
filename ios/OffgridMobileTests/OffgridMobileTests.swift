import XCTest
import PDFKit
import Darwin

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
  XCTAssertNoThrow(try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true))
  return url
}

final class MetroBundleResolutionTests: XCTestCase {
  func testConfiguredMetroHostWinsAndPreservesItsPort() {
    let endpoint = ReactNativeDelegate.resolveMetroHostAndPort(
      configuredLocation: "http://100.64.0.8:9090",
      bundledLocation: "192.168.1.20")

    XCTAssertEqual(endpoint.0, "100.64.0.8")
    XCTAssertEqual(endpoint.1, 9090)
  }

  func testBundledHostIsUsedWhenMetroHasNoConfiguredLocation() {
    let endpoint = ReactNativeDelegate.resolveMetroHostAndPort(
      configuredLocation: nil,
      bundledLocation: " 192.168.1.20\n")

    XCTAssertEqual(endpoint.0, "192.168.1.20")
    XCTAssertEqual(endpoint.1, 8081)
  }

  func testLocalhostIsTheFinalFallback() {
    let endpoint = ReactNativeDelegate.resolveMetroHostAndPort(
      configuredLocation: "",
      bundledLocation: nil)

    XCTAssertEqual(endpoint.0, "localhost")
    XCTAssertEqual(endpoint.1, 8081)
  }
}

final class BlobChannelInterfaceCandidatesTests: XCTestCase {
  func testUsableKeepsOnlyActiveUnicastInterfacesAndPreservesNames() {
    let candidates = [
      record("en0", "192.168.1.10"),
      record("utun3", "100.80.1.2"),
      record("lo0", "127.0.0.1", isLoopback: true),
      record("en0", "169.254.2.3", isLinkLocal: true),
      record("down0", "10.0.0.4", isUp: false),
      record("any0", "0.0.0.0", isAnyLocal: true),
      record("cast0", "224.0.0.1", isMulticast: true),
    ]

    XCTAssertEqual(
      BlobChannelSupport.usableInterfaceCandidates(candidates),
      [record("en0", "192.168.1.10"), record("utun3", "100.80.1.2")])
  }

  func testUsableDeduplicatesPerInterfaceWithoutCollapsingDifferentInterfaces() {
    let candidate = record("utun3", "100.64.0.9")

    XCTAssertEqual(
      BlobChannelSupport.usableInterfaceCandidates(
        [candidate, candidate, record("utun4", "100.64.0.9")]),
      [candidate, record("utun4", "100.64.0.9")])
  }

  private func record(
    _ interfaceName: String,
    _ host: String,
    isUp: Bool = true,
    isLoopback: Bool = false,
    isLinkLocal: Bool = false,
    isAnyLocal: Bool = false,
    isMulticast: Bool = false
  ) -> BlobChannelSupport.InterfaceCandidate {
    BlobChannelSupport.InterfaceCandidate(
      interfaceName: interfaceName,
      host: host,
      isUp: isUp,
      isLoopback: isLoopback,
      isLinkLocal: isLinkLocal,
      isAnyLocal: isAnyLocal,
      isMulticast: isMulticast)
  }
}

final class BlobReceiveWindowTests: XCTestCase {
  func testBodyWaitsForOneCompleteAuthenticatedFrame() {
    let productionFrame = 4 * 1_048_576 + BlobFrameCipher.tagBytes
    let window = BlobReceiveWindow.body(sealedBytesRemaining: productionFrame)

    XCTAssertEqual(window.minimum, productionFrame)
    XCTAssertEqual(window.maximum, productionFrame)
  }

  func testBodyRequestsOnlyTheRemainderAfterHeadersCarryPayloadBytes() {
    let remainder = 3 * 1_048_576 + BlobFrameCipher.tagBytes
    let window = BlobReceiveWindow.body(sealedBytesRemaining: remainder)

    XCTAssertEqual(window.minimum, remainder)
    XCTAssertEqual(window.maximum, remainder)
  }

  func testHeaderCanReturnAsSoonAsOneByteArrives() {
    XCTAssertEqual(BlobReceiveWindow.header.minimum, 1)
    XCTAssertEqual(BlobReceiveWindow.header.maximum, 1 << 16)
  }
}

final class BlobChannelUploaderDeadlineTests: XCTestCase {
  func testAReachedNetworkSignalContinues() {
    let signal = DispatchSemaphore(value: 0)
    signal.signal()

    XCTAssertNoThrow(
      try BlobChannelUploader.waitForSignal(
        signal, timeout: .milliseconds(1), message: "should not time out"))
  }

  func testAnUnreachedNetworkSignalFailsInsteadOfPretendingToContinue() {
    let signal = DispatchSemaphore(value: 0)

    XCTAssertThrowsError(
      try BlobChannelUploader.waitForSignal(
        signal, timeout: .milliseconds(0), message: "the endpoint did not become reachable")
    ) { error in
      XCTAssertEqual(error.localizedDescription, "the endpoint did not become reachable")
    }
  }
}

final class ProximityAdvertisingControllerTests: XCTestCase {
  func testStopAndRestartReachTheNativeAdvertiserWithoutRestartingTheSession() {
    let controller = ProximityAdvertisingController()
    var starts = 0
    var stops = 0
    controller.install(
      start: { starts += 1 },
      stop: { stops += 1 }
    )
    XCTAssertFalse(controller.isAdvertising)
    XCTAssertEqual(starts, 0)

    XCTAssertTrue(controller.start())
    controller.stop()
    XCTAssertFalse(controller.isAdvertising)
    XCTAssertEqual(starts, 1)
    XCTAssertEqual(stops, 1)

    XCTAssertTrue(controller.start())
    XCTAssertTrue(controller.isAdvertising)
    XCTAssertEqual(starts, 2)
  }

  func testReplacingTheAdvertiserPreservesWhetherItWasHidden() {
    let controller = ProximityAdvertisingController()
    var firstStarts = 0
    var firstStops = 0
    var replacementStarts = 0
    controller.install(
      start: { firstStarts += 1 },
      stop: { firstStops += 1 }
    )
    XCTAssertTrue(controller.start())

    controller.install(
      start: { replacementStarts += 1 },
      stop: {}
    )
    XCTAssertEqual(firstStops, 1)
    XCTAssertEqual(replacementStarts, 1)

    controller.stop()
    controller.install(start: { replacementStarts += 1 }, stop: {})
    XCTAssertFalse(controller.isAdvertising)
    XCTAssertEqual(replacementStarts, 1)
    XCTAssertEqual(firstStarts, 1)
  }
}

final class StreamingFileHasherTests: XCTestCase {
  func testProducesTheStandardSHA512DigestAcrossManyChunks() throws {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
    try Data("abc".utf8).write(to: url)
    defer { try? FileManager.default.removeItem(at: url) }

    XCTAssertEqual(
      try StreamingFileHasher.sha512Hex(at: url, chunkSize: 1),
      "ddaf35a193617abacc417349ae204131" +
        "12e6fa4e89a97ea20a9eeee64b55d39a" +
        "2192992a274fc1a836ba3c23a3feebbd" +
        "454d4423643ce80e2a9ac94fa54ca49f"
    )
  }

  func testLargeFileHashKeepsAConstantMemoryFootprint() throws {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: url) }

    FileManager.default.createFile(atPath: url.path, contents: nil)
    let writer = try FileHandle(forWritingTo: url)
    let block = Data(repeating: 0xa5, count: 1_048_576)
    for _ in 0..<96 { try writer.write(contentsOf: block) }
    try writer.close()

    let baseline = residentFootprintBytes()
    var peak = baseline
    _ = try StreamingFileHasher.sha512Hex(at: url) {
      peak = max(peak, self.residentFootprintBytes())
    }

    XCTAssertLessThan(
      peak - baseline,
      32 * 1_048_576,
      "streaming a 96 MiB file must not retain its consumed chunks"
    )
  }

  private func residentFootprintBytes() -> UInt64 {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(
      MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let status = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    return status == KERN_SUCCESS ? info.phys_footprint : 0
  }
}

// MARK: - Sync Screenshot Tests

final class SyncScreenshotFileWriterTests: XCTestCase {

  func testPersistsAnAppOwnedCopyAndReturnsTheTransferDescriptor() throws {
    let documents = makeTempDirectory()
    defer { try? FileManager.default.removeItem(at: documents) }
    let bytes = Data("screen bytes".utf8)
    let syncId = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    let createdAt = Date(timeIntervalSince1970: 1_753_699_200)

    let descriptor = try SyncScreenshotFileWriter.persist(
      data: bytes,
      typeIdentifier: "public.png",
      createdAt: createdAt,
      width: 1179,
      height: 2556,
      documentsURL: documents,
      syncId: syncId
    )

    let filePath = try XCTUnwrap(descriptor["filePath"] as? String)
    XCTAssertTrue(filePath.hasPrefix(documents.path))
    XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: filePath)), bytes)
    XCTAssertEqual(
      descriptor["syncId"] as? String,
      "11111111-1111-4111-8111-111111111111"
    )
    XCTAssertEqual(descriptor["mimeType"] as? String, "image/png")
    XCTAssertEqual(descriptor["fileSize"] as? Int, bytes.count)
    XCTAssertEqual(descriptor["width"] as? Int, 1179)
    XCTAssertEqual(descriptor["height"] as? Int, 2556)
  }

  func testFailedAppOwnedCopyDoesNotProduceADescriptor() {
    let regularFile = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
    XCTAssertNoThrow(try Data("not a directory".utf8).write(to: regularFile))
    defer { try? FileManager.default.removeItem(at: regularFile) }

    XCTAssertThrowsError(
      try SyncScreenshotFileWriter.persist(
        data: Data("screen bytes".utf8),
        typeIdentifier: "public.png",
        createdAt: Date(),
        width: 1,
        height: 1,
        documentsURL: regularFile
      )
    )
  }
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
    XCTAssertNoThrow(try data.write(to: url))
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
    XCTAssertNoThrow(try "not a pdf".write(to: url, atomically: true, encoding: .utf8))
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
      XCTAssertNoThrow(try FileManager.default.createDirectory(
        at: url.appendingPathComponent(component),
        withIntermediateDirectories: true
      ))
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

// MARK: - Sync Clipboard Native Boundary Tests

final class SyncClipboardObserverTests: XCTestCase {

  func testDefaultTimestampUsesUnixMilliseconds() {
    let pasteboardName = UIPasteboard.Name("ai.offgridmobile.tests.\(UUID().uuidString)")
    guard let pasteboard = UIPasteboard(name: pasteboardName, create: true) else {
      return XCTFail("Could not create a test pasteboard")
    }
    defer { UIPasteboard.remove(withName: pasteboardName) }

    let notificationCenter = NotificationCenter()
    var observedTimestamp: Double?
    let observer = SyncClipboardObserver(
      pasteboard: pasteboard,
      notificationCenter: notificationCenter
    ) { _, timestamp in
      observedTimestamp = timestamp
    }

    observer.setEnabled(true)
    pasteboard.string = "unix timestamp"
    notificationCenter.post(name: UIPasteboard.changedNotification, object: pasteboard)

    let earliestReasonableUnixMilliseconds = Date(timeIntervalSince1970: 1_700_000_000)
      .timeIntervalSince1970 * 1_000
    XCTAssertGreaterThanOrEqual(
      observedTimestamp ?? 0,
      earliestReasonableUnixMilliseconds,
      "Clipboard events must use Unix milliseconds like the shared clipboard protocol"
    )
    XCTAssertEqual(
      observedTimestamp?.rounded(.down),
      observedTimestamp,
      "Clipboard protocol timestamps must be whole milliseconds"
    )
  }

  func testRejectsInvalidNativeClipboardTimestamps() {
    let pasteboardName = UIPasteboard.Name("ai.offgridmobile.tests.\(UUID().uuidString)")
    guard let pasteboard = UIPasteboard(name: pasteboardName, create: true) else {
      return XCTFail("Could not create a test pasteboard")
    }
    defer { UIPasteboard.remove(withName: pasteboardName) }

    let notificationCenter = NotificationCenter()
    var observed: [String] = []
    let observer = SyncClipboardObserver(
      pasteboard: pasteboard,
      notificationCenter: notificationCenter,
      now: { -.infinity }
    ) { text, _ in
      observed.append(text)
    }

    observer.setEnabled(true)
    pasteboard.string = "invalid timestamp"
    notificationCenter.post(name: UIPasteboard.changedNotification, object: pasteboard)

    XCTAssertEqual(observed, [])
  }

  func testObservesAndWritesTheRealPasteboardOnlyWhileEnabled() {
    let pasteboardName = UIPasteboard.Name("ai.offgridmobile.tests.\(UUID().uuidString)")
    guard let pasteboard = UIPasteboard(name: pasteboardName, create: true) else {
      return XCTFail("Could not create a test pasteboard")
    }
    defer { UIPasteboard.remove(withName: pasteboardName) }

    let notificationCenter = NotificationCenter()
    var observed: [(text: String, timestamp: Double)] = []
    let observer = SyncClipboardObserver(
      pasteboard: pasteboard,
      notificationCenter: notificationCenter,
      now: { 42 }
    ) { text, timestamp in
      observed.append((text, timestamp))
    }

    observer.setEnabled(true)
    pasteboard.string = "copied locally"
    notificationCenter.post(name: UIPasteboard.changedNotification, object: pasteboard)

    XCTAssertEqual(observed.count, 1)
    XCTAssertEqual(observed.first?.text, "copied locally")
    XCTAssertEqual(observed.first?.timestamp, 42_000)

    observer.writeText("received from desktop")
    notificationCenter.post(name: UIPasteboard.changedNotification, object: pasteboard)
    XCTAssertEqual(pasteboard.string, "received from desktop")
    XCTAssertEqual(
      observed.map(\.text),
      ["copied locally"],
      "A programmatic Sync write must not be attributed as a local copy"
    )

    observer.setEnabled(false)
    pasteboard.string = "must stay local"
    notificationCenter.post(name: UIPasteboard.changedNotification, object: pasteboard)
    XCTAssertEqual(observed.count, 1)
  }
}
