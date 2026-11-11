/**
 * What study mode makes and keeps: the saved results per project (guides, cards, quizzes, podcasts,
 * games) and their shapes. A leaf so the protected-project storage can seal and restore study
 * results without importing the whole study engine.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callHook, HOOKS } from '../bootstrap/hookRegistry';
import type { Crossword, LearningTerm, WordSearch } from './learningGames';

export interface Source { n: number; doc: string; part: number; text: string; origin?: 'project' | 'library' | 'web'; url?: string }
export interface Card { q: string; a: string; src: number[] }
export interface QuizItem { q: string; options: string[]; answer: number; why: string; src: number[] }
export interface PodcastLine { host: 'A' | 'B' | 'C'; text: string }
export interface Slide { title: string; bullets: string[]; narration: string; src: number[] }

export interface StudyResult {
  kind: 'guide' | 'formulas' | 'cards' | 'quiz' | 'podcast' | 'slides' | 'answer' | 'outline' | 'crossword' | 'wordsearch' | 'match' | 'game';
  createdAt: number;
  topic: string;
  title?: string;
  sources: Source[];
  text?: string;
  cards?: Card[];
  quiz?: QuizItem[];
  podcast?: PodcastLine[];
  /** Line numbers where the second and later stories of a news briefing start (for the chime between stories). */
  storyStarts?: number[];
  hosts?: number;
  slides?: Slide[];
  learningTerms?: LearningTerm[];
  crossword?: Crossword;
  wordSearch?: WordSearch;
  /** Daily briefing: the real headlines it was written from (outlet, link, time). */
  headlines?: { title: string; source?: string; url?: string; date?: number; interest?: string }[];
  /** Estimated listening time of a podcast script, in minutes. */
  minutes?: number;
  /** Project learning game payload (kind === 'game'), see src/study/games. */
  game?: { type: string; data: any };
}

interface StudyState {
  saved: Record<string, StudyResult[]>; // by project
  add: (projectId: string, r: StudyResult) => void;
  remove: (projectId: string, createdAt: number) => void;
  update: (projectId: string, createdAt: number, patch: Partial<StudyResult>) => void;
}
function withoutProtectedProjects(saved: Record<string, StudyResult[]>): Record<string, StudyResult[]> {
  const locked = new Set(callHook<string[]>(HOOKS.protectedProjectIds) ?? []);
  if (!locked.size) return saved;
  return Object.fromEntries(Object.entries(saved).filter(([pid]) => !locked.has(pid)));
}

export const useStudyStore = create<StudyState>()(
  persist(
    (set) => ({
      saved: {},
      // 150 items per project (games add many); the oldest beyond that are dropped.
      add: (pid, r) => set((s) => ({ saved: { ...s.saved, [pid]: [r, ...(s.saved[pid] || [])].slice(0, 150) } })),
      update: (pid, at, patch) => set((s) => ({ saved: { ...s.saved, [pid]: (s.saved[pid] || []).map((x) => (x.createdAt === at ? { ...x, ...patch } : x)) } })),
      remove: (pid, at) => set((s) => ({ saved: { ...s.saved, [pid]: (s.saved[pid] || []).filter((x) => x.createdAt !== at) } })),
    }),
    {
      name: 'atlas-study',
      storage: createJSONStorage(() => AsyncStorage),
      // A protected project's outputs live in its encrypted study vault, never in plain storage.
      partialize: (s) => ({ saved: withoutProtectedProjects(s.saved) }),
    },
  ),
);

