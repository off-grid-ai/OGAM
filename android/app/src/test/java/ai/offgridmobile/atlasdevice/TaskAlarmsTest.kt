package ai.offgridmobile.atlasdevice

import org.junit.Assert.assertEquals
import org.junit.Test

class TaskAlarmsTest {
    private fun alarm(id: String, at: Long) = TaskAlarm(id, at, "t", "b")

    @Test
    fun upcomingDropsThePastAndSortsTheRest() {
        val list = listOf(alarm("c", 300), alarm("a", 100), alarm("b", 200))
        assertEquals(listOf("b", "c"), TaskAlarms.upcoming(list, 150).map { it.id })
    }

    @Test
    fun upcomingKeepsOnlyTheSoonestUpToTheLimit() {
        val list = (1..10).map { alarm("n$it", it * 10L) }
        assertEquals(listOf("n1", "n2", "n3"), TaskAlarms.upcoming(list, 0, 3).map { it.id })
    }
}
