package ai.offgridmobile.devicememory

import android.app.ActivityManager
import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Exposes the REAL per-process memory headroom to JS — not a fraction-of-total-RAM
 * guess. iOS uses os_proc_available_memory(); Android has no exact twin, so we use
 * ActivityManager's system available memory, which is the practical ceiling for
 * large native allocations before the low-memory killer applies pressure. Same TS
 * contract on both platforms (getMemoryInfo → { processAvailableBytes, ... }).
 */
class DeviceMemoryModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "DeviceMemoryModule"

    @ReactMethod
    fun getMemoryInfo(promise: Promise) {
        try {
            val am = reactApplicationContext
                .getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val mi = ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            val map = Arguments.createMap()
            map.putDouble("processAvailableBytes", mi.availMem.toDouble())
            map.putDouble("footprintBytes", (mi.totalMem - mi.availMem).toDouble())
            map.putBoolean("lowMemory", mi.lowMemory)
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("MEM_ERROR", e)
        }
    }
}
