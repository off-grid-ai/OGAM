package ai.offgridmobile.enginepack

import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * The llama.cpp engine packs installed in app-private storage, and the one state file that says
 * which one the next launch loads. A pack is the full librnllama*.so set for one React Native
 * version and ABI, pinned by a signed manifest entry (src/services/enginePacks verifies the
 * signature before it hands a pack here). This store is the only writer of that state: it runs
 * at boot, before React Native, to pick the pack, and behind EnginePackModule afterwards.
 *
 * A new pack starts on trial. Each launch that loads it counts; the app accepts it once a test
 * prompt passes. A pack that is still on trial after MAX_TRIAL_LAUNCHES launches crashed or hung
 * before its test, so it is rejected and the bundled engine loads instead.
 *
 * Layout under `root`: state.json, and one folder per pack id holding its files.
 */
class EnginePackStore(private val root: File) {

    /** What a pack must match in this app build: React Native, the llama.rn Java/JS bridge, an ABI. */
    data class AppBuild(val reactNative: String, val bridge: String, val abis: List<String>)

    /** What boot decided: the folder to load from (null = bundled), and why a pack was dropped. */
    data class BootChoice(val packId: String?, val dir: File?, val llamaBuild: Int?, val trial: Boolean, val dropped: List<String>)

    private val stateFile = File(root, "state.json")

    /** Pick the pack this launch loads, re-verifying every file's sha256 first. */
    @Synchronized
    fun chooseAtBoot(app: AppBuild): BootChoice {
        val state = readState()
        val dropped = mutableListOf<String>()
        val trial = state.optJSONObject("trial")
        if (trial != null && trial.optInt("launches") >= MAX_TRIAL_LAUNCHES) {
            val id = trial.getString("id")
            rejectLocked(state, id, "still on trial after $MAX_TRIAL_LAUNCHES launches (it crashed or hung before its test prompt)")
            dropped += id
        }
        for (id in listOfNotNull(state.optJSONObject("trial")?.getString("id"), state.optString("active").ifEmpty { null })) {
            val entry = state.optJSONObject("packs")?.optJSONObject(id)
            val problem = if (entry == null) "has no manifest entry" else problemWith(File(root, id), entry, app)
            if (problem != null) {
                rejectLocked(state, id, problem)
                dropped += id
                continue
            }
            val onTrial = state.optJSONObject("trial")?.getString("id") == id
            if (onTrial) state.getJSONObject("trial").put("launches", state.getJSONObject("trial").optInt("launches") + 1)
            writeState(state)
            return BootChoice(id, File(root, id), entry!!.optInt("llamaBuild").takeIf { it > 0 }, onTrial, dropped)
        }
        writeState(state)
        return BootChoice(null, null, null, false, dropped)
    }

    /**
     * Move a verified, unzipped pack from `staging` into the store and put it on trial for the
     * next launch. `entry` is the signed manifest entry; every file in it must match by sha256.
     */
    @Synchronized
    fun install(staging: File, entry: JSONObject, app: AppBuild): String {
        val id = packId(entry)
        val state = readState()
        if (state.optJSONObject("rejected")?.has(id) == true) throw IllegalStateException("Pack $id was rejected before")
        problemWith(staging, entry, app)?.let { throw IllegalArgumentException(it) }
        val dir = File(root, id)
        dir.deleteRecursively()
        if (!staging.renameTo(dir)) {
            staging.copyRecursively(dir, overwrite = true)
            staging.deleteRecursively()
        }
        packs(state).put(id, entry)
        state.put("trial", JSONObject().put("id", id).put("launches", 0))
        writeState(state)
        return id
    }

    /** The pack passed its test prompt: it becomes the engine every launch loads. */
    @Synchronized
    fun accept(id: String) {
        val state = readState()
        val previous = state.optString("active").ifEmpty { null }
        state.put("active", id)
        if (state.optJSONObject("trial")?.getString("id") == id) state.remove("trial")
        if (previous != null && previous != id) {
            File(root, previous).deleteRecursively()
            packs(state).remove(previous)
        }
        writeState(state)
    }

    /**
     * The pack loaded and the app came up, but there was nothing to test it with yet: it stays on
     * trial without counting this launch toward the crash limit.
     */
    @Synchronized
    fun keepOnTrial(id: String) {
        val state = readState()
        val trial = state.optJSONObject("trial") ?: return
        if (trial.getString("id") != id) return
        trial.put("launches", 0)
        writeState(state)
    }

    /** The pack failed to load or failed its test prompt: never load it again. */
    @Synchronized
    fun reject(id: String, reason: String) {
        val state = readState()
        rejectLocked(state, id, reason)
        writeState(state)
    }

    /** The active and trial pack ids, the rejected ones with their reasons, and every pack entry. */
    @Synchronized
    fun snapshot(): JSONObject = readState()

    private fun rejectLocked(state: JSONObject, id: String, reason: String) {
        val rejected = state.optJSONObject("rejected") ?: JSONObject().also { state.put("rejected", it) }
        rejected.put(id, reason)
        if (state.optJSONObject("trial")?.getString("id") == id) state.remove("trial")
        if (state.optString("active") == id) state.remove("active")
        packs(state).remove(id)
        File(root, id).deleteRecursively()
    }

    /** Why this folder cannot be loaded for this app build, or null when every check passes. */
    private fun problemWith(dir: File, entry: JSONObject, app: AppBuild): String? {
        if (entry.optString("reactNative") != app.reactNative) {
            return "built for React Native ${entry.optString("reactNative")}, the app runs ${app.reactNative}"
        }
        if (app.bridge.isEmpty() || entry.optString("bridge") != app.bridge) return "built for another llama.rn bridge than this app's"
        if (entry.optString("abi") !in app.abis) return "built for ${entry.optString("abi")}, the phone runs ${app.abis.joinToString()}"
        val files = entry.optJSONObject("files") ?: return "lists no files"
        if (!files.has("librnllama.so")) return "has no librnllama.so"
        for (name in files.keys()) {
            if (name.contains("..") || name.startsWith("/")) return "names a file outside the pack: $name"
            val file = File(dir, name)
            if (!file.isFile) return "is missing $name"
            if (sha256(file) != files.getString(name).lowercase()) return "$name does not match its sha256"
        }
        val extra = dir.walkTopDown().filter { it.isFile }.map { it.relativeTo(dir).invariantSeparatorsPath }.firstOrNull { !files.has(it) }
        return extra?.let { "holds a file the manifest does not list: $it" }
    }

    private fun packs(state: JSONObject): JSONObject =
        state.optJSONObject("packs") ?: JSONObject().also { state.put("packs", it) }

    private fun readState(): JSONObject = try {
        JSONObject(stateFile.readText())
    } catch (_: Exception) {
        JSONObject()
    }

    private fun writeState(state: JSONObject) {
        root.mkdirs()
        val tmp = File(root, "state.json.tmp")
        tmp.writeText(state.toString())
        if (!tmp.renameTo(stateFile)) throw IllegalStateException("Could not write ${stateFile.path}")
    }

    companion object {
        const val MAX_TRIAL_LAUNCHES = 2
        private val SAFE_ID = Regex("[^A-Za-z0-9._-]")

        /** A pack's folder name: its engine version and the first 12 hex of its zip's sha256. */
        fun packId(entry: JSONObject): String =
            "${entry.getString("engineVersion")}-${entry.getString("sha256").take(12)}".replace(SAFE_ID, "_")

        fun sha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(1 shl 16)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }
}
