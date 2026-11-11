import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Exercise, Item } from './lessons';
import type { Listening } from './listening';
import type { Memory } from './review';
import { fromFourLevels, type LevelId } from './teaching';
import type { ExerciseKind, Pace } from './pace';

export interface UnitProgress { stars: number; lessons: number }

/** A lesson left part-way, so it carries on where the learner stopped. */
export interface SavedLesson {
  key: string;
  exercises: Exercise[];
  index: number;
  right: number;
  results: { t: string; right: boolean }[];
  savedAt: number;
}

interface LanguageState {
  /** Language being learned (a phrase-card language code such as "es-ES"). */
  language: string;
  /** Words for each unit, per language: written once by the model, then kept. */
  content: Record<string, Record<string, Item[]>>;
  /** Stars per board space, per language (key: see board.ts). */
  progress: Record<string, Record<string, UnitProgress>>;
  xp: number;
  streak: { day: string; count: number };
  /** Stories and podcasts made so far, per language (newest first). */
  listening: Record<string, Listening[]>;
  /** New words the learner saved from stories and podcasts, practised in the "My words" unit. */
  myWords: Record<string, Item[]>;
  /** The level the learner is working at (1 Basic .. 4 Fluent). */
  level: LevelId;
  /** Grammar rules and theme notes the model wrote for units, per language. */
  tips: Record<string, Record<string, string>>;
  /** Spaced-repetition memory of each word, per language (key: the word in the language). */
  memory: Record<string, Record<string, Memory>>;
  /** How long the learner takes on each kind of exercise (sizes lessons to about 5 minutes). */
  pace: Partial<Record<ExerciseKind, Pace>>;
  /** Unfinished lessons, per language. */
  saved: Record<string, SavedLesson | undefined>;
  /** Right / wrong sounds in the games. */
  sounds: boolean;
  /** XP and lessons per day (day key "2026-10-20"), the last 90 days, for weekly progress. */
  history: Record<string, { xp: number; lessons: number }>;
  /** Daily XP goal, and the XP earned on the last day practised. */
  goal: number;
  today: { day: string; xp: number };
  /** Speaking exercises (when the phone has a speech recognizer). */
  speaking: boolean;
  /** Lines in the language are spoken slower (off by default). */
  slowVoice?: boolean;
  /** Show what the caller says on a practice call (on by default; off = listen first, tap a line to read it). */
  captions?: boolean;
  /** Word translations looked up by tapping a word, per language (lower-case word -> English). */
  glossary: Record<string, Record<string, string>>;
}

/**
 * Course state for screens to read. Only languageService writes it. It is kept on the phone
 * between launches and included in Atlas backups (atlasTools/backup), so progress survives a
 * reinstall or a move to a new phone.
 */
export const useLanguage = create<LanguageState>()(persist((): LanguageState => ({
  language: 'es-ES', content: {}, progress: {}, xp: 0, streak: { day: '', count: 0 }, listening: {}, myWords: {},
  level: 1, tips: {}, memory: {}, pace: {}, saved: {}, sounds: true, speaking: true, glossary: {}, goal: 100, today: { day: '', xp: 0 }, history: {},
}), {
  name: 'atlas-language', storage: createJSONStorage(() => AsyncStorage), version: 2,
  // Version 2: six CEFR levels instead of four.
  migrate: (state: any, version) => (version < 2 && state ? { ...state, level: fromFourLevels(state.level ?? 1) } : state),
}));

/** "Prepare this level" while it runs (not saved): how far it got, and what it is writing now. */
export interface PrepareLive { level: LevelId | null; done: number; total: number; step: string; error: string | null }
export const usePrepareLive = create<PrepareLive>(() => ({ level: null, done: 0, total: 0, step: '', error: null }));
