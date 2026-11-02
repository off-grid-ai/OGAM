package ai.offgridmobile.enginepack

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import android.app.Application
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * The engine-pack lifecycle on real files: a verified pack goes on trial, a passed test makes it
 * the engine, and anything wrong (a changed file, another React Native, a crash loop, a failed
 * test) leaves the bundled engine loading.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class EnginePackStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    private val rn = "0.83.1"
    private val app = EnginePackStore.AppBuild(rn, "bridge-1", listOf("arm64-v8a"))
    private lateinit var store: EnginePackStore
    private lateinit var root: File

    @Before
    fun setUp() {
        root = tmp.newFolder("engine-packs")
        store = EnginePackStore(root)
    }

    /** An unzipped pack and its manifest entry, the way the JS service hands it over. */
    private fun stagedPack(version: String = "0.14.0", reactNative: String = rn): Pair<File, JSONObject> {
        val staging = tmp.newFolder("staging-$version-${System.nanoTime()}")
        val core = File(staging, "librnllama.so").apply { writeText("core $version") }
        val jni = File(staging, "librnllama_jni.so").apply { writeText("jni $version") }
        File(staging, "htp").mkdirs()
        val htp = File(staging, "htp/libggml-htp-v73.so").apply { writeText("htp $version") }
        val files = JSONObject()
            .put("librnllama.so", EnginePackStore.sha256(core))
            .put("librnllama_jni.so", EnginePackStore.sha256(jni))
            .put("htp/libggml-htp-v73.so", EnginePackStore.sha256(htp))
        val entry = JSONObject()
            .put("engineVersion", version)
            .put("llamaBuild", 12024)
            .put("reactNative", reactNative)
            .put("bridge", "bridge-1")
            .put("abi", "arm64-v8a")
            .put("sha256", "ab".repeat(32))
            .put("files", files)
        return staging to entry
    }

    @Test
    fun `with nothing installed the bundled engine loads`() {
        val choice = store.chooseAtBoot(app)
        assertNull(choice.dir)
        assertNull(choice.packId)
    }

    @Test
    fun `an installed pack loads on trial, then every launch once it passes its test`() {
        val (staging, entry) = stagedPack()
        val id = store.install(staging, entry, app)

        val trial = store.chooseAtBoot(app)
        assertEquals(id, trial.packId)
        assertTrue(trial.trial)
        assertEquals(12024, trial.llamaBuild)
        assertTrue(File(trial.dir, "librnllama.so").isFile)

        store.accept(id)
        val next = store.chooseAtBoot(app)
        assertEquals(id, next.packId)
        assertFalse(next.trial)
    }

    @Test
    fun `a pack still on trial after two launches crashed before its test and is dropped`() {
        val (staging, entry) = stagedPack()
        val id = store.install(staging, entry, app)
        store.chooseAtBoot(app)
        store.chooseAtBoot(app)

        val third = store.chooseAtBoot(app)
        assertNull(third.dir)
        assertEquals(listOf(id), third.dropped)
        assertTrue(store.snapshot().getJSONObject("rejected").has(id))
        assertFalse(File(root, id).exists())
    }

    @Test
    fun `a pack with nothing to test it with stays on trial across launches`() {
        val (staging, entry) = stagedPack()
        val id = store.install(staging, entry, app)
        repeat(4) {
            assertEquals(id, store.chooseAtBoot(app).packId)
            store.keepOnTrial(id)
        }
        assertTrue(store.chooseAtBoot(app).trial)
    }

    @Test
    fun `a failed test prompt rejects the trial and the accepted pack loads again`() {
        val (s1, e1) = stagedPack("0.14.0")
        val good = store.install(s1, e1, app)
        store.chooseAtBoot(app)
        store.accept(good)
        val (s2, e2) = stagedPack("0.15.0")
        val bad = store.install(s2, e2, app)
        assertEquals(bad, store.chooseAtBoot(app).packId)

        store.reject(bad, "test prompt returned nothing")

        assertEquals(good, store.chooseAtBoot(app).packId)
    }

    @Test
    fun `a rejected pack is never installed again`() {
        val (s1, e1) = stagedPack()
        val id = store.install(s1, e1, app)
        store.reject(id, "bad")
        val (s2, _) = stagedPack()
        val failed = runCatching { store.install(s2, e1, app) }
        assertTrue(failed.isFailure)
    }

    @Test
    fun `a file changed after install is caught at boot and the bundled engine loads`() {
        val (staging, entry) = stagedPack()
        val id = store.install(staging, entry, app)
        File(root, "$id/librnllama.so").appendText("tampered")

        val choice = store.chooseAtBoot(app)
        assertNull(choice.dir)
        assertEquals(listOf(id), choice.dropped)
    }

    @Test
    fun `a pack for another React Native or with a wrong hash never installs`() {
        val (s1, e1) = stagedPack(reactNative = "0.82.0")
        assertTrue(runCatching { store.install(s1, e1, app) }.isFailure)

        val (s2, e2) = stagedPack()
        e2.getJSONObject("files").put("librnllama.so", "00".repeat(32))
        assertTrue(runCatching { store.install(s2, e2, app) }.isFailure)
        assertNull(store.chooseAtBoot(app).dir)
    }

    @Test
    fun `an app update to another llama_rn bridge drops the pack`() {
        val (staging, entry) = stagedPack()
        val id = store.install(staging, entry, app)
        store.chooseAtBoot(app)
        store.accept(id)

        val choice = store.chooseAtBoot(app.copy(bridge = "bridge-2"))
        assertNull(choice.dir)
        assertEquals(listOf(id), choice.dropped)
    }

    @Test
    fun `a pack holding a file the manifest does not list never installs`() {
        val (staging, entry) = stagedPack()
        File(staging, "libextra.so").writeText("not in the manifest")
        assertTrue(runCatching { store.install(staging, entry, app) }.isFailure)
    }

    @Test
    fun `a manifest naming a file outside the pack is refused`() {
        val (staging, entry) = stagedPack()
        entry.getJSONObject("files").put("../escape.so", "00".repeat(32))
        assertTrue(runCatching { store.install(staging, entry, app) }.isFailure)
    }

    @Test
    fun `an app update to a new React Native drops the old pack and loads the bundled engine`() {
        val (staging, entry) = stagedPack()
        val id = store.install(staging, entry, app)
        store.chooseAtBoot(app)
        store.accept(id)

        val choice = store.chooseAtBoot(app.copy(reactNative = "0.84.0"))
        assertNull(choice.dir)
        assertEquals(listOf(id), choice.dropped)
    }
}
