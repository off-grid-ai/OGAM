import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlanExam } from './planner';

interface PlanState {
  exams: PlanExam[];
  /** Topics finished, across exams, so progress survives re-planning. */
  done: string[];
  setExams: (e: PlanExam[]) => void;
  toggleDone: (topic: string) => void;
}
export const usePlanStore = create<PlanState>()(persist((set) => ({
  exams: [], done: [],
  setExams: (exams) => set({ exams }),
  toggleDone: (topic) => set((s) => ({ done: s.done.includes(topic) ? s.done.filter((t) => t !== topic) : [...s.done, topic] })),
}), { name: 'atlas-study-plan', storage: createJSONStorage(() => AsyncStorage) }));

/** One exam per line: "REG | 2026-12-20 | Basis, Gains, Entities". Lines that do not fit are reported, not guessed. */
export function parseExamLines(text: string): { exams: PlanExam[]; errors: string[] } {
  const exams: PlanExam[] = []; const errors: string[] = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const [name, date, topics] = line.split('|').map((x) => x.trim());
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) { errors.push(`Line ${i + 1}: use  Name | YYYY-MM-DD | topic, topic`); return; }
    exams.push({ name, date, topics: (topics ?? '').split(',').map((t) => t.trim()).filter(Boolean) });
  });
  return { exams, errors };
}
