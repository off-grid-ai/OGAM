package ai.offgridmobile.bundledmodel

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.play.core.aipacks.AiPackManager
import com.google.android.play.core.aipacks.AiPackManagerFactory
import com.google.android.play.core.aipacks.AiPackState
import com.google.android.play.core.aipacks.AiPackStateUpdateListener
import com.google.android.play.core.aipacks.model.AiPackStatus
import java.io.File

/**
 * The bundled chat model's packs for JS (src/services/bundledModel): where each pack is on its way to
 * the phone, where its files are once it has arrived, and progress events while it downloads.
 *
 * Play delivers the packs (fast-follow AI packs, android/chat_model and android/chat_mmproj). This module only
 * reports and asks; the JS service decides what a state means for the person. iOS answers the same
 * contract from its own pack system.
 *
 * The "with model" APK (GitHub releases, built with -PmodelInApk) carries the same files inside the APK,
 * under assets/<pack>/. With no Play pack, such a pack is copied out once and reported as arrived, so the
 * JS service adopts it exactly as it adopts a pack Play delivered.
 */
class BundledModelModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BundledModel"

    private val manager: AiPackManager by lazy { AiPackManagerFactory.getInstance(reactApplicationContext) }

    private var listener: AiPackStateUpdateListener? = null

    /** One state per pack name; a pack Play does not know (a sideloaded build) is "not_installed". */
    @ReactMethod
    fun getPacks(names: ReadableArray, promise: Promise) {
        val list = names.toStringList()
        manager.getPackStates(list)
            .addOnSuccessListener { states -> resolvePacks(list, promise) { states.packStates()[it] } }
            .addOnFailureListener { resolvePacks(list, promise) { null } }
    }

    /** Play's states, with any pack the APK carries copied out and reported as arrived. */
    private fun resolvePacks(names: List<String>, promise: Promise, stateOf: (String) -> AiPackState?) {
        val fromApk = names.filter { stateOf(it)?.status() != AiPackStatus.COMPLETED && apkCarries(it) }
        if (fromApk.isEmpty()) {
            promise.resolve(packMap(names, stateOf))
            return
        }
        // The copy is 1.5 GB: never on the JS or UI thread.
        Thread {
            val dirs = fromApk.associateWith { runCatching { copyOutOfApk(it) }.getOrNull() }
            val map = Arguments.createMap()
            names.forEach { name ->
                map.putMap(name, dirs[name]?.let { apkPackMap(name, it) } ?: stateMap(name, stateOf(name)))
            }
            promise.resolve(map)
        }.start()
    }

    /** The APK holds this pack's files and they have not been taken into the library yet. */
    private fun apkCarries(pack: String): Boolean =
        !adoptedMarker(pack).exists() && reactApplicationContext.assets.list(pack)?.isNotEmpty() == true

    private fun apkPackDir(pack: String) = File(reactApplicationContext.filesDir, "model-in-apk/$pack")

    private fun adoptedMarker(pack: String) = File(reactApplicationContext.filesDir, "model-in-apk/$pack.adopted")

    /** Copies the pack's files out of the APK (stored uncompressed: noCompress 'gguf'); a finished copy is kept. */
    private fun copyOutOfApk(pack: String): File {
        val assets = reactApplicationContext.assets
        val dir = apkPackDir(pack).apply { mkdirs() }
        assets.list(pack).orEmpty().forEach { name ->
            val dest = File(dir, name)
            val size = assets.openFd("$pack/$name").use { it.length }
            if (dest.length() == size) return@forEach
            val partial = File(dir, "$name.part")
            assets.open("$pack/$name").use { input -> partial.outputStream().use { input.copyTo(it, 1 shl 20) } }
            if (!partial.renameTo(dest)) throw IllegalStateException("could not move $name into place")
        }
        return dir
    }

    private fun apkPackMap(name: String, dir: File): WritableMap {
        val bytes = dir.listFiles().orEmpty().sumOf { it.length() }.toDouble()
        val map = Arguments.createMap()
        map.putString("name", name)
        map.putString("status", "completed")
        map.putDouble("bytesDownloaded", bytes)
        map.putDouble("totalBytes", bytes)
        map.putInt("errorCode", 0)
        map.putString("assetsPath", dir.absolutePath)
        return map
    }

    /** Ask Play to download the packs now (after a failure, or if fast-follow has not started). */
    @ReactMethod
    fun fetch(names: ReadableArray, promise: Promise) {
        val list = names.toStringList()
        manager.fetch(list)
            .addOnSuccessListener { states -> promise.resolve(packMap(list) { states.packStates()[it] }) }
            .addOnFailureListener { promise.reject("BUNDLED_MODEL_FETCH", it) }
    }

    /** Forget a pack once its files moved into the models folder, so Play keeps no stale state. */
    @ReactMethod
    fun removePack(name: String, promise: Promise) {
        // A pack the APK carried: drop what is left of the copy and never copy it out again, so a model
        // the person deletes later does not come back.
        if (reactApplicationContext.assets.list(name)?.isNotEmpty() == true) {
            apkPackDir(name).deleteRecursively()
            adoptedMarker(name).apply { parentFile?.mkdirs() }.writeText("")
        }
        manager.removePack(name)
            .addOnSuccessListener { promise.resolve(true) }
            .addOnFailureListener { promise.resolve(false) }
    }

    /** Progress events start with the first JS listener and stop with the last. */
    @ReactMethod
    fun addListener(eventName: String) {
        if (listener != null) return
        val next = AiPackStateUpdateListener { state ->
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT, stateMap(state.name(), state))
        }
        listener = next
        manager.registerListener(next)
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        listener?.let { manager.unregisterListener(it) }
        listener = null
    }

    override fun invalidate() {
        listener?.let { manager.unregisterListener(it) }
        listener = null
        super.invalidate()
    }

    private fun packMap(names: List<String>, stateOf: (String) -> AiPackState?): WritableMap {
        val map = Arguments.createMap()
        names.forEach { map.putMap(it, stateMap(it, stateOf(it))) }
        return map
    }

    private fun stateMap(name: String, state: AiPackState?): WritableMap {
        val map = Arguments.createMap()
        map.putString("name", name)
        map.putString("status", state?.let { statusName(it.status()) } ?: "not_installed")
        map.putDouble("bytesDownloaded", (state?.bytesDownloaded() ?: 0L).toDouble())
        map.putDouble("totalBytes", (state?.totalBytesToDownload() ?: 0L).toDouble())
        map.putInt("errorCode", state?.errorCode() ?: 0)
        val path = manager.getPackLocation(name)?.assetsPath()
        if (path != null) map.putString("assetsPath", path) else map.putNull("assetsPath")
        return map
    }

    private fun statusName(status: Int): String = when (status) {
        AiPackStatus.PENDING -> "pending"
        AiPackStatus.DOWNLOADING -> "downloading"
        AiPackStatus.TRANSFERRING -> "transferring"
        AiPackStatus.COMPLETED -> "completed"
        AiPackStatus.FAILED -> "failed"
        AiPackStatus.CANCELED -> "canceled"
        AiPackStatus.WAITING_FOR_WIFI -> "waiting_for_wifi"
        AiPackStatus.REQUIRES_USER_CONFIRMATION -> "requires_confirmation"
        AiPackStatus.NOT_INSTALLED -> "not_installed"
        else -> "unknown"
    }

    private fun ReadableArray.toStringList(): List<String> = (0 until size()).mapNotNull { getString(it) }

    private companion object {
        const val EVENT = "BundledModelPack"
    }
}
