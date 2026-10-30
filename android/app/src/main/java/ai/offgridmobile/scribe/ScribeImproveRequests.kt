package ai.offgridmobile.scribe

import java.lang.ref.WeakReference
import java.util.UUID

/** The one Improve request waiting for the app: its text and, to replace in place, its caller. */
internal object ScribeImproveRequests {
    data class Request(val id: String, val text: String, val caller: WeakReference<ImproveTextActivity>?)

    @Volatile var pending: Request? = null
        private set
    @Volatile var current: Request? = null
        private set
    var onOffer: (() -> Unit)? = null

    fun offer(text: String, caller: ImproveTextActivity?) {
        current?.caller?.get()?.finishWith(null)
        pending = Request(UUID.randomUUID().toString(), text, caller?.let { WeakReference(it) })
        onOffer?.invoke()
    }

    /** The app takes the request to show it. */
    fun take(): Request? {
        val request = pending ?: return null
        pending = null
        current = request
        return request
    }

    /** Give `text` back to the caller (null cancels). Returns false when the caller is gone. */
    fun finish(id: String, text: String?): Boolean {
        val request = current?.takeIf { it.id == id } ?: return false
        current = null
        val caller = request.caller?.get() ?: return false
        caller.runOnUiThread { caller.finishWith(text) }
        return true
    }

    fun release(activity: ImproveTextActivity) {
        if (current?.caller?.get() === activity) current = null
        if (pending?.caller?.get() === activity) pending = pending?.copy(caller = null)
    }
}
