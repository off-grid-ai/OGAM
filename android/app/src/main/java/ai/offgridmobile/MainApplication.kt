package ai.offgridmobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.common.JavascriptException
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import ai.offgridmobile.crash.JsCrashFrames
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
        },
      // A fatal JS error still crashes the app, as React Native's default does, but with its JS
      // stack as frames so Play Console can show and group it.
      exceptionHandler = { error ->
        throw if (error is JavascriptException) JsCrashFrames.withJsFrames(error) else error
      },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
