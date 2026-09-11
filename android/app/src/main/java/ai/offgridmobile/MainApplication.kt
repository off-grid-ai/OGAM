package ai.offgridmobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import ai.offgridmobile.download.DownloadManagerPackage
import ai.offgridmobile.localdream.LocalDreamPackage
import ai.offgridmobile.pdf.PDFExtractorPackage
import ai.offgridmobile.litert.LiteRTPackage
import ai.offgridmobile.devicememory.DeviceMemoryPackage
import ai.offgridmobile.clipboard.SyncClipboardPackage
import ai.offgridmobile.directory.SyncDirectorySourcePackage
import ai.offgridmobile.downloads.SyncDownloadsPackage
import ai.offgridmobile.sync.BlobChannelPackage
import ai.offgridmobile.screenshot.SyncScreenshotPackage
import ai.offgridmobile.sync.MeshResidencyPackage
import ai.offgridmobile.confinedfile.OffgridConfinedFilePackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(DownloadManagerPackage())
          add(LocalDreamPackage())
          add(PDFExtractorPackage())
          add(LiteRTPackage())
          add(DeviceMemoryPackage())
          add(SyncClipboardPackage())
          add(SyncDirectorySourcePackage())
          add(MeshResidencyPackage())
          add(SyncScreenshotPackage())
          add(SyncDownloadsPackage())
          add(BlobChannelPackage())
          add(OffgridConfinedFilePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
