/**
 * The week, aggregated - the Reflect view's numbers.
 *
 * A longer horizon than the day: how much you talked each day, how many commitments you kept vs left
 * open, and who came up most. Pure - sessions + the done-set + the week's day keys in, the reflection
 * out - so the screen just renders it and the numbers have a witness.
 */

import { dayKeyOf, type TimelineSession } from './timelineModel'
import { collectDayTasks } from './dayModel'

export interface DayBar {
  dayKey: string
  count: number
}
export interface PersonCount {
  name: string
  count: number
}
export interface WeekReflection {
  /** One bar per day of the week, in the order given. */
  bars: DayBar[]
  conversationCount: number
  totalSpeechMs: number
  tasksKept: number
  tasksTotal: number
  topPeople: PersonCount[]
}

type ToParts = (ms: number) => { y: number; m: number; d: number }

/**
 * Aggregate the sessions that fall on `weekDayKeys` (the days to include, in display order). Tasks are
 * counted across the whole week via the same collector the Day view uses, so "kept" agrees with what
 * the user checked off.
 */
export function reflectWeek(
  sessions: TimelineSession[],
  doneIds: ReadonlySet<string>,
  weekDayKeys: string[],
  toParts: ToParts,
  topPeopleLimit = 5
): WeekReflection {
  const inWeek = new Set(weekDayKeys)
  const weekSessions = sessions.filter(s => inWeek.has(dayKeyOf(s.startMs, toParts)))

  const perDay = new Map<string, number>()
  for (const key of weekDayKeys) perDay.set(key, 0)
  for (const s of weekSessions) {
    const key = dayKeyOf(s.startMs, toParts)
    perDay.set(key, (perDay.get(key) ?? 0) + 1)
  }

  const tasks = collectDayTasks(weekSessions, doneIds)
  const people = new Map<string, number>()
  for (const s of weekSessions) {
    for (const name of s.summary.people) {
      people.set(name, (people.get(name) ?? 0) + 1)
    }
  }
  const topPeople = [...people.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name < b.name ? -1 : 1))
    .slice(0, topPeopleLimit)

  return {
    bars: weekDayKeys.map(dayKey => ({ dayKey, count: perDay.get(dayKey) ?? 0 })),
    conversationCount: weekSessions.length,
    totalSpeechMs: weekSessions.reduce((sum, s) => sum + s.speechMs, 0),
    tasksKept: tasks.filter(t => t.done).length,
    tasksTotal: tasks.length,
    topPeople
  }
}
