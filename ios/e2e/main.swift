import Foundation

/// Drives the iPhone's blob-channel code from the command line, so it can be proven against the Mac's
/// real implementation over a real socket.
///
/// This compiles the SAME four source files the app ships - the GCM stream, the head parsing, the
/// listener and the uploader. Nothing is reimplemented for the test, which is the only way the test
/// means anything: it is the shipping code that has to agree with the other platforms, byte for byte.
///
///   blob-harness serve  <requestId> <destination> <fileSize> <keyBase64> <nonceBase64> <token>
///   blob-harness stream <requestId> <source> <url> <token> <keyBase64> <nonceBase64>
///
/// `serve` prints the url it is listening on, then the outcome. `stream` prints the outcome.
let arguments = CommandLine.arguments

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(2)
}

func say(_ value: [String: Any]) {
  do {
    let data = try JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
  } catch {
    fail("could not encode harness result: \(error)")
  }
}

guard arguments.count >= 7 else { fail("usage: serve | stream") }
let mode = arguments[1]

if mode == "serve" {
  let requestId = arguments[2]
  let destination = arguments[3]
  let fileSize = Int(arguments[4]) ?? 0
  guard let key = Data(base64Encoded: arguments[5]), let nonce = Data(base64Encoded: arguments[6])
  else { fail("the key material is not base64") }
  let token = arguments[7]
  let frameBytes = Int(arguments[8]) ?? 0
  let settled = DispatchSemaphore(value: 0)
  var accepted = false
  let server = BlobChannelServer(
    onProgress: { _, _ in },
    onOutcome: { _, landed in
      accepted = landed
      settled.signal()
    })
  do {
    let port = try server.ensureListening()
    server.offer(
      requestId: requestId,
      transfer: .init(
        token: token, destinationPath: destination, fileSize: fileSize, key: key, nonce: nonce,
        frameBytes: frameBytes, offset: 0, expiresAt: Date().addingTimeInterval(300)))
    let address = BlobChannelSupport.lanAddress() ?? "127.0.0.1"
    let encoded = requestId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? requestId
    say(["url": "http://\(address):\(port)/blob/\(encoded)"])
    _ = settled.wait(timeout: .now() + 120)
    let size =
      (try? FileManager.default.attributesOfItem(atPath: destination))?[.size] as? Int ?? 0
    say(["received": accepted && size == fileSize, "size": size])
    exit(accepted && size == fileSize ? 0 : 1)
  } catch {
    say(["received": false, "error": "\(error)"])
    exit(1)
  }
}

if mode == "stream" {
  let requestId = arguments[2]
  let source = arguments[3]
  guard let url = URL(string: arguments[4]) else { fail("the url is not a url") }
  let token = arguments[5]
  guard let key = Data(base64Encoded: arguments[6]), let nonce = Data(base64Encoded: arguments[7])
  else { fail("the key material is not base64") }
  do {
    let sent = try BlobChannelUploader.upload(
      .init(
        requestId: requestId, sourcePath: source, url: url, token: token, key: key, nonce: nonce,
        frameBytes: Int(arguments[8]) ?? 0, offset: 0)
    ) { _ in }
    say(["sent": true, "bytes": sent])
    exit(0)
  } catch {
    say(["sent": false, "error": "\(error)"])
    exit(1)
  }
}

fail("usage: serve | stream")
