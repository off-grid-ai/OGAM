package ai.offgridmobile.atlasdevice

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AtlasDevicePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(AtlasDeviceModule(reactContext), AtlasNearbySyncModule(reactContext), AtlasQrScannerModule(reactContext), AtlasShareModule(reactContext), AtlasTaskAlarmsModule(reactContext))
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = listOf(AtlasMapViewManager())
}
