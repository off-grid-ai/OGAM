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
import ai.offgridmobile.atlastts.AtlasTtsPackage
import ai.offgridmobile.atlasvideo.AtlasVideoPackage
import ai.offgridmobile.atlasvulkan.AtlasVulkanPackage
import ai.offgridmobile.atlaskiwix.AtlasKiwixPackage
import ai.offgridmobile.atlasdevice.AtlasDevicePackage
import ai.offgridmobile.presentation.AtlasPresentationExporterPackage
import ai.offgridmobile.atlasaudio.AtlasAudioPackage

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
          add(AtlasTtsPackage())
          add(AtlasVideoPackage())
          add(AtlasVulkanPackage())
          add(AtlasKiwixPackage())
          add(AtlasDevicePackage())
          add(AtlasPresentationExporterPackage())
          add(AtlasAudioPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
