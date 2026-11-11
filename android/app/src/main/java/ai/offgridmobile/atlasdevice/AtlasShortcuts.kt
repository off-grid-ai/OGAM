package ai.offgridmobile.atlasdevice

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import ai.offgridmobile.MainActivity
import ai.offgridmobile.R

/**
 * The shortcuts shown when the Atlas icon is held down. Each opens atlas://app/<where>, which the app turns into the right
 * screen. They are built at run time (not in an XML file) so they always name the installed app, whatever its id.
 */
object AtlasShortcuts {
    /** id, label, where it goes */
    val ITEMS = listOf(
        Triple("new_chat", "New chat", "chat"),
        Triple("practice_call", "Practice call", "call"),
        Triple("record", "Record", "record"),
        Triple("briefing", "Today's briefing", "brief"),
    )

    fun link(where: String): Uri = Uri.parse("atlas://app/$where")

    fun publish(ctx: Context) {
        try {
            val shortcuts = ITEMS.map { (id, label, where) ->
                ShortcutInfoCompat.Builder(ctx, id)
                    .setShortLabel(label)
                    .setLongLabel(label)
                    .setIcon(IconCompat.createWithResource(ctx, R.mipmap.ic_launcher))
                    .setIntent(Intent(Intent.ACTION_VIEW, link(where), ctx, MainActivity::class.java))
                    .build()
            }
            ShortcutManagerCompat.setDynamicShortcuts(ctx, shortcuts)
        } catch (_: Exception) {
            // Shortcuts are a convenience: never let them stop the app from starting.
        }
    }
}
