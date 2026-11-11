package ai.offgridmobile.atlasdevice

/**
 * The text another app hands to Atlas: a shared link or note (Share, ACTION_SEND) or text selected in any app and sent
 * with "Ask Atlas" (ACTION_PROCESS_TEXT). Kept free of Android types so it is tested on the JVM.
 */
internal object ShareText {
    const val MAX_CHARS = 20000
    const val ACTION_SEND = "android.intent.action.SEND"
    const val ACTION_PROCESS_TEXT = "android.intent.action.PROCESS_TEXT"

    fun from(action: String?, mimeType: String?, sharedText: CharSequence?, selectedText: CharSequence?): String? {
        val raw = when (action) {
            ACTION_SEND -> if (mimeType?.startsWith("text/") == true) sharedText else null
            ACTION_PROCESS_TEXT -> selectedText
            else -> null
        } ?: return null
        val text = raw.toString().trim()
        return if (text.isEmpty()) null else text.take(MAX_CHARS)
    }
}
