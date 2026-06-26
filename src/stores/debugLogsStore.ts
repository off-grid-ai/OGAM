import { create } from 'zustand';

const MAX_IN_MEMORY = 500;

export interface DebugLogEntry {
  timestamp: number;
  level: 'log' | 'warn' | 'error';
  message: string;
}

interface DebugLogsState {
  logs: DebugLogEntry[];
  addLog: (entry: DebugLogEntry) => void;
  clearLogs: () => void;
}

export const useDebugLogsStore = create<DebugLogsState>((set) => ({
  logs: [],
  addLog: (entry) => set((state) => ({
    logs: state.logs.length >= MAX_IN_MEMORY
      ? [...state.logs.slice(-(MAX_IN_MEMORY - 1)), entry]
      : [...state.logs, entry],
  })),
  clearLogs: () => set({ logs: [] }),
}));
