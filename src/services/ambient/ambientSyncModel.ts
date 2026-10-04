/**
 * Two-way reconciliation for the ambient Day across devices. The phone and desktop each hold the same
 * shape; sync ships a versioned payload and both sides converge with last-writer-wins per entity.
 *
 * Why a stamp per entity, not one per store: a to-do checked on desktop must beat a stale phone copy
 * of THAT to-do without clobbering an unrelated journal edit. Ties (same ms) break on device id so two
 * devices always pick the same winner. Sessions are create-once conversations, merged by id.
 *
 * PURE + transport-free: this decides WHAT the merged Day is. The sync adapter owns moving bytes.
 */

import type { TimelineSession } from './timelineModel'
import type { ProactiveActionProposal } from '@offgrid/models'

/** When a value last changed, and on which device (tie-breaker). */
export interface SyncStamp {
  at: number
  by: string
}

interface Stamped<T> {
  value: T
  stamp: SyncStamp
}

/** The over-the-wire shape of one device's ambient Day. Everything the two sides reconcile. */
export interface AmbientSyncPayload {
  /** Recorded conversations, keyed by session id. */
  sessions: Record<string, Stamped<TimelineSession>>
  /** Day-task done state, keyed by dayTaskId (`sessionId#index`). */
  done: Record<string, Stamped<boolean>>
  /** Generated journal narrative, keyed by day key (`YYYY-MM-DD`). */
  journal: Record<string, Stamped<string>>
  /** Proposed actions per day key. The whole day's list is versioned as one unit. */
  actions: Record<string, Stamped<ProactiveActionProposal[]>>
}

/** True when `a` should win over `b`: newer wall-clock, ties broken by higher device id. */
export function isNewer(a: SyncStamp, b: SyncStamp): boolean {
  if (a.at !== b.at) return a.at > b.at
  return a.by > b.by
}

function mergeMap<T>(
  a: Record<string, Stamped<T>>,
  b: Record<string, Stamped<T>>
): Record<string, Stamped<T>> {
  const out: Record<string, Stamped<T>> = { ...a }
  for (const key of Object.keys(b)) {
    const incoming = b[key]
    const current = out[key]
    if (!current || isNewer(incoming.stamp, current.stamp)) out[key] = incoming
  }
  return out
}

/** Converge two payloads. Commutative + idempotent, so it converges no matter the order sync applies. */
export function mergeAmbient(a: AmbientSyncPayload, b: AmbientSyncPayload): AmbientSyncPayload {
  return {
    sessions: mergeMap(a.sessions, b.sessions),
    done: mergeMap(a.done, b.done),
    journal: mergeMap(a.journal, b.journal),
    actions: mergeMap(a.actions, b.actions)
  }
}

/** The store-facing projection of a payload: exactly what AmbientTimelineState persists. */
export interface AmbientProjection {
  sessions: TimelineSession[]
  doneTaskIds: string[]
  journalByDay: Record<string, string>
  actionsByDay: Record<string, ProactiveActionProposal[]>
}

/** Flatten a merged payload into the store shape. Sessions come out newest-first by start time. */
export function projectAmbient(payload: AmbientSyncPayload): AmbientProjection {
  const sessions = Object.values(payload.sessions)
    .map(e => e.value)
    .sort((x, y) => y.startMs - x.startMs)
  const doneTaskIds = Object.entries(payload.done)
    .filter(([, v]) => v.value)
    .map(([id]) => id)
  const journalByDay: Record<string, string> = {}
  for (const [day, e] of Object.entries(payload.journal)) journalByDay[day] = e.value
  const actionsByDay: Record<string, ProactiveActionProposal[]> = {}
  for (const [day, e] of Object.entries(payload.actions)) actionsByDay[day] = e.value
  return { sessions, doneTaskIds, journalByDay, actionsByDay }
}

/** An empty payload — the starting point before any local state is stamped. */
export function emptyAmbientPayload(): AmbientSyncPayload {
  return { sessions: {}, done: {}, journal: {}, actions: {} }
}
