import BackgroundAssets
import ExtensionFoundation
import StoreKit

/// The Background Assets downloader for the bundled chat model's Apple-hosted packs (chat_model,
/// chat_mmproj). The packs' "prefetch" policy starts them during install; the system runs this extension
/// to manage them. Every pack is wanted, so the default policy is all it needs.
@main
struct DownloaderExtension: StoreDownloaderExtension {
  func shouldDownload(_ assetPack: AssetPack) -> Bool {
    true
  }
}
