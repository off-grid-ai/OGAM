/**
 * The timeline's source of truth: every captured conversation, persisted so a day survives an app
 * restart. Capture writes sessions here; the timeline screen reads them. One store, both sides, so a
 * card and its transcript never disagree.
 *
 * Persisted with AsyncStorage like the app's other stores. This is the interim durable store for the
 * feature slice; a SQLite-backed implementation can replace it behind the same read/write surface
 * without the screen changing. Dedupe on session id so re-saving a capture is idempotent.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { TimelineSession } from '../services/ambient/timelineModel'
import type { ProactiveActionProposal } from '@offgrid/models'

interface AmbientTimelineState {
  sessions: TimelineSession[]
  /** Day-view tasks the user has checked off (day-task ids). */
  doneTaskIds: string[]
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
  addSessions: (sessions: TimelineSession[]) => void
  removeSession: (id: string) => void
  clearAll: () => void
  setOnDeviceOnly: (value: boolean) => void
  toggleTask: (id: string) => void
  setDayJournal: (dayKey: string, text: string) => void
  setDayActions: (dayKey: string, proposals: ProactiveActionProposal[]) => void
  resolveDayAction: (dayKey: string, index: number) => void
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

export const useAmbientTimelineStore = create<AmbientTimelineState>()(
  persist(
    set => ({
      sessions: [],
      doneTaskIds: [],
      journalByDay: {},
      actionsByDay: {},
      onDeviceOnly: false,
      addSessions: incoming => set(state => ({ sessions: mergeSessions(state.sessions, incoming) })),
      removeSession: id => set(state => ({ sessions: state.sessions.filter(s => s.id !== id) })),
      clearAll: () => set({ sessions: [], doneTaskIds: [], journalByDay: {}, actionsByDay: {} }),
      setOnDeviceOnly: value => set({ onDeviceOnly: value }),
      toggleTask: id => set(state => ({ doneTaskIds: toggleId(state.doneTaskIds, id) })),
      setDayJournal: (dayKey, text) =>
        set(state => ({ journalByDay: { ...state.journalByDay, [dayKey]: text } })),
      setDayActions: (dayKey, proposals) =>
        set(state => ({ actionsByDay: { ...state.actionsByDay, [dayKey]: proposals } })),
      resolveDayAction: (dayKey, index) =>
        set(state => ({
          actionsByDay: {
            ...state.actionsByDay,
            [dayKey]: (state.actionsByDay[dayKey] ?? []).filter((_, i) => i !== index)
          }
        }))
    }),
    {
      name: 'ambient-timeline',
      storage: createJSONStorage(() => AsyncStorage)
    }
  )
)
