import CryptoKit
import Foundation

enum StreamingFileHasher {
  static let defaultChunkSize = 1_048_576

  static func sha512Hex(
    at url: URL,
    chunkSize: Int = defaultChunkSize,
    didConsumeChunk: (() -> Void)? = nil
  ) throws -> String {
    try digestHex(at: url, using: SHA512(), chunkSize: chunkSize, didConsumeChunk: didConsumeChunk)
  }

  static func sha256Hex(at url: URL) throws -> String {
    try digestHex(at: url, using: SHA256())
  }

  private static func digestHex<H: HashFunction>(
    at url: URL,
    using initialHasher: H,
    chunkSize: Int = defaultChunkSize,
    didConsumeChunk: (() -> Void)? = nil
  ) throws -> String {
    precondition(chunkSize > 0)
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }

    var hasher = initialHasher
    while true {
      // FileHandle can back each Swift Data with an autoreleased NSData. This work runs in one
      // long-lived GCD block, so the queue's outer autorelease pool is not drained until the whole
      // multi-gigabyte file is complete. Drain once per chunk or resident memory grows to the file
      // size even though the algorithm itself is streaming.
      let consumed = try autoreleasepool { () throws -> Bool in
        guard let chunk = try handle.read(upToCount: chunkSize), !chunk.isEmpty else {
          return false
        }
        hasher.update(data: chunk)
        return true
      }
      if !consumed { break }
      didConsumeChunk?()
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }
}

@objc(StreamingHashModule)
final class StreamingHashModule: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc
  func sha512(
    _ path: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    hash(path, digest: { try StreamingFileHasher.sha512Hex(at: $0) }, resolve: resolve, reject: reject)
  }

  @objc
  func sha256(
    _ path: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    hash(path, digest: StreamingFileHasher.sha256Hex, resolve: resolve, reject: reject)
  }

  private func hash(
    _ path: String,
    digest: @escaping (URL) throws -> String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .utility).async {
      do {
        let url = URL(string: path).flatMap { $0.isFileURL ? $0 : nil }
          ?? URL(fileURLWithPath: path)
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
          if scoped { url.stopAccessingSecurityScopedResource() }
        }
        resolve(try digest(url))
      } catch {
        reject("streaming_hash_failed", error.localizedDescription, error)
      }
    }
  }
}
