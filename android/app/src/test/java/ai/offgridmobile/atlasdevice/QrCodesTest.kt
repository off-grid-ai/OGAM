package ai.offgridmobile.atlasdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QrCodesTest {
    @Test
    fun takesOnlyAnAtlasPairingCode() {
        val codes = listOf("https://example.com/menu", "atlas://sync?id=abc&key=xyz")
        assertEquals("atlas://sync?id=abc&key=xyz", QrCodes.matching(codes, "atlas://sync?"))
        assertNull(QrCodes.matching(listOf("WIFI:S:home;;"), "atlas://sync?"))
    }
}
