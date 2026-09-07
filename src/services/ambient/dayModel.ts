/**
 * The Day view's aggregations over a day's conversations.
 *
 * The lead's Day model leads with "what to do": the tasks scattered across the day's conversations,
 * collected into one checkable list with the conversation each came from. Extraction already happens
 * per conversation (summary.actionItems); this flattens them into day-level tasks, carries provenance,
 * and folds in which ones you've checked off.
 *
 * PURE: sessions + a set of done ids in, day tasks out. The done set is owned/persisted elsewhere so
 * this stays a testable projection.
 */

import type { TimelineSession } from './timelineModel'

export interface DayTask {
  /** Stable within a day: the conversation + the action's position in it. */
  id: string
  text: string
  sessionId: string
  sessionTitle: string
  sessionStartMs: number
  done: boolean
}

/** `sessionId#index` - stable as long as a conversation's action list is stable. */
export function dayTaskId(sessionId: string, index: number): string {
  return `${sessionId}#${index}`
}

/**
 * Every action item across the day as a checkable task, oldest conversation first, with the
 * conversation it came from. `doneIds` marks the ones already cleared.
 */
export function collectDayTasks(
  sessions: TimelineSession[],
  doneIds: ReadonlySet<string> = new Set()
): DayTask[] {
  const ordered = [...sessions].sort((a, b) => a.startMs - b.startMs)
  const tasks: DayTask[] = []
  for (const session of ordered) {
    session.summary.actionItems.forEach((text, index) => {
      const id = dayTaskId(session.id, index)
      tasks.push({
        id,
        text,
        sessionId: session.id,
        sessionTitle: session.summary.title,
        sessionStartMs: session.startMs,
        done: doneIds.has(id)
      })
    })
  }
  return tasks
}

/** Count of tasks still to do - the number the Day view header shows. */
export function openTaskCount(tasks: DayTask[]): number {
  return tasks.reduce((n, t) => (t.done ? n : n + 1), 0)
}
