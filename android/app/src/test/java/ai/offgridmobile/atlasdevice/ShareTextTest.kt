package ai.offgridmobile.atlasdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShareTextTest {
    @Test fun takesSharedText() {
        assertEquals("https://example.com/a", ShareText.from(ShareText.ACTION_SEND, "text/plain", " https://example.com/a \n", null))
    }

    @Test fun takesSelectedText() {
        assertEquals("selected words", ShareText.from(ShareText.ACTION_PROCESS_TEXT, "text/plain", null, "selected words"))
    }

    @Test fun ignoresOtherActionsTypesAndEmptyText() {
        assertNull(ShareText.from("android.intent.action.MAIN", "text/plain", "x", "y"))
        assertNull(ShareText.from(ShareText.ACTION_SEND, "image/png", "x", null))
        assertNull(ShareText.from(ShareText.ACTION_SEND, "text/plain", "   ", null))
        assertNull(ShareText.from(ShareText.ACTION_SEND, "text/plain", null, null))
        assertNull(ShareText.from(ShareText.ACTION_PROCESS_TEXT, "text/plain", "ignored", null))
    }

    @Test fun cutsVeryLongText() {
        val text = ShareText.from(ShareText.ACTION_SEND, "text/plain", "a".repeat(ShareText.MAX_CHARS + 500), null)!!
        assertEquals(ShareText.MAX_CHARS, text.length)
    }
}
