package ai.offgridmobile.crash

import com.facebook.react.common.JavascriptException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class JsCrashFramesTest {
    @Test
    fun movesTheJsStackIntoFramesPlayKeeps() {
        val original = JavascriptException(
            "TypeError: Cannot read property 'id' of undefined, stack:\n" +
                "onPress@1:482113\n" +
                "anonymous@1:90211\n" +
                "@1:12\n",
        ).apply { extraDataAsJson = """{"bundle":"x"}""" }

        val reported = JsCrashFrames.withJsFrames(original)

        assertEquals(original.message, reported.message)
        assertEquals("""{"bundle":"x"}""", reported.extraDataAsJson)
        val js = reported.stackTrace.take(3).map { "${it.className}.${it.methodName}(${it.fileName}:${it.lineNumber})" }
        assertEquals(
            listOf(
                "JS.onPress(index.android.bundle:1:482113)",
                "JS.anonymous(index.android.bundle:1:90211)",
                "JS.<anonymous>(index.android.bundle:1:12)",
            ),
            js,
        )
        assertEquals(original.stackTrace.size + 3, reported.stackTrace.size)
    }

    @Test
    fun keepsTheSegmentFileOfASplitBundle() {
        val frames = JsCrashFrames.parse("Error: x, stack:\nrender@seg-1_2.js:10:4\n")

        assertEquals("seg-1_2.js:10", frames.single().fileName)
        assertEquals(4, frames.single().lineNumber)
    }

    @Test
    fun leavesAnExceptionWithoutAJsStackUnchanged() {
        val original = JavascriptException("no stack here")

        assertSame(original, JsCrashFrames.withJsFrames(original))
    }
}
