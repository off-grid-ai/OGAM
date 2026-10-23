package ai.offgridmobile.litert

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * Tests for LiteRTModule.resolveEngineCacheDir — the persistent directory that lets
 * LiteRT-LM reuse compiled GPU programs instead of compiling them on every load (the
 * libGLESv2_adreno / eglSwapBuffers ANR during nativeCreateEngine).
 */
@Suppress("kotlin:S100") // Backtick test names are idiomatic Kotlin
class LiteRTEngineCacheDirTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun `creates a writable cache directory under the base dir`() {
        val base = tmp.newFolder("cache")

        val path = LiteRTModule.resolveEngineCacheDir(base)

        val dir = File(base, LiteRTModule.ENGINE_CACHE_DIR_NAME)
        assertEquals(dir.absolutePath, path)
        assertTrue("cache dir must exist for the native engine", dir.isDirectory)
        assertTrue("cache dir must be writable for the native engine", dir.canWrite())
    }

    @Test
    fun `keeps the same directory and its contents across loads`() {
        val base = tmp.newFolder("cache")
        val first = LiteRTModule.resolveEngineCacheDir(base)
        val compiled = File(first!!, "program.bin").apply { writeText("compiled") }

        val second = LiteRTModule.resolveEngineCacheDir(base)

        assertEquals(first, second)
        assertEquals("compiled", compiled.readText())
    }

    @Test
    fun `creates the directory again after the OS clears the cache`() {
        val base = tmp.newFolder("cache")
        val first = File(LiteRTModule.resolveEngineCacheDir(base)!!)
        first.deleteRecursively()

        val second = LiteRTModule.resolveEngineCacheDir(base)

        assertEquals(first.absolutePath, second)
        assertTrue(first.isDirectory)
    }

    @Test
    fun `falls back to the engine default when there is no base dir`() {
        assertNull(LiteRTModule.resolveEngineCacheDir(null))
    }

    @Test
    fun `falls back to the engine default when the directory cannot be created`() {
        // A regular file where the base dir should be: mkdirs cannot create a child.
        val notADir = tmp.newFile("not-a-dir")

        assertNull(LiteRTModule.resolveEngineCacheDir(notADir))
    }

    @Test
    fun `falls back to the engine default when the directory is not writable`() {
        val base = tmp.newFolder("cache")
        val dir = File(base, LiteRTModule.ENGINE_CACHE_DIR_NAME).apply { mkdirs() }
        dir.setWritable(false)
        try {
            assertNull(LiteRTModule.resolveEngineCacheDir(base))
        } finally {
            dir.setWritable(true)
        }
    }
}
