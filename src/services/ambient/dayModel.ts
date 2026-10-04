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

import { dayKeyOf, type TimelineSession } from './timelineModel'

export interface DayTask {
  /** Stable within a day: the conversation + the action's position in it. */
  id: string
  text: string
  sessionId: string
  sessionTitle: string
  /** One-line summary of the conversation this came from — shown when the task is expanded. */
  sessionHeadline?: string
  sessionStartMs: number
  done: boolean
  /** Set for a peer-authored standalone to-do (no local session): its origin tag, e.g. 'desktop'.
   *  Undefined for a recorder to-do. The Day UI uses it to route toggle + hide edit/delete. */
  standaloneSource?: string | null
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
  // Newest conversation first, matching the desktop Day — the most recent tasks sit at the top of the
  // list. Action items keep their in-conversation order within each session.
  const ordered = [...sessions].sort((a, b) => b.startMs - a.startMs)
  const tasks: DayTask[] = []
  for (const session of ordered) {
    session.summary.actionItems.forEach((text, index) => {
      const id = dayTaskId(session.id, index)
      tasks.push({
        id,
        text,
        sessionId: session.id,
        sessionTitle: session.summary.title,
        sessionHeadline: session.summary.headline,
        sessionStartMs: session.startMs,
        done: doneIds.has(id)
      })
    })
  }
  return tasks
}

/**
 * Peer-authored standalone to-dos (e.g. desktop CRM to-dos) as checkable tasks. They have no local
 * session, so they carry no title/start and sort by id for a stable order. The Day view shows these
 * above the day's recorder tasks (they belong to "now", not a recorded conversation).
 */
export function collectStandaloneTasks(
  standaloneTodos: Record<
    string,
    { text: string; done: boolean; source: string | null; detail?: string | null }
  >
): DayTask[] {
  // Newest first (higher crm:<id> = more recently created), matching the day's newest-first ordering.
  // The authoring device's provenance blurb (`detail`) rides in `sessionHeadline` so the same expand
  // path that cites a recorder session also cites a desktop to-do's origin.
  return Object.entries(standaloneTodos)
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([id, t]) => ({
      id,
      text: t.text,
      sessionId: '',
      sessionTitle: '',
      sessionHeadline: t.detail ?? undefined,
      sessionStartMs: 0,
      done: t.done,
      standaloneSource: t.source ?? 'peer'
    }))
}

/** Count of tasks still to do - the number the Day view header shows. */
export function openTaskCount(tasks: DayTask[]): number {
  return tasks.reduce((n, t) => (t.done ? n : n + 1), 0)
}


/** The sessions belonging to one day key ('YYYY-MM-DD'), newest first. Pure - date parts injected. */
export function sessionsForDay(
  sessions: TimelineSession[],
  dayKey: string,
  toParts: (ms: number) => { y: number; m: number; d: number }
): TimelineSession[] {
  return sessions
    .filter(s => dayKeyOf(s.startMs, toParts) === dayKey)
    .sort((a, b) => b.startMs - a.startMs)
}

/** The day keys that have any conversation, newest first - for day navigation. */
export function dayKeysWithSessions(
  sessions: TimelineSession[],
  toParts: (ms: number) => { y: number; m: number; d: number }
): string[] {
  const keys = new Set(sessions.map(s => dayKeyOf(s.startMs, toParts)))
  return [...keys].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
}
