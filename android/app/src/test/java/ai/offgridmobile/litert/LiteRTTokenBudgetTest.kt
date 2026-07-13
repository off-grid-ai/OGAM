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
        // Model + headroom exceed available RAM → KV budget negative, but the 200 MB
        // between weights and avail still affords more than the floor → floor.
        assertEquals(1024, LiteRTModule.clampMaxTokens(4096, 2000, 1800))
    }

    @Test
    fun `does not force the floor when flooring would overcommit`() {
        // KV budget negative AND only 50 MB sits between weights and avail (~333
        // tokens, below the floor). Must NOT force 1024 (would OOM) — cap to what
        // actually fits.
        assertEquals(333, LiteRTModule.clampMaxTokens(4096, 1850, 1800))
    }

    @Test
    fun `returns a single token when even the weights do not fit`() {
        // avail < model → nothing affordable; return 1 token (not the floor) and let
        // the caller's memory guard reject the load instead of overcommitting.
        assertEquals(1, LiteRTModule.clampMaxTokens(4096, 1700, 1800))
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
