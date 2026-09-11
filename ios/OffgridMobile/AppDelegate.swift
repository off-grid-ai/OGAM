import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    // Pass the completion handler to RNFS so it can finalize the background
    // URL session and signal iOS that all events have been processed.
    // Without this, iOS may penalise the app for not calling the handler promptly.
    RNFSBackgroundDownloads.setCompletionHandlerForIdentifier(identifier, completionHandler: completionHandler)
  }

  func application(
    _: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "OffgridMobile",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for _: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    // RCTBundleURLProvider can block scene creation for the full TCP timeout when a device cannot
    // reach the recorded Metro host. Probe it within a fixed bound. A physical-device build made by
    // scripts/ios-device.sh contains an embedded bundle for this fallback.
    let provider = RCTBundleURLProvider.sharedSettings()
    let (host, port) = Self.metroHostAndPort(provider)
    if Self.metroAnswers(host: host, port: port, within: 2.0),
       let metroURL = provider.jsBundleURL(forBundleRoot: "index") {
      return metroURL
    }

    let embeddedURL = Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    NSLog(
      "[bundle] Metro at %@:%d did not answer within 2s; %@",
      host,
      port,
      embeddedURL == nil
        ? "no embedded bundle is available"
        : "loading the embedded bundle"
    )
    return embeddedURL
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

#if DEBUG
  private final class MetroProbeResult: @unchecked Sendable {
    private let lock = NSLock()
    private var metroIsRunning = false

    func markRunning() {
      lock.lock()
      metroIsRunning = true
      lock.unlock()
    }

    func isRunning() -> Bool {
      lock.lock()
      defer { lock.unlock() }
      return metroIsRunning
    }
  }

  private static func metroHostAndPort(_ provider: RCTBundleURLProvider) -> (String, Int) {
    let bundledLocation = Bundle.main.url(forResource: "ip", withExtension: "txt")
      .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
    return resolveMetroHostAndPort(
      configuredLocation: provider.jsLocation,
      bundledLocation: bundledLocation)
  }

  static func resolveMetroHostAndPort(
    configuredLocation: String?, bundledLocation: String?
  ) -> (String, Int) {
    let configured = configuredLocation?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let bundled = bundledLocation?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let location = configured.isEmpty ? (bundled.isEmpty ? "localhost" : bundled) : configured

    let normalized = location.contains("://") ? location : "http://\(location)"
    let components = URLComponents(string: normalized)
    return (components?.host ?? "localhost", components?.port ?? 8081)
  }

  private static func metroAnswers(host: String, port: Int, within seconds: TimeInterval) -> Bool {
    guard let url = URL(string: "http://\(host):\(port)/status") else { return false }

    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = seconds
    configuration.timeoutIntervalForResource = seconds
    let session = URLSession(configuration: configuration)
    let done = DispatchSemaphore(value: 0)
    let result = MetroProbeResult()
    let task = session.dataTask(with: url) { data, response, _ in
      if let http = response as? HTTPURLResponse,
         http.statusCode == 200,
         let data,
         String(data: data, encoding: .utf8)?.contains("packager-status:running") == true {
        result.markRunning()
      }
      done.signal()
    }
    task.resume()
    if done.wait(timeout: .now() + seconds + 0.5) == .timedOut {
      task.cancel()
    }
    session.invalidateAndCancel()
    return result.isRunning()
  }
#endif
}
