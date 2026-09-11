import Darwin
import CryptoKit
import Foundation
import React

@objc(OffgridConfinedFile)
final class OffgridConfinedFile: NSObject {
  /// Every native mutation uses this private serial queue. Descriptor-relative no-follow checks
  /// reject detected substitution, and all roots remain inside the app container. POSIX has no
  /// conditional unlink-by-inode; rooted or malicious same-UID mutation after the final identity
  /// check is outside the supported boundary.
  private static let operationQueue = DispatchQueue(
    label: "ai.offgridmobile.confined-file",
    qos: .utility
  )

  private struct DeleteReceipt: Codable, Equatable {
    let version: Int
    let root: String
    let operationId: String
    let originalPath: String
    let quarantinePath: String
    let device: String
    let inode: String
    let expectedSize: Int64?
    let expectedSha256: String?
  }

  private enum ReceiptRead {
    case missing
    case valid(DeleteReceipt)
    case invalid
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(deleteConfinedRegularFile:resolver:rejecter:)
  func deleteConfinedRegularFile(
    _ input: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    Self.operationQueue.async {
      resolve(Self.delete(input))
    }
  }

  @objc(moveConfinedRegularFile:resolver:rejecter:)
  func moveConfinedRegularFile(
    _ input: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    Self.operationQueue.async {
      resolve(Self.move(input, restoring: false))
    }
  }

  @objc(restoreConfinedRegularFile:resolver:rejecter:)
  func restoreConfinedRegularFile(
    _ input: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    Self.operationQueue.async {
      resolve(Self.move(input, restoring: true))
    }
  }

  @objc(adoptLegacyConfinedQuarantineReceipt:resolver:rejecter:)
  func adoptLegacyConfinedQuarantineReceipt(
    _ input: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    Self.operationQueue.async {
      resolve(Self.adoptLegacyReceipt(input))
    }
  }

  private static func outcome(_ status: String, _ code: String? = nil, _ message: String? = nil)
    -> [String: String] {
    var result = ["status": status]
    if let code { result["code"] = code }
    if let message { result["message"] = message }
    return result
  }

  private static func root(_ token: String) -> URL? {
    // No external/security-scoped URL is accepted. Each root is inside this app's sandbox container.
    let manager = FileManager.default
    switch token {
    case "documents":
      return manager.urls(for: .documentDirectory, in: .userDomainMask).first
    case "cache":
      return manager.urls(for: .cachesDirectory, in: .userDomainMask).first
    case "temporary":
      return URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    case "shared_files":
      return manager.urls(for: .documentDirectory, in: .userDomainMask).first?
        .appendingPathComponent("shared_files", isDirectory: true)
    default:
      return nil
    }
  }

  private static func encodedOperation(_ operationId: String) -> String? {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-_.!~*'()")
    return operationId.addingPercentEncoding(withAllowedCharacters: allowed)
  }

  private static func relativeComponents(_ path: String, rootPath: String) -> [String]? {
    let standardized = (path as NSString).standardizingPath
    guard standardized == path, standardized.hasPrefix(rootPath + "/") else { return nil }
    let relative = String(standardized.dropFirst(rootPath.count + 1))
    let components = relative.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    return !components.isEmpty && components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." })
      ? components
      : nil
  }

