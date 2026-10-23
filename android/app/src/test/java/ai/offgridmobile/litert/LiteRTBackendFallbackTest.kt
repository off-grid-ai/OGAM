package ai.offgridmobile.litert

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Tests for LiteRTModule.firstWorkingBackend — the backend fallback policy. Each tier
 * gets exactly one attempt, so a failing GPU init can't stack several long GPU jobs
 * (the libGLESv2_adreno / eglSwapBuffers ANR) before the CPU fallback.
 */
@Suppress("kotlin:S100") // Backtick test names are idiomatic Kotlin
class LiteRTBackendFallbackTest {

    private fun run(chain: List<String>, working: Set<String>): Pair<String?, List<String>> {
        val attempts = mutableListOf<String>()
        val chosen = runBlocking {
            LiteRTModule.firstWorkingBackend(chain) { backend ->
                attempts += backend
                backend in working
            }
        }
        return chosen to attempts
    }

    @Test
    fun `a failing GPU is tried once, then the model loads on CPU`() {
        val (chosen, attempts) = run(listOf("gpu", "cpu"), working = setOf("cpu"))

        assertEquals("cpu", chosen)
        assertEquals(listOf("gpu", "cpu"), attempts)
    }

    @Test
    fun `NPU then GPU each get one attempt before the CPU fallback`() {
        val (chosen, attempts) = run(listOf("npu", "gpu", "cpu"), working = setOf("cpu"))

        assertEquals("cpu", chosen)
        assertEquals(listOf("npu", "gpu", "cpu"), attempts)
    }

    @Test
    fun `a working GPU loads on the first attempt and CPU is never tried`() {
        val (chosen, attempts) = run(listOf("gpu", "cpu"), working = setOf("gpu", "cpu"))

        assertEquals("gpu", chosen)
        assertEquals(listOf("gpu"), attempts)
    }

    @Test
    fun `returns null after one attempt per tier when every tier fails`() {
        val (chosen, attempts) = run(listOf("npu", "gpu", "cpu"), working = emptySet())

        assertNull(chosen)
        assertEquals(listOf("npu", "gpu", "cpu"), attempts)
    }
}
