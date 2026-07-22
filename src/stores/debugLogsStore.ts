import { create } from 'zustand';
import { sanitizeDiagnosticText } from '../utils/logSanitizer';

const MAX_IN_MEMORY = 500;

interface DebugLogEntry {
  timestamp: number;
  level: 'log' | 'warn' | 'error';
  message: string;
}

interface DebugLogsState {
  logs: DebugLogEntry[];
  addLog: (entry: DebugLogEntry) => void;
  clearLogs: () => void;
}

export const useDebugLogsStore = create<DebugLogsState>(set => ({
  logs: [],
  addLog: entry =>
    set(state => {
      const safeEntry = {
        ...entry,
        message: sanitizeDiagnosticText(entry.message),
      };
      return {
        logs:
          state.logs.length >= MAX_IN_MEMORY
            ? [...state.logs.slice(-(MAX_IN_MEMORY - 1)), safeEntry]
            : [...state.logs, safeEntry],
      };
    }),
  clearLogs: () => set({ logs: [] }),
}));
