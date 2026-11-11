package ai.offgridmobile.atlastts

/** How text is cut into pieces for the voice engine (pure, so it can be tested without a phone). */
object SpeechChunks {
    private val SENTENCE_END = Regex("(?<=[.!?\\n])\\s+")

    /** Groups whole sentences into pieces of at most [max] characters (a longer sentence is cut). */
    fun chunks(text: String, max: Int): List<String> {
        val out = mutableListOf<String>()
        val sentences = text.split(SENTENCE_END)
        val sb = StringBuilder()
        for (s in sentences) {
            if (sb.length + s.length + 1 > max && sb.isNotEmpty()) { out.add(sb.toString()); sb.setLength(0) }
            if (s.length > max) { s.chunked(max).forEach { out.add(it) } } else { if (sb.isNotEmpty()) sb.append(' '); sb.append(s) }
        }
        if (sb.isNotEmpty()) out.add(sb.toString())
        return out.filter { it.isNotBlank() }
    }

    /**
     * Like [chunks], but speech starts after only the first sentence has been generated: when the first
     * piece is longer than [firstMax] it is split after its first sentence. A voice that generates
     * slower than it speaks otherwise makes the listener wait for a whole piece before the first word.
     */
    fun speechParts(text: String, max: Int, firstMax: Int = 160): List<String> {
        val all = chunks(text, max)
        if (all.isEmpty() || all[0].length <= firstMax) return all
        val sentences = all[0].split(SENTENCE_END).filter { it.isNotBlank() }
        if (sentences.size < 2) return all
        return listOf(sentences[0], sentences.drop(1).joinToString(" ")) + all.drop(1)
    }
}
