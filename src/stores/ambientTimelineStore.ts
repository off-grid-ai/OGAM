/**
 * The timeline's source of truth: every captured conversation, persisted so a day survives an app
 * restart. Capture writes sessions here; the timeline screen reads them. One store, both sides, so a
 * card and its transcript never disagree.
 *
 * Persisted with AsyncStorage like the app's other stores. This is the interim durable store for the
 * feature slice; a SQLite-backed implementation can replace it behind the same read/write surface
 * without the screen changing. Dedupe on session id so re-saving a capture is idempotent.
 */

import { Platform } from 'react-native'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { TimelineSession, SessionRelevance } from '../services/ambient/timelineModel'
import type { ProactiveActionProposal } from '@offgrid/models'
import type { ProcessingMode, CaptureMode, PendingCapture } from '../services/ambient/processingModel'
import { DEFAULT_PROCESSING_MODE, DEFAULT_CAPTURE_MODE } from '../services/ambient/processingModel'
import { DEFAULT_RETENTION_DAYS } from '../services/ambient/retentionModel'
import { DEFAULT_PROCESSING_MINUTE_OF_DAY } from '../services/ambient/scheduleModel'
import type { AmbientSyncPayload } from '../services/ambient/ambientSyncModel'
import {
  buildPayload,
  applyRemote,
  emptyStamps,
  type AmbientSyncStamps
} from '../services/ambient/ambientSyncBridge'
import { useSyncIdentityStore } from './syncIdentityStore'
import type { AmbientWireState } from '@offgrid/sync'

/** A to-do synced FROM a peer that carries its own text and has no local recorder session — e.g. a
 *  desktop CRM to-do (id `crm:<n>`, source 'desktop'). Keyed by its sync id. The phone displays these
 *  alongside its own recorder to-dos and can toggle them (write-back). */
export interface StandaloneTodo {
  text: string
  done: boolean
  source: string | null
  /** Optional provenance blurb from the authoring device (e.g. a desktop CRM to-do's source), shown
   *  when the to-do is expanded on this device. */
  detail?: string | null
}

