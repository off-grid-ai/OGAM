import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { localUniqueId } from '../utils/uniqueId';
import type { Repeat } from './due';

export type TaskKind = 'prompt' | 'briefing';

export interface ScheduledTask {
  id: string;
  name: string;
  kind: TaskKind;
  /** What the AI is asked (a prompt task). Starting with /skill-name uses that skill. */
  prompt: string;
  repeat: Repeat;
  hour: number;
  minute: number;
  weekday?: number;
  onceAt?: number;
  enabled: boolean;
  createdAt: number;
  /** The time it last finished for (a scheduled time, not "now"), so it runs once per scheduled time. */
  lastRunAt?: number;
  /** The last attempt, so a failed run is tried again later, not in a loop. */
  lastTriedAt?: number;
  lastError?: string;
  /** The chat holding the last result, and whether the person has opened it. */
  lastChatId?: string;
  resultSeen?: boolean;
}

interface ScheduleState {
  tasks: ScheduledTask[];
  add: (t: Omit<ScheduledTask, 'id' | 'createdAt' | 'enabled'>) => string;
  update: (id: string, patch: Partial<ScheduledTask>) => void;
  remove: (id: string) => void;
}

export const useSchedule = create<ScheduleState>()(persist((set) => ({
  tasks: [],
  add: (t) => {
    const id = localUniqueId('task');
    set((s) => ({ tasks: [...s.tasks, { ...t, id, enabled: true, createdAt: Date.now() }].slice(-30) }));
    return id;
  },
  update: (id, patch) => set((s) => ({ tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  remove: (id) => set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) })),
}), { name: 'atlas-schedule', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ tasks: s.tasks }) }));
