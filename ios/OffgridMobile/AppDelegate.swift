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
    // Debug builds load from Metro so Fast Refresh stays connected on simulators and devices.
    //
    // The provider's own reachability probe blocks the calling thread for the whole TCP timeout when
    // the recorded Metro host cannot be reached (a Wi-Fi network with client isolation, a stale host
    // remembered from an earlier install). Scene creation waits on that thread, so iOS killed the app
    // at 20 s with 0x8BADF00D and the JS side never started. Ask Metro ourselves with a short bound
    // first; only a Metro that answers gets to serve the bundle. Otherwise load the bundle shipped in
    // the app (build with FORCE_BUNDLING=1) and say so, instead of dying silently.
    let provider = RCTBundleURLProvider.sharedSettings()
    let (host, port) = Self.metroHostAndPort(provider)
    if Self.metroAnswers(host: host, port: port, within: 2.0),
       let metro = provider.jsBundleURL(forBundleRoot: "index") {
      return metro
    }
    let embedded = Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    NSLog("[bundle] Metro at %@:%d did not answer within 2s; %@", host, port,
          embedded == nil ? "no embedded bundle either (build with FORCE_BUNDLING=1)" : "loading the embedded bundle")
    return embedded
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

#if DEBUG
  /// The host the provider would probe: a configured location, else the address the build wrote
  /// into ip.txt, else localhost. Mirrors RCTBundleURLProvider's own resolution order.
  private static func metroHostAndPort(_ provider: RCTBundleURLProvider) -> (String, Int) {
    var location = provider.jsLocation ?? ""
    if location.isEmpty,
       let ipFile = Bundle.main.url(forResource: "ip", withExtension: "txt"),
       let ip = try? String(contentsOf: ipFile, encoding: .utf8) {
      location = ip.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    if location.isEmpty { location = "localhost" }
    let parts = location.split(separator: ":", maxSplits: 1).map(String.init)
    let host = parts.first ?? "localhost"
    let port = parts.count > 1 ? Int(parts[1]) ?? 8081 : 8081
    return (host, port)
  }

  /// True only when Metro's status endpoint answers within the bound. Never blocks longer than that.
  private static func metroAnswers(host: String, port: Int, within seconds: TimeInterval) -> Bool {
    guard let url = URL(string: "http://\(host):\(port)/status") else { return false }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = seconds
    configuration.timeoutIntervalForResource = seconds
    let session = URLSession(configuration: configuration)
    let done = DispatchSemaphore(value: 0)
    var running = false
    let task = session.dataTask(with: url) { data, response, _ in
      if let http = response as? HTTPURLResponse, http.statusCode == 200,
         let data, String(data: data, encoding: .utf8)?.contains("packager-status:running") == true {
        running = true
      }
      done.signal()
    }
    task.resume()
    if done.wait(timeout: .now() + seconds + 0.5) == .timedOut { task.cancel() }
    session.invalidateAndCancel()
    return running
  }
#endif
}
