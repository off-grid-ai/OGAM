package ai.offgridmobile.litert

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for LiteRTModule.clampMaxTokens — the pure RAM-aware token-budget clamp that
 * keeps engine creation from aborting (SIGABRT) / segfaulting under memory pressure.
 */
@Suppress("kotlin:S100") // Backtick test names are idiomatic Kotlin
class LiteRTTokenBudgetTest {

    @Test
    fun `keeps the requested budget when memory is comfortable`() {
        // 6 GB free, 1.5 GB model → plenty of room for 4096 tokens.
        assertEquals(4096, LiteRTModule.clampMaxTokens(4096, 6000, 1500))
    }

    @Test
    fun `clamps the budget down proportionally when memory is tight`() {
        // ~3068 MB free, 2 GB model → 300 MB KV budget / 0.15 = 2000 affordable tokens.
        val clamped = LiteRTModule.clampMaxTokens(4096, 3068, 2000)
        assertEquals(2000, clamped)
        assertTrue("expected clamp below request", clamped < 4096)
    }

    @Test
    fun `falls back to the floor when weights barely fit`() {
        // Model + headroom already exceed available RAM → KV budget negative.
        assertEquals(1024, LiteRTModule.clampMaxTokens(4096, 2000, 1800))
    }

    @Test
    fun `never returns more than requested even with abundant RAM`() {
        assertEquals(2048, LiteRTModule.clampMaxTokens(2048, 16000, 1000))
    }

    @Test
    fun `floor still applies when requested is below the floor`() {
        // Tight memory but a small request → return the smaller of request and floor.
        assertEquals(512, LiteRTModule.clampMaxTokens(512, 2000, 1800))
    }
}
