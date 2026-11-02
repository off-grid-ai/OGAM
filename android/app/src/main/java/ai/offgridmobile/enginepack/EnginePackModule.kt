package ai.offgridmobile.enginepack

import android.content.Intent
import ai.offgridmobile.BuildConfig
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.rnllama.RNLlama
import org.json.JSONObject
import java.io.File

/**
 * The engine-pack store for JS (src/services/enginePacks): what this launch loaded, install a
 * verified pack on trial, accept or reject it, and relaunch so a rejected pack leaves the process.
 */
class EnginePackModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "EnginePack"

    private val store get() = EnginePackBoot.store(reactApplicationContext)

    @ReactMethod
    fun getStatus(promise: Promise) {
        try {
            val choice = EnginePackBoot.choice
            val map = Arguments.createMap()
            map.putString("bootPackId", choice?.packId)
            map.putBoolean("trial", choice?.trial ?: false)
            if (choice?.llamaBuild != null) map.putInt("llamaBuild", choice.llamaBuild) else map.putNull("llamaBuild")
            map.putString("engineVersion", choice?.engineVersion)
            map.putString("bundledVersion", BuildConfig.LLAMA_ENGINE_VERSION)
            // "pack" or "bundled" once llama.rn has loaded its libraries; null before.
            map.putString("source", RNLlama.getNativeLibrarySource())
            map.putString("error", RNLlama.getEnginePackError())
            val app = EnginePackBoot.appBuild()
            map.putString("reactNative", app.reactNative)
            map.putString("bridge", app.bridge)
            map.putArray("abis", Arguments.fromList(app.abis))
            map.putString("state", store.snapshot().toString())
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ENGINE_PACK_STATUS", e)
        }
    }

    /** `stagingDir` holds the unzipped pack; `entryJson` is its signed manifest entry. */
    @ReactMethod
    fun install(stagingDir: String, entryJson: String, promise: Promise) {
        try {
            promise.resolve(store.install(File(stagingDir), JSONObject(entryJson), EnginePackBoot.appBuild()))
        } catch (e: Exception) {
            promise.reject("ENGINE_PACK_INSTALL", e.message, e)
        }
    }

    @ReactMethod
    fun accept(id: String, promise: Promise) {
        try {
            store.accept(id)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ENGINE_PACK_ACCEPT", e.message, e)
        }
    }

    @ReactMethod
    fun keepOnTrial(id: String, promise: Promise) {
        try {
            store.keepOnTrial(id)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ENGINE_PACK_KEEP", e.message, e)
        }
    }

    @ReactMethod
    fun reject(id: String, reason: String, promise: Promise) {
        try {
            store.reject(id, reason)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ENGINE_PACK_REJECT", e.message, e)
        }
    }

    /** A loaded library cannot be unloaded, so a rejected pack leaves only with the process. */
    @ReactMethod
    fun relaunch() {
        val context = reactApplicationContext
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        (context.currentActivity ?: context).startActivity(intent)
        Runtime.getRuntime().exit(0)
    }
}