interface AmbientTimelineState {
  sessions: TimelineSession[]
  /** Day-view tasks the user has checked off (day-task ids). */
  doneTaskIds: string[]
  /** Peer-authored, text-bearing to-dos (no local session), keyed by sync id. */
  standaloneTodos: Record<string, StandaloneTodo>
  /** The generated journal narrative per day key ('YYYY-MM-DD'), cached so it is written once. */
  journalByDay: Record<string, string>
  /** Proposed actions per day, cached; resolving one (approve/dismiss) removes it. */
  actionsByDay: Record<string, ProactiveActionProposal[]>
  /**
   * Keep the recorder's summaries + ask-your-day on-device even when a remote chat model is selected,
   * so an always-on recorder never sends transcripts to a server. Off by default (follows the active
   * model); on forces the local engine.
   */
  onDeviceOnly: boolean
  /** Offload transcription to a paired, reachable Mac (falls back to on-device). Ignored when
   *  onDeviceOnly is on - that forces everything local. */
  useMacForTranscription: boolean
  /** Live = process on stop; nightly = queue for a later pass. */
  processingMode: ProcessingMode
  /** Session (one-tap) vs always-on (passive continuous). */
  captureMode: CaptureMode
  /** Whether the recorder's first-run setup is done. */
  onboardingComplete: boolean
  /** Captures waiting to be processed (nightly mode). */
  pendingCaptures: PendingCapture[]
  /** Local minute-of-day the deferred queue should drain (nightly mode). */
  processingMinuteOfDay: number
  /** When the scheduled drain last ran, so it fires once per day and catches up on open. */
  lastScheduledProcessAt: number | null
  /** How many days of raw capture audio to keep (for Replay). */
  audioRetentionDays: number
  /** Per-entity change stamps, for cross-device last-writer-wins. Not user-facing. */
  syncStamps: AmbientSyncStamps
  addSessions: (sessions: TimelineSession[]) => void
  removeSession: (id: string) => void
  clearAll: () => void
  setOnDeviceOnly: (value: boolean) => void
  setUseMacForTranscription: (value: boolean) => void
  toggleTask: (id: string) => void
  /** Tick / untick a peer-authored standalone to-do; writes back as an ambient_todo op (keeps text). */
  toggleStandaloneTodo: (id: string) => void
  /** Correct an extracted to-do's text (edits the source conversation's action item). */
  editTaskText: (sessionId: string, index: number, text: string) => void
  /** Delete an extracted to-do (removes it from the source conversation's action items). */
  deleteTask: (sessionId: string, index: number) => void
  /** Label a segment with an identified/assigned speaker (voice fingerprinting). */
  setSegmentSpeaker: (sessionId: string, segmentId: string, speakerId: string | null, speakerName: string | null) => void
  /** Relabel every segment currently under one speaker/cluster id at once (assign a whole speaker). */
  relabelSpeaker: (sessionId: string, fromSpeakerId: string | null, toSpeakerId: string | null, toName: string | null) => void
  /** Record the relevance verdict for a conversation (owner-in vs ambient/overheard). */
  setSessionRelevance: (sessionId: string, relevance: SessionRelevance) => void
  /**
   * Include or exclude a conversation from the Day (the user's manual select/deselect). `override` of
   * true/false pins it; null clears the override (follow relevance again). Clears that day's stitched
   * journal + actions cache so they regenerate over the new included set — the to-do list is a pure
   * projection and updates on its own.
   */
  setSessionInclusion: (sessionId: string, override: boolean | null, dayKey?: string) => void
  setDayJournal: (dayKey: string, text: string) => void
  setDayActions: (dayKey: string, proposals: ProactiveActionProposal[]) => void
  resolveDayAction: (dayKey: string, index: number) => void
  setProcessingMode: (mode: ProcessingMode) => void
  addPendingCapture: (capture: PendingCapture) => void
  clearPendingCaptures: () => void
  setProcessingMinuteOfDay: (minuteOfDay: number) => void
  markScheduledProcess: (atMs: number) => void
  setAudioRetentionDays: (days: number) => void
  setCaptureMode: (mode: CaptureMode) => void
  setOnboardingComplete: (done: boolean) => void
  /** Serialize the synced slice for the sync adapter to push. */
  toSyncPayload: () => AmbientSyncPayload
  /** Merge an inbound payload from another device into local state. */
  applySyncPayload: (remote: AmbientSyncPayload) => void
  // ── native sync-entity materialization (inbound; no re-stamp) ──
  applySessionSynced: (session: TimelineSession) => void
  removeSessionSynced: (id: string) => void
  applyTodoSynced: (dayTaskId: string, done: boolean) => void
  /** Inbound: a peer's standalone (text-bearing) to-do landed — store it so the Day can render it. */
  applyStandaloneTodoSynced: (id: string, todo: StandaloneTodo) => void
  removeTodoSynced: (dayTaskId: string) => void
  applyJournalSynced: (dayKey: string, text: string) => void
  removeJournalSynced: (dayKey: string) => void
  applyActionsSynced: (dayKey: string, proposals: ProactiveActionProposal[]) => void
  removeActionsSynced: (dayKey: string) => void
  /** The synced Day projected to the wire shape, for the sync adapter to diff + publish. */
  toAmbientWireState: () => AmbientWireState
}

/** Merge new sessions into existing, keeping one record per id (last write wins). Pure, exported for test. */
export function mergeSessions(
  existing: TimelineSession[],
  incoming: TimelineSession[]
): TimelineSession[] {
  const byId = new Map(existing.map(s => [s.id, s]))
  for (const session of incoming) byId.set(session.id, session)
  return [...byId.values()]
}

/** Add id if absent, remove it if present. Pure, exported for test. */
export function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}

/**
 * Done-task ids are `${sessionId}#${index}` into a conversation's action list. When one action item is
 * deleted, every later index shifts down by one — so drop the deleted id and renumber the ones after it,
 * leaving other sessions' ids untouched. Keeps checked state aligned with the trimmed list.
 */