  private static func move(_ input: NSDictionary, restoring: Bool) -> [String: String] {
    guard
      input["root"] as? String == "shared_files",
      let sourcePath = input["expectedSourcePath"] as? String,
      let destinationPath = input["expectedDestinationPath"] as? String,
      let operationId = input["operationId"] as? String,
      !operationId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      operationId.count <= 512,
      operationId.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
      let encodedOperation = encodedOperation(operationId),
      let rootPath = root("shared_files")?.path,
      let source = relativeComponents(sourcePath, rootPath: rootPath),
      let destination = relativeComponents(destinationPath, rootPath: rootPath),
      source.dropLast() == destination.dropLast()
    else {
      return outcome("refused", "INVALID_MOVE_IDENTITY", "Invalid shared-file paths or operation ID.")
    }

    let originalPath = restoring ? destinationPath : sourcePath
    let quarantinePath = restoring ? sourcePath : destinationPath
    guard quarantinePath == originalPath + ".offgrid-delete-" + encodedOperation else {
      return outcome("refused", "QUARANTINE_MISMATCH", "The quarantine path does not match its operation.")
    }

    var parentFD = Darwin.open(rootPath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard parentFD >= 0 else {
      return outcome("refused", "ROOT_UNAVAILABLE", "The shared-file root cannot be opened.")
    }
    defer { Darwin.close(parentFD) }
    for component in source.dropLast() {
      let nextFD = component.withCString {
        Darwin.openat(parentFD, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
      }
      guard nextFD >= 0 else {
        return outcome("refused", "UNSAFE_PATH_COMPONENT", "A path component is not a real directory.")
      }
      Darwin.close(parentFD)
      parentFD = nextFD
    }

    let sourceLeaf = source[source.count - 1]
    let destinationLeaf = destination[destination.count - 1]
    let sourceFD = sourceLeaf.withCString { Darwin.openat(parentFD, $0, O_RDONLY | O_NOFOLLOW) }
    if sourceFD < 0 {
      guard errno == ENOENT else {
        return outcome("refused", "SOURCE_OPEN_REFUSED", "The exact source cannot be opened safely.")
      }
      var destinationStat = stat()
      let destinationResult = destinationLeaf.withCString {
        Darwin.fstatat(parentFD, $0, &destinationStat, AT_SYMLINK_NOFOLLOW)
      }
      return destinationResult == 0 && (destinationStat.st_mode & S_IFMT) == S_IFREG
        ? outcome("already_moved")
        : outcome("refused", "SOURCE_MISSING", "Neither an exact source nor moved regular file exists.")
    }
    defer { Darwin.close(sourceFD) }

    var opened = stat()
    var named = stat()
    let namedResult = sourceLeaf.withCString {
      Darwin.fstatat(parentFD, $0, &named, AT_SYMLINK_NOFOLLOW)
    }
    guard Darwin.fstat(sourceFD, &opened) == 0,
          (opened.st_mode & S_IFMT) == S_IFREG,
          namedResult == 0,
          (named.st_mode & S_IFMT) == S_IFREG,
          named.st_dev == opened.st_dev,
          named.st_ino == opened.st_ino else {
      return outcome("refused", "SOURCE_CHANGED", "The source is not the opened regular file.")
    }

    let renameResult = sourceLeaf.withCString { sourcePointer in
      destinationLeaf.withCString { destinationPointer in
        Darwin.renameatx_np(parentFD, sourcePointer, parentFD, destinationPointer, UInt32(RENAME_EXCL))
      }
    }
    guard renameResult == 0 else {
      return outcome("refused", "MOVE_REFUSED", "The filesystem refused the exact atomic move.")
    }
    var moved = stat()
    var sourceAfterMove = stat()
    let movedResult = destinationLeaf.withCString {
      Darwin.fstatat(parentFD, $0, &moved, AT_SYMLINK_NOFOLLOW)
    }
    let sourceAfterMoveResult = sourceLeaf.withCString {
      Darwin.fstatat(parentFD, $0, &sourceAfterMove, AT_SYMLINK_NOFOLLOW)
    }
    let sourceAfterMoveError = errno
    guard movedResult == 0,
          (moved.st_mode & S_IFMT) == S_IFREG,
          moved.st_dev == opened.st_dev,
          moved.st_ino == opened.st_ino,
          sourceAfterMoveResult == -1,
          sourceAfterMoveError == ENOENT else {
      return outcome("refused", "MOVE_CHANGED", "The moved file identity changed.")
    }
    return outcome("moved")
  }

  private static func sameFile(_ lhs: stat, _ rhs: stat) -> Bool {
    lhs.st_dev == rhs.st_dev && lhs.st_ino == rhs.st_ino
  }

  private static func receiptData(_ receipt: DeleteReceipt) -> Data? {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try? encoder.encode(receipt)
  }

  private static func receiptLeaf(root: String, path: String, operationId: String) -> String {
    let identity = Data("\(root)\u{0}\(path)\u{0}\(operationId)".utf8)
    return SHA256.hash(data: identity).map { String(format: "%02x", $0) }.joined() + ".json"
  }

  private static func openReceiptDirectory() -> Int32? {
    guard let supportURL = FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first else {
      return nil
    }
    do {
      try FileManager.default.createDirectory(
        at: supportURL,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
      )
    } catch {
      return nil
    }
    let supportFD = Darwin.open(supportURL.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard supportFD >= 0 else { return nil }
    defer { Darwin.close(supportFD) }
    let directoryName = "OffgridConfinedFileReceipts"
    let created = directoryName.withCString { Darwin.mkdirat(supportFD, $0, mode_t(0o700)) }
    guard created == 0 || errno == EEXIST else { return nil }
    if created == 0, Darwin.fsync(supportFD) != 0 { return nil }
    let receiptFD = directoryName.withCString {
      Darwin.openat(supportFD, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    }
    return receiptFD >= 0 ? receiptFD : nil
  }

  private static func readReceipt(parentFD: Int32, leaf: String) -> ReceiptRead {
    let receiptFD = leaf.withCString { Darwin.openat(parentFD, $0, O_RDONLY | O_NOFOLLOW) }
    if receiptFD < 0 {
      return errno == ENOENT ? .missing : .invalid
    }
    defer { Darwin.close(receiptFD) }

    var opened = stat()
    var named = stat()
    let namedResult = leaf.withCString {
      Darwin.fstatat(parentFD, $0, &named, AT_SYMLINK_NOFOLLOW)
    }
    guard Darwin.fstat(receiptFD, &opened) == 0,
          (opened.st_mode & S_IFMT) == S_IFREG,
          opened.st_size > 0,
          opened.st_size <= 65_536,
          namedResult == 0,
          (named.st_mode & S_IFMT) == S_IFREG,
          sameFile(opened, named) else {
      return .invalid
    }

    var bytes = [UInt8](repeating: 0, count: Int(opened.st_size))
    var offset = 0
    while offset < bytes.count {
      let remaining = bytes.count - offset
      let count = bytes.withUnsafeMutableBytes { buffer in
        Darwin.read(receiptFD, buffer.baseAddress!.advanced(by: offset), remaining)
      }
      guard count > 0 else { return .invalid }
      offset += count
    }
    guard
      let receipt = try? JSONDecoder().decode(DeleteReceipt.self, from: Data(bytes)),
      receipt.version == 1,
      !receipt.operationId.isEmpty,
      !receipt.device.isEmpty,
      !receipt.inode.isEmpty
    else {
      return .invalid
    }
    return .valid(receipt)
  }

  private static func persistReceipt(
    parentFD: Int32,
    leaf: String,
    receipt: DeleteReceipt
  ) -> ReceiptRead {
    guard let data = receiptData(receipt) else { return .invalid }
    let pendingLeaf = ".\(leaf).pending"

    switch readReceipt(parentFD: parentFD, leaf: leaf) {
    case .valid(let stored):
      if stored == receipt {
        _ = pendingLeaf.withCString { Darwin.unlinkat(parentFD, $0, 0) }
        _ = Darwin.fsync(parentFD)
      }
      return .valid(stored)
    case .invalid:
      return .invalid
    case .missing:
      break
    }

    // A stopped process can leave only this operation-derived pending file. A complete matching
    // pending receipt is publishable; an incomplete one has no authority and is removed before one
    // bounded rewrite. The final name is never opened for writing.
    switch readReceipt(parentFD: parentFD, leaf: pendingLeaf) {
    case .valid(let pending) where pending == receipt:
      break
    case .missing:
      break
    case .valid, .invalid:
      guard pendingLeaf.withCString({ Darwin.unlinkat(parentFD, $0, 0) }) == 0,
            Darwin.fsync(parentFD) == 0 else {
        return .invalid
      }
    }

    if case .missing = readReceipt(parentFD: parentFD, leaf: pendingLeaf) {
      let receiptFD = pendingLeaf.withCString {
        Darwin.openat(parentFD, $0, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode_t(0o600))
      }
      guard receiptFD >= 0 else { return .invalid }

      var writeSucceeded = false
      data.withUnsafeBytes { buffer in
        guard let base = buffer.baseAddress else { return }
        var offset = 0
        while offset < data.count {
          let count = Darwin.write(receiptFD, base.advanced(by: offset), data.count - offset)
          guard count > 0 else { return }
          offset += count
        }
        writeSucceeded = Darwin.fsync(receiptFD) == 0
      }
      Darwin.close(receiptFD)
      guard writeSucceeded else { return .invalid }
    }

    let publishResult = pendingLeaf.withCString { pending in
      leaf.withCString { final in
        Darwin.linkat(parentFD, pending, parentFD, final, 0)
      }
    }
    if publishResult != 0 && errno != EEXIST { return .invalid }
    guard Darwin.fsync(parentFD) == 0 else { return .invalid }

    let published = readReceipt(parentFD: parentFD, leaf: leaf)
    guard case .valid(let stored) = published, stored == receipt else { return .invalid }
    guard pendingLeaf.withCString({ Darwin.unlinkat(parentFD, $0, 0) }) == 0 || errno == ENOENT,
          Darwin.fsync(parentFD) == 0 else {
      return .invalid
    }
    return .valid(stored)
  }

  private static func clearReceipt(
    parentFD: Int32,
    leaf: String,
    expected: DeleteReceipt
  ) -> Bool {
    guard case .valid(let stored) = readReceipt(parentFD: parentFD, leaf: leaf),
          stored == expected else {
      return false
    }
    let result = leaf.withCString { Darwin.unlinkat(parentFD, $0, 0) }
    return result == 0 && Darwin.fsync(parentFD) == 0
  }

  private static func deleteQuarantine(
    parentFD: Int32,
    leaf: String,
    receiptParentFD: Int32,
    receiptLeaf: String,
    receipt: DeleteReceipt
  ) -> [String: String] {
    let fileFD = leaf.withCString { Darwin.openat(parentFD, $0, O_RDONLY | O_NOFOLLOW) }
    if fileFD < 0 {
      guard errno == ENOENT else {
        return outcome("refused", "QUARANTINE_OPEN_REFUSED", "The quarantine file cannot be opened safely.")
      }
      return clearReceipt(parentFD: receiptParentFD, leaf: receiptLeaf, expected: receipt)
        ? outcome("already_missing")
        : outcome("refused", "RECEIPT_CLEAR_REFUSED", "The durable delete receipt could not be cleared.")
    }
    defer { Darwin.close(fileFD) }
    var opened = stat()
    var named = stat()
    let namedResult = leaf.withCString {
      Darwin.fstatat(parentFD, $0, &named, AT_SYMLINK_NOFOLLOW)
    }
    guard Darwin.fstat(fileFD, &opened) == 0,
          (opened.st_mode & S_IFMT) == S_IFREG,
          namedResult == 0,
          (named.st_mode & S_IFMT) == S_IFREG,
          sameFile(named, opened),
          receipt.device == String(opened.st_dev),
          receipt.inode == String(opened.st_ino) else {
      return outcome("refused", "QUARANTINE_CHANGED", "The quarantine file identity changed.")
    }
    // The serial queue excludes every supported in-process quarantine writer. `unlinkat` cannot
    // atomically require an inode, so the opened/named check above is the final supported fence.
    let unlinkResult = leaf.withCString { Darwin.unlinkat(parentFD, $0, 0) }
    guard unlinkResult == 0 else {
      return outcome("refused", "DELETE_REFUSED", "The filesystem refused quarantine deletion.")
    }
    guard Darwin.fsync(parentFD) == 0,
          clearReceipt(parentFD: receiptParentFD, leaf: receiptLeaf, expected: receipt) else {
      return outcome("refused", "RECEIPT_CLEAR_REFUSED", "The durable delete receipt could not be cleared.")
    }
    return outcome("deleted")
  }

  // The delete transaction keeps path, inode, receipt, and durability checks in one operation.
  // swiftlint:disable:next cyclomatic_complexity
  private static func delete(_ input: NSDictionary) -> [String: String] {
    guard
      let token = input["root"] as? String,
      let expectedPath = input["expectedPath"] as? String,
      let operationId = input["operationId"] as? String,
      !operationId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      operationId.count <= 512,
      operationId.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
      let encodedOperation = encodedOperation(operationId),
      let rootURL = root(token)
    else {
      return outcome("refused", "INVALID_DELETE_IDENTITY", "Invalid root, path, or operation ID.")
    }

    let rootPath = rootURL.path
    let standardized = (expectedPath as NSString).standardizingPath
    guard standardized == expectedPath, standardized.hasPrefix(rootPath + "/") else {
      return outcome("refused", "PATH_OUTSIDE_ROOT", "The expected path is not below its fixed root.")
    }
    guard let components = relativeComponents(standardized, rootPath: rootPath) else {
      return outcome("refused", "INVALID_PATH", "The expected path has an unsafe component.")
    }

    var directoryFD = Darwin.open(rootPath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard directoryFD >= 0 else {
      return outcome("refused", "ROOT_UNAVAILABLE", "The fixed app-owned root cannot be opened.")
    }
    defer { Darwin.close(directoryFD) }

    for component in components.dropLast() {
      let nextFD = component.withCString {
        Darwin.openat(directoryFD, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
      }
      guard nextFD >= 0 else {
        return outcome("refused", "UNSAFE_PATH_COMPONENT", "A path component is missing or is not a real directory.")
      }
      Darwin.close(directoryFD)
      directoryFD = nextFD
    }

    let leaf = components[components.count - 1]
    let quarantineLeaf = leaf + ".offgrid-delete-" + encodedOperation
    let quarantinePath = expectedPath + ".offgrid-delete-" + encodedOperation
    let receiptLeaf = receiptLeaf(root: token, path: expectedPath, operationId: operationId)
    guard let receiptDirectoryFD = openReceiptDirectory() else {
      return outcome("refused", "RECEIPT_STORE_UNAVAILABLE", "The durable delete receipt store is unavailable.")
    }
    defer { Darwin.close(receiptDirectoryFD) }
    let fileFD = leaf.withCString { Darwin.openat(directoryFD, $0, O_RDONLY | O_NOFOLLOW) }
    if fileFD < 0 {
      guard errno == ENOENT else {
        return outcome("refused", "TARGET_OPEN_REFUSED", "The target cannot be opened without following links.")
      }
      switch readReceipt(parentFD: receiptDirectoryFD, leaf: receiptLeaf) {
      case .missing:
        var quarantine = stat()
        let quarantineResult = quarantineLeaf.withCString {
          Darwin.fstatat(directoryFD, $0, &quarantine, AT_SYMLINK_NOFOLLOW)
        }
        return quarantineResult == -1 && errno == ENOENT
          ? outcome("already_missing")
          : outcome("refused", "RECEIPT_MISSING", "Quarantine replay has no durable identity receipt.")
      case .invalid:
        return outcome("refused", "RECEIPT_INVALID", "The durable delete receipt is invalid.")
      case .valid(let receipt):
        guard receipt.root == token,
              receipt.operationId == operationId,
              receipt.originalPath == expectedPath,
              receipt.quarantinePath == quarantinePath else {
          return outcome("refused", "RECEIPT_CONFLICT", "The durable delete receipt does not match this request.")
        }
        return deleteQuarantine(
          parentFD: directoryFD,
          leaf: quarantineLeaf,
          receiptParentFD: receiptDirectoryFD,
          receiptLeaf: receiptLeaf,
          receipt: receipt
        )
      }
    }
    defer { Darwin.close(fileFD) }

    var opened = stat()
    guard Darwin.fstat(fileFD, &opened) == 0, (opened.st_mode & S_IFMT) == S_IFREG else {
      return outcome("refused", "NOT_REGULAR_FILE", "The target is not a regular file.")
    }
    var named = stat()
    let statResult = leaf.withCString {
      Darwin.fstatat(directoryFD, $0, &named, AT_SYMLINK_NOFOLLOW)
    }
    guard statResult == 0,
          (named.st_mode & S_IFMT) == S_IFREG,
          named.st_dev == opened.st_dev,
          named.st_ino == opened.st_ino else {
      return outcome("refused", "PATH_CHANGED", "The target changed before deletion.")
    }
    let receipt = DeleteReceipt(
      version: 1,
      root: token,
      operationId: operationId,
      originalPath: expectedPath,
      quarantinePath: quarantinePath,
      device: String(opened.st_dev),
      inode: String(opened.st_ino),
      expectedSize: nil,
      expectedSha256: nil
    )
    switch persistReceipt(parentFD: receiptDirectoryFD, leaf: receiptLeaf, receipt: receipt) {
    case .missing, .invalid:
      return outcome("refused", "RECEIPT_PERSIST_REFUSED", "The durable delete receipt could not be committed.")
    case .valid(let stored) where stored != receipt:
      return outcome("refused", "RECEIPT_CONFLICT", "Another file identity already owns this delete operation.")
    case .valid:
      break
    }
    let renameResult = leaf.withCString { sourcePointer in
      quarantineLeaf.withCString { destinationPointer in
        Darwin.renameatx_np(
          directoryFD,
          sourcePointer,
          directoryFD,
          destinationPointer,
          UInt32(RENAME_EXCL)
        )
      }
    }
    guard renameResult == 0 else {
      return outcome("refused", "QUARANTINE_REFUSED", "The exact target could not enter quarantine.")
    }
    var sourceAfterMove = stat()
    let sourceAfterMoveResult = leaf.withCString {
      Darwin.fstatat(directoryFD, $0, &sourceAfterMove, AT_SYMLINK_NOFOLLOW)
    }
    let sourceAfterMoveError = errno
    var moved = stat()
    let movedResult = quarantineLeaf.withCString {
      Darwin.fstatat(directoryFD, $0, &moved, AT_SYMLINK_NOFOLLOW)
    }
    guard sourceAfterMoveResult == -1, sourceAfterMoveError == ENOENT else {
      return outcome("refused", "SOURCE_STILL_PRESENT", "The source name remains after quarantine.")
    }
    guard movedResult == 0, (moved.st_mode & S_IFMT) == S_IFREG, sameFile(moved, opened) else {
      let restoreResult = quarantineLeaf.withCString { sourcePointer in
        leaf.withCString { destinationPointer in
          Darwin.renameatx_np(
            directoryFD,
            sourcePointer,
            directoryFD,
            destinationPointer,
            UInt32(RENAME_EXCL)
          )
        }
      }
      var restored = stat()
      var quarantineAfterRestore = stat()
      let restoredResult = leaf.withCString {
        Darwin.fstatat(directoryFD, $0, &restored, AT_SYMLINK_NOFOLLOW)
      }
      let quarantineAfterRestoreResult = quarantineLeaf.withCString {
        Darwin.fstatat(directoryFD, $0, &quarantineAfterRestore, AT_SYMLINK_NOFOLLOW)
      }
      let quarantineAfterRestoreError = errno
      guard restoreResult == 0,
            restoredResult == 0,
            movedResult == 0,
            sameFile(restored, moved),
            quarantineAfterRestoreResult == -1,
            quarantineAfterRestoreError == ENOENT,
            Darwin.fsync(directoryFD) == 0 else {
        return outcome("refused", "QUARANTINE_IDENTITY_CONFLICT", "Unexpected moved identity remains quarantined.")
      }
      return outcome("refused", "QUARANTINE_IDENTITY_RESTORED", "An unexpected moved identity was restored; retry is blocked by its receipt.")
    }
    guard Darwin.fsync(directoryFD) == 0 else {
      return outcome("refused", "QUARANTINE_SYNC_REFUSED", "The quarantine move could not be committed durably.")
    }
    return deleteQuarantine(
      parentFD: directoryFD,
      leaf: quarantineLeaf,
      receiptParentFD: receiptDirectoryFD,
      receiptLeaf: receiptLeaf,
      receipt: receipt
    )
  }

  private static func adoptLegacyReceipt(_ input: NSDictionary) -> [String: String] {
    guard
      input["root"] as? String == "shared_files",
      let originalPath = input["expectedOriginalPath"] as? String,
      let quarantinePath = input["expectedQuarantinePath"] as? String,
      let operationId = input["operationId"] as? String,
      let expectedSizeNumber = input["expectedSize"] as? NSNumber,
      let expectedSha256 = input["expectedSha256"] as? String,
      !operationId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      operationId.count <= 512,
      operationId.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
      let encodedOperation = encodedOperation(operationId),
      quarantinePath == originalPath + ".offgrid-delete-" + encodedOperation,
      expectedSizeNumber.doubleValue == Double(expectedSizeNumber.int64Value),
      expectedSizeNumber.int64Value > 0,
      expectedSha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
      let rootPath = root("shared_files")?.path,
      let original = relativeComponents(originalPath, rootPath: rootPath),
      let quarantine = relativeComponents(quarantinePath, rootPath: rootPath),
      original.dropLast() == quarantine.dropLast()
    else {
      return outcome("refused", "INVALID_ADOPTION_AUTHORITY", "The durable journal authority is invalid.")
    }

    var parentFD = Darwin.open(rootPath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard parentFD >= 0 else {
      return outcome("refused", "ROOT_UNAVAILABLE", "The shared-file root cannot be opened.")
    }
    defer { Darwin.close(parentFD) }
    for component in quarantine.dropLast() {
      let nextFD = component.withCString {
        Darwin.openat(parentFD, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
      }
      guard nextFD >= 0 else {
        return outcome("refused", "UNSAFE_PATH_COMPONENT", "A path component is not a real directory.")
      }
      Darwin.close(parentFD)
      parentFD = nextFD
    }

    let originalLeaf = original[original.count - 1]
    let quarantineLeaf = quarantine[quarantine.count - 1]
    var originalStat = stat()
    let originalResult = originalLeaf.withCString {
      Darwin.fstatat(parentFD, $0, &originalStat, AT_SYMLINK_NOFOLLOW)
    }
    let originalError = errno
    guard originalResult == -1, originalError == ENOENT else {
      return outcome("refused", "SOURCE_PRESENT", "The original path still exists or cannot be proven absent.")
    }

    let fileFD = quarantineLeaf.withCString { Darwin.openat(parentFD, $0, O_RDONLY | O_NOFOLLOW) }
    guard fileFD >= 0 else {
      return outcome("refused", "QUARANTINE_OPEN_REFUSED", "The quarantine cannot be opened safely.")
    }
    defer { Darwin.close(fileFD) }
    var opened = stat()
    var named = stat()
    let namedResult = quarantineLeaf.withCString {
      Darwin.fstatat(parentFD, $0, &named, AT_SYMLINK_NOFOLLOW)
    }
    guard Darwin.fstat(fileFD, &opened) == 0,
          (opened.st_mode & S_IFMT) == S_IFREG,
          opened.st_size == expectedSizeNumber.int64Value,
          namedResult == 0,
          (named.st_mode & S_IFMT) == S_IFREG,
          sameFile(opened, named) else {
      return outcome("refused", "UNSAFE_QUARANTINE", "The quarantine is not the expected regular file.")
    }

    var hasher = SHA256()
    var total: Int64 = 0
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
      let count = buffer.withUnsafeMutableBytes { bytes in
        Darwin.read(fileFD, bytes.baseAddress, bytes.count)
      }
      if count < 0 {
        return outcome("refused", "QUARANTINE_READ_FAILED", "The quarantine bytes could not be verified.")
      }
      if count == 0 { break }
      total += Int64(count)
      hasher.update(data: Data(buffer.prefix(count)))
    }
    let sha256 = hasher.finalize().map { String(format: "%02x", $0) }.joined()
    var openedAfterRead = stat()
    var namedAfterRead = stat()
    let namedAfterReadResult = quarantineLeaf.withCString {
      Darwin.fstatat(parentFD, $0, &namedAfterRead, AT_SYMLINK_NOFOLLOW)
    }
    guard total == expectedSizeNumber.int64Value,
          sha256 == expectedSha256,
          Darwin.fstat(fileFD, &openedAfterRead) == 0,
          namedAfterReadResult == 0,
          sameFile(opened, openedAfterRead),
          sameFile(opened, namedAfterRead),
          openedAfterRead.st_size == expectedSizeNumber.int64Value else {
      return outcome("refused", "BYTE_EVIDENCE_MISMATCH", "The quarantine changed or does not match durable evidence.")
    }

    guard let receiptDirectoryFD = openReceiptDirectory() else {
      return outcome("refused", "RECEIPT_STORE_UNAVAILABLE", "The durable receipt store is unavailable.")
    }
    defer { Darwin.close(receiptDirectoryFD) }
    let receipt = DeleteReceipt(
      version: 1,
      root: "shared_files",
      operationId: operationId,
      originalPath: originalPath,
      quarantinePath: quarantinePath,
      device: String(opened.st_dev),
      inode: String(opened.st_ino),
      expectedSize: expectedSizeNumber.int64Value,
      expectedSha256: expectedSha256
    )
    let leaf = receiptLeaf(root: "shared_files", path: originalPath, operationId: operationId)
    switch readReceipt(parentFD: receiptDirectoryFD, leaf: leaf) {
    case .invalid:
      return outcome("refused", "RECEIPT_INVALID", "The existing durable receipt is invalid.")
    case .valid(let stored):
      let sameIdentity = stored.root == receipt.root &&
        stored.operationId == receipt.operationId &&
        stored.originalPath == receipt.originalPath &&
        stored.quarantinePath == receipt.quarantinePath &&
        stored.device == receipt.device && stored.inode == receipt.inode
      let compatibleEvidence = (stored.expectedSize == nil && stored.expectedSha256 == nil) ||
        (stored.expectedSize == receipt.expectedSize && stored.expectedSha256 == receipt.expectedSha256)
      return sameIdentity && compatibleEvidence
        ? outcome("already_adopted")
        : outcome("refused", "RECEIPT_CONFLICT", "Another identity owns this quarantine receipt.")
    case .missing:
      guard case .valid(let stored) = persistReceipt(
        parentFD: receiptDirectoryFD,
        leaf: leaf,
        receipt: receipt
      ), stored == receipt else {
        return outcome("refused", "RECEIPT_FAILED", "The adopted receipt was not committed durably.")
      }
      return outcome("adopted")
    }
  }
}
