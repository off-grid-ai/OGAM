package ai.offgridmobile.scribe

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for ScribeImproveRequests.canReplaceInPlace: Improve offers Replace only when the chosen
 * version can go back to the field the text came from.
 */
@Suppress("kotlin:S100") // Backtick test names are idiomatic Kotlin
class ScribeReplaceInPlaceTest {

    private val own = "ai.offgridmobile"

    @Test
    fun `editable text in another app is replaced in place`() {
        assertTrue(ScribeImproveRequests.canReplaceInPlace(false, "com.example.notes", own))
    }

    @Test
    fun `read-only text is copied`() {
        assertFalse(ScribeImproveRequests.canReplaceInPlace(true, "com.example.notes", own))
    }

    @Test
    fun `a selection in this app's own field is copied, since nothing is left to answer`() {
        assertFalse(ScribeImproveRequests.canReplaceInPlace(false, own, own))
    }
}