export function remapDoneAfterDelete(ids: string[], sessionId: string, index: number): string[] {
  const prefix = `${sessionId}#`
  const out: string[] = []
  for (const id of ids) {
    if (!id.startsWith(prefix)) {
      out.push(id)
      continue
    }
    const i = Number(id.slice(prefix.length))
    if (!Number.isInteger(i) || i === index) continue // drop the deleted one (and any malformed id)
    out.push(i > index ? `${prefix}${i - 1}` : id)
  }
  return out
}

/** This device's sync identity for stamping writes; 'local' until pairing establishes one. */
const localStampId = (): string => useSyncIdentityStore.getState().localDeviceId ?? 'local'

/**
 * Standalone to-dos THIS device actually toggled — so the wire state re-emits only our own edits, never
 * a mere echo of a to-do we received from the authoring device (e.g. a desktop CRM to-do). Without this,
 * every received standalone to-do would be re-put with a fresh Lamport, making this device wrongly "win"
 * last-writer over the author and, in a race, revert the author's change. Module-scoped (not persisted):
 * after a restart nothing is pending re-emit, which is correct — any toggle was already synced.
 */
const locallyToggledStandalone = new Set<string>()

export const useAmbientTimelineStore = create<AmbientTimelineState>()(
  persist(
    (set, get) => ({
      sessions: [],
      doneTaskIds: [],
      standaloneTodos: {},
      journalByDay: {},
      actionsByDay: {},
      onDeviceOnly: false,
      // Offload to a paired Mac by default; falls back to on-device when no Mac is reachable.
      useMacForTranscription: true,
      processingMode: DEFAULT_PROCESSING_MODE,
      // Preset per device so first run needs no setup: iPhone one-tap, Android always-on.
      captureMode: Platform.OS === 'android' ? 'always-on' : DEFAULT_CAPTURE_MODE,
      onboardingComplete: true,
      pendingCaptures: [],
      processingMinuteOfDay: DEFAULT_PROCESSING_MINUTE_OF_DAY,
      lastScheduledProcessAt: null,
      audioRetentionDays: DEFAULT_RETENTION_DAYS,
      syncStamps: emptyStamps(),
      addSessions: incoming =>
        set(state => {
          const stamp = { at: Date.now(), by: localStampId() }
          const sessions = { ...state.syncStamps.sessions }
          for (const s of incoming) sessions[s.id] = stamp
          return {
            sessions: mergeSessions(state.sessions, incoming),
            syncStamps: { ...state.syncStamps, sessions }
          }
        }),
      removeSession: id => set(state => ({ sessions: state.sessions.filter(s => s.id !== id) })),
      clearAll: () =>
        set({ sessions: [], doneTaskIds: [], standaloneTodos: {}, journalByDay: {}, actionsByDay: {} }),
      setOnDeviceOnly: value => set({ onDeviceOnly: value }),
      setUseMacForTranscription: value => set({ useMacForTranscription: value }),
      toggleTask: id =>
        set(state => ({
          doneTaskIds: toggleId(state.doneTaskIds, id),
          syncStamps: {
            ...state.syncStamps,
            done: { ...state.syncStamps.done, [id]: { at: Date.now(), by: localStampId() } }
          }
        })),
      toggleStandaloneTodo: id =>
        set(state => {
          const cur = state.standaloneTodos[id]
          if (!cur) return {}
          // Mark as locally edited so the wire state will carry this toggle back to the author; then flip
          // done in place, keeping text/source/detail (a sessionless to-do has no session to rebuild from).
          locallyToggledStandalone.add(id)
          return { standaloneTodos: { ...state.standaloneTodos, [id]: { ...cur, done: !cur.done } } }
        }),
      editTaskText: (sessionId, index, text) =>
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id !== sessionId
              ? s
              : {
                  ...s,
                  summary: {
                    ...s.summary,
                    actionItems: s.summary.actionItems.map((t, i) => (i === index ? text : t))
                  }
                }
          ),
          // Bump the session's sync stamp so the edit wins last-writer and propagates to paired devices
          // (otherwise a re-sync from the Mac would overwrite it).
          syncStamps: {
            ...state.syncStamps,
            sessions: { ...state.syncStamps.sessions, [sessionId]: { at: Date.now(), by: localStampId() } }
          }
        })),
      deleteTask: (sessionId, index) =>
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id !== sessionId
              ? s
              : {
                  ...s,
                  summary: {
                    ...s.summary,
                    actionItems: s.summary.actionItems.filter((_, i) => i !== index)
                  }
                }
          ),
          // Action-item indices shift after a delete; remap the done-task ids so done state follows.
          doneTaskIds: remapDoneAfterDelete(state.doneTaskIds, sessionId, index),
          // Stamp the session so the deletion syncs (and isn't reverted by the Mac's copy).
          syncStamps: {
            ...state.syncStamps,
            sessions: { ...state.syncStamps.sessions, [sessionId]: { at: Date.now(), by: localStampId() } }
          }
        })),
      setSegmentSpeaker: (sessionId, segmentId, speakerId, speakerName) =>
        set(state => ({
          sessions: state.sessions.map(session =>
            session.id !== sessionId
              ? session
              : {
                  ...session,
                  segments: session.segments.map(seg =>
                    seg.id !== segmentId ? seg : { ...seg, speakerId, speakerName }
                  )
                }
          )
        })),
      relabelSpeaker: (sessionId, fromSpeakerId, toSpeakerId, toName) =>
        set(state => ({
          sessions: state.sessions.map(session =>
            session.id !== sessionId
              ? session
              : {
                  ...session,
                  segments: session.segments.map(seg =>
                    (seg.speakerId ?? null) === fromSpeakerId
                      ? { ...seg, speakerId: toSpeakerId, speakerName: toName }
                      : seg
                  )
                }
          )
        })),
      setSessionRelevance: (sessionId, relevance) =>
        set(state => ({
          sessions: state.sessions.map(session =>
            session.id !== sessionId ? session : { ...session, relevance }
          )
        })),
      setSessionInclusion: (sessionId, override, dayKey) =>
        set(state => {
          const journalByDay = { ...state.journalByDay }
          const actionsByDay = { ...state.actionsByDay }
          // Drop the day's aggregate artifacts so they re-generate over the new included set.
          if (dayKey) {
            delete journalByDay[dayKey]
            delete actionsByDay[dayKey]
          }
          return {
            journalByDay,
            actionsByDay,
            sessions: state.sessions.map(session =>
              session.id !== sessionId
                ? session
                : { ...session, userOverride: override === null ? undefined : override }
            )
          }
        }),
      setDayJournal: (dayKey, text) =>
        set(state => ({
          journalByDay: { ...state.journalByDay, [dayKey]: text },
          syncStamps: {
            ...state.syncStamps,
            journal: { ...state.syncStamps.journal, [dayKey]: { at: Date.now(), by: localStampId() } }
          }
        })),
      setDayActions: (dayKey, proposals) =>
        set(state => ({
          actionsByDay: { ...state.actionsByDay, [dayKey]: proposals },
          syncStamps: {
            ...state.syncStamps,
            actions: { ...state.syncStamps.actions, [dayKey]: { at: Date.now(), by: localStampId() } }
          }
        })),
      resolveDayAction: (dayKey, index) =>
        set(state => ({
          actionsByDay: {
            ...state.actionsByDay,
            [dayKey]: (state.actionsByDay[dayKey] ?? []).filter((_, i) => i !== index)
          },
          syncStamps: {
            ...state.syncStamps,
            actions: { ...state.syncStamps.actions, [dayKey]: { at: Date.now(), by: localStampId() } }
          }
        })),
      setProcessingMode: mode => set({ processingMode: mode }),
      addPendingCapture: capture =>
        set(state => ({ pendingCaptures: [...state.pendingCaptures, capture] })),
      clearPendingCaptures: () => set({ pendingCaptures: [] }),
      setProcessingMinuteOfDay: minuteOfDay => set({ processingMinuteOfDay: minuteOfDay }),
      markScheduledProcess: atMs => set({ lastScheduledProcessAt: atMs }),
      setAudioRetentionDays: days => set({ audioRetentionDays: days }),
      setCaptureMode: mode => set({ captureMode: mode }),
      setOnboardingComplete: done => set({ onboardingComplete: done }),
      toSyncPayload: () => {
        const s = get()
        return buildPayload(
          { sessions: s.sessions, doneTaskIds: s.doneTaskIds, journalByDay: s.journalByDay, actionsByDay: s.actionsByDay },
          s.syncStamps,
          localStampId()
        )
      },
      applySyncPayload: remote =>
        set(state => {
          const applied = applyRemote(
            { sessions: state.sessions, doneTaskIds: state.doneTaskIds, journalByDay: state.journalByDay, actionsByDay: state.actionsByDay },
            state.syncStamps,
            remote,
            localStampId()
          )
          return { ...applied.state, syncStamps: applied.stamps }
        })
      ,
      applySessionSynced: session =>
        set(state => ({ sessions: mergeSessions(state.sessions, [session]) })),
      removeSessionSynced: id =>
        set(state => ({ sessions: state.sessions.filter(s => s.id !== id) })),
      applyTodoSynced: (dayTaskId, done) =>
        set(state => ({
          doneTaskIds: done
            ? Array.from(new Set([...state.doneTaskIds, dayTaskId]))
            : state.doneTaskIds.filter(x => x !== dayTaskId)
        })),
      applyStandaloneTodoSynced: (id, todo) =>
        set(state => ({ standaloneTodos: { ...state.standaloneTodos, [id]: todo } })),
      removeTodoSynced: dayTaskId =>
        set(state => {
          const standaloneTodos = { ...state.standaloneTodos }
          delete standaloneTodos[dayTaskId]
          locallyToggledStandalone.delete(dayTaskId)
          return {
            doneTaskIds: state.doneTaskIds.filter(x => x !== dayTaskId),
            standaloneTodos
          }
        }),
      applyJournalSynced: (dayKey, text) =>
        set(state => ({ journalByDay: { ...state.journalByDay, [dayKey]: text } })),
      removeJournalSynced: dayKey =>
        set(state => {
          const journalByDay = { ...state.journalByDay }
          delete journalByDay[dayKey]
          return { journalByDay }
        }),
      applyActionsSynced: (dayKey, proposals) =>
        set(state => ({ actionsByDay: { ...state.actionsByDay, [dayKey]: proposals } })),
      removeActionsSynced: dayKey =>
        set(state => {
          const actionsByDay = { ...state.actionsByDay }
          delete actionsByDay[dayKey]
          return { actionsByDay }
        }),
      toAmbientWireState: () => {
        const s = get()
        const sessions: Record<string, string> = {}
        for (const sess of s.sessions) sessions[sess.id] = JSON.stringify(sess)
        const todos: AmbientWireState['todos'] = {}
        for (const id of s.doneTaskIds) {
          const hash = id.lastIndexOf('#')
          todos[id] = { sessionId: hash > 0 ? id.slice(0, hash) : id, done: true }
        }
        // Standalone (peer-authored) to-dos ride the wire with their own text + source + detail. Only emit
        // the ones THIS device toggled — never a plain echo of a received to-do, which would re-stamp a
        // fresh Lamport and let this device wrongly override the author. A locally-toggled one emits its
        // done either way (unlike recorder to-dos, which only appear here when done).
        for (const [id, t] of Object.entries(s.standaloneTodos)) {
          if (!locallyToggledStandalone.has(id)) continue
          todos[id] = {
            sessionId: '',
            done: t.done,
            text: t.text,
            source: t.source ?? undefined,
            detail: t.detail ?? undefined
          }
        }
        const journal = { ...s.journalByDay }
        const actions: Record<string, string> = {}
        for (const [day, list] of Object.entries(s.actionsByDay)) actions[day] = JSON.stringify(list)
        return { sessions, todos, journal, actions }
      }
    }),
    {
      name: 'ambient-timeline',
      storage: createJSONStorage(() => AsyncStorage)
    }
  )
)
