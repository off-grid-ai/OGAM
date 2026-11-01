package ai.offgridmobile.enginepack

import android.content.Context
import android.os.Build
import android.util.Log
import ai.offgridmobile.BuildConfig
import com.facebook.react.modules.systeminfo.ReactNativeVersion
import com.rnllama.RNLlama
import java.io.File

/**
 * Runs in Application.onCreate, before React Native: picks the engine pack this launch loads and
 * hands its folder to llama.rn, which loads it in place of the bundled libraries (and falls back to
 * them itself when the pack fails to load). Whatever goes wrong here, the bundled engine loads.
 */
object EnginePackBoot {
    private const val TAG = "EnginePack"

    @Volatile
    var choice: EnginePackStore.BootChoice? = null
        private set

    fun store(context: Context) = EnginePackStore(File(context.filesDir, "engine-packs"))

    /** The React Native version this app build runs: a pack's JNI libraries must match it exactly. */
    fun reactNativeVersion(): String {
        val v = ReactNativeVersion.VERSION
        return "${v["major"]}.${v["minor"]}.${v["patch"]}"
    }

    /** What a pack must match in this build. The bridge hash is read from the installed llama.rn at build time. */
    fun appBuild() = EnginePackStore.AppBuild(reactNativeVersion(), BuildConfig.LLAMA_ENGINE_BRIDGE, Build.SUPPORTED_64_BIT_ABIS.toList())

    fun apply(context: Context) {
        try {
            val chosen = store(context).chooseAtBoot(appBuild())
            choice = chosen
            chosen.dropped.forEach { Log.w(TAG, "Dropped engine pack $it") }
            if (chosen.dir != null) {
                Log.i(TAG, "Loading engine pack ${chosen.packId} (trial=${chosen.trial})")
                RNLlama.setEnginePackDir(chosen.dir)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Engine pack boot failed; the bundled engine loads", e)
        }
    }
}
