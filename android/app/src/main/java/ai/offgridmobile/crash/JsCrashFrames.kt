package ai.offgridmobile.crash

import com.facebook.react.common.JavascriptException

/**
 * Makes a fatal JavaScript error readable in Play Console.
 *
 * React Native reports a JS fatal as a [JavascriptException] whose message holds the JS error and
 * its stack. Play strips exception messages before it shows a report, so every JS fatal arrived as
 * one anonymous "JavascriptException:" issue with only React Native's queue frames. Play keeps
 * stack frames, so the JS frames are moved into the stack trace, where Play shows them and groups
 * each distinct crash as its own issue. Symbolicate them with the release bundle's source map.
 */
object JsCrashFrames {
    // React Native writes each frame as "method@[file.js:]line[:column]" (JSStackTrace.format).
    private val FRAME = Regex("""^(.*)@(?:(\S+\.js):)?(-?\d+)(?::(\d+))?$""")
    private const val STACK_MARKER = ", stack:\n"

    fun withJsFrames(error: JavascriptException): JavascriptException {
        val message = error.message ?: return error
        val frames = parse(message)
        if (frames.isEmpty()) return error
        return JavascriptException(message).apply {
            extraDataAsJson = error.extraDataAsJson
            stackTrace = (frames + error.stackTrace).toTypedArray()
        }
    }

    internal fun parse(message: String): List<StackTraceElement> {
        val start = message.indexOf(STACK_MARKER)
        if (start < 0) return emptyList()
        return message.substring(start + STACK_MARKER.length)
            .lineSequence()
            .mapNotNull { FRAME.matchEntire(it.trim()) }
            .map { match ->
                val (method, file, line, column) = match.destructured
                StackTraceElement(
                    "JS",
                    method.ifBlank { "<anonymous>" },
                    "${file.ifBlank { "index.android.bundle" }}:$line",
                    // Hermes puts the whole bundle on line 1; the column is what locates the frame.
                    column.toIntOrNull() ?: line.toInt(),
                )
            }
            .toList()
    }
}
