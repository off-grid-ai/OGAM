/**
 * Bridges the local ambient store to the sync payload. The store keeps its natural shape (a done-set, a
 * journal-by-day map, etc.); this turns that plus a stamp table into an AmbientSyncPayload for outbound,
 * and folds an inbound payload back into store shape + stamps. Pure - no store import - so it round-trips
 * in tests. The transport (Piece B) only moves the payload this produces/consumes.
 */

import type { TimelineSession } from './timelineModel'
import type { ProactiveActionProposal } from '@offgrid/models'
import {
  mergeAmbient,
  projectAmbient,
  type AmbientSyncPayload,
  type SyncStamp
} from './ambientSyncModel'

/** The slice of ambient store state that syncs (settings are excluded on purpose). */
export interface AmbientStateSlice {
  sessions: TimelineSession[]
  doneTaskIds: string[]
  journalByDay: Record<string, string>
  actionsByDay: Record<string, ProactiveActionProposal[]>
}

/** When each entity last changed locally, keyed the same way as the payload. */
export interface AmbientSyncStamps {
  sessions: Record<string, SyncStamp>
  done: Record<string, SyncStamp>
  journal: Record<string, SyncStamp>
  actions: Record<string, SyncStamp>
}

export function emptyStamps(): AmbientSyncStamps {
  return { sessions: {}, done: {}, journal: {}, actions: {} }
}

/** A stamp for a write happening now on this device. */
export function stampNow(localDeviceId: string, atMs: number): SyncStamp {
  return { at: atMs, by: localDeviceId }
}

/**
 * Store + stamps -> payload. Entities written before stamping existed get a deterministic fallback: a
 * session falls back to its own start time (its natural creation), everything else to epoch 0 so a real
 * remote edit always wins over un-stamped legacy state.
 */
export function buildPayload(
  state: AmbientStateSlice,
  stamps: AmbientSyncStamps,
  localDeviceId: string
): AmbientSyncPayload {
  const payload: AmbientSyncPayload = { sessions: {}, done: {}, journal: {}, actions: {} }

  for (const session of state.sessions) {
    payload.sessions[session.id] = {
      value: session,
      stamp: stamps.sessions[session.id] ?? { at: session.startMs, by: localDeviceId }
    }
  }

  const doneSet = new Set(state.doneTaskIds)
  const doneIds = new Set<string>([...Object.keys(stamps.done), ...state.doneTaskIds])
  for (const id of doneIds) {
    payload.done[id] = {
      value: doneSet.has(id),
      stamp: stamps.done[id] ?? { at: 0, by: localDeviceId }
    }
  }

  for (const [day, text] of Object.entries(state.journalByDay)) {
    payload.journal[day] = { value: text, stamp: stamps.journal[day] ?? { at: 0, by: localDeviceId } }
  }
  for (const [day, proposals] of Object.entries(state.actionsByDay)) {
    payload.actions[day] = { value: proposals, stamp: stamps.actions[day] ?? { at: 0, by: localDeviceId } }
  }

  return payload
}

/** Pull the stamp table back out of a (merged) payload, to persist alongside the projected state. */
export function stampsOf(payload: AmbientSyncPayload): AmbientSyncStamps {
  const out = emptyStamps()
  for (const [id, e] of Object.entries(payload.sessions)) out.sessions[id] = e.stamp
  for (const [id, e] of Object.entries(payload.done)) out.done[id] = e.stamp
  for (const [day, e] of Object.entries(payload.journal)) out.journal[day] = e.stamp
  for (const [day, e] of Object.entries(payload.actions)) out.actions[day] = e.stamp
  return out
}

export interface AppliedAmbient {
  state: AmbientStateSlice
  stamps: AmbientSyncStamps
}

/** Merge an inbound payload into local state; returns the new store slice + stamps to persist. */
export function applyRemote(
  state: AmbientStateSlice,
  stamps: AmbientSyncStamps,
  remote: AmbientSyncPayload,
  localDeviceId: string
): AppliedAmbient {
  const local = buildPayload(state, stamps, localDeviceId)
  const merged = mergeAmbient(local, remote)
  const projected = projectAmbient(merged)
  return {
    state: {
      sessions: projected.sessions,
      doneTaskIds: projected.doneTaskIds,
      journalByDay: projected.journalByDay,
      actionsByDay: projected.actionsByDay
    },
    stamps: stampsOf(merged)
  }
}
