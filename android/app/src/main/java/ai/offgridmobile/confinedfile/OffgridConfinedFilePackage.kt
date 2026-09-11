package ai.offgridmobile.confinedfile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class OffgridConfinedFilePackage : ReactPackage {
    @Deprecated("React Native requires this legacy package registration method.")
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(OffgridConfinedFileModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
