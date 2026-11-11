package ai.offgridmobile.atlasdevice

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

/** One notification to show at a moment: scheduled tasks hand these over (several per task, a couple of weeks ahead). */
data class TaskAlarm(val id: String, val at: Long, val title: String, val body: String)

/**
 * Wakes the phone at the time of a scheduled task to show a notification (tap it and Atlas opens on the Scheduled tasks
 * screen, where the due task runs). The list is kept in SharedPreferences so the alarms can be set again after a reboot.
 * Inexact "allow while idle" alarms are used on purpose: they need no special permission, and may arrive a few minutes late
 * while the phone is dozing.
 */
object TaskAlarms {
    private const val PREFS = "atlas_task_alarms"
    private const val KEY = "list"
    const val ACTION = "ai.offgridmobile.atlas.TASK_ALARM"
    const val EXTRA_ID = "id"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"

    /** The alarms still in the future, soonest first, at most [limit] (Android allows a few hundred alarms per app). */
    fun upcoming(all: List<TaskAlarm>, now: Long, limit: Int = 200): List<TaskAlarm> =
        all.filter { it.at > now }.sortedBy { it.at }.take(limit)

    fun parse(json: String): List<TaskAlarm> {
        val out = ArrayList<TaskAlarm>()
        try {
            val array = JSONArray(json)
            for (i in 0 until array.length()) {
                val o = array.getJSONObject(i)
                out.add(TaskAlarm(o.getString("id"), o.getLong("at"), o.optString("title", "Atlas"), o.optString("body", "")))
            }
        } catch (_: Exception) {
            // A damaged list is the same as no alarms.
        }
        return out
    }

    fun toJson(alarms: List<TaskAlarm>): String {
        val array = JSONArray()
        for (a in alarms) {
            array.put(JSONObject().put("id", a.id).put("at", a.at).put("title", a.title).put("body", a.body))
        }
        return array.toString()
    }

    private fun pending(ctx: Context, alarm: TaskAlarm): PendingIntent {
        val intent = Intent(ACTION).setClass(ctx, TaskAlarmReceiver::class.java)
            .putExtra(EXTRA_ID, alarm.id).putExtra(EXTRA_TITLE, alarm.title).putExtra(EXTRA_BODY, alarm.body)
        return PendingIntent.getBroadcast(ctx, alarm.id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun cancelAll(ctx: Context) {
        val manager = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val saved = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]"
        for (a in parse(saved)) manager.cancel(pending(ctx, a))
    }

    /** Replaces every alarm with this list (the old ones are cancelled). */
    fun apply(ctx: Context, alarms: List<TaskAlarm>) {
        cancelAll(ctx)
        val manager = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val keep = upcoming(alarms, System.currentTimeMillis())
        for (a in keep) manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, a.at, pending(ctx, a))
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, toJson(keep)).apply()
    }

    /** Sets the saved alarms again (after a reboot, which clears them). */
    fun rearm(ctx: Context) {
        val saved = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]"
        apply(ctx, parse(saved))
    }
}
