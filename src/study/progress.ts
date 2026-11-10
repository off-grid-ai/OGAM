/**
 * Spaced repetition (SM-2) for everything the project games teach, plus the
 * daily streak. Every game reports right/wrong answers here, so all games feed
 * the "Due today" review and the daily challenge.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Rating = 'again' | 'hard' | 'good' | 'easy';
export interface ProgressItem {
  key: string;
  projectId: string;
  prompt: string; // shown on the front (a clue or question)
  answer: string;
  src?: number[];
  ease: number;
  interval: number; // days
  reps: number;
  due: number; // ms timestamp
  correct: number;
  wrong: number;
}

const DAY = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** SM-2 step. Exported for tests. */
export function schedule(item: Pick<ProgressItem, 'ease' | 'interval' | 'reps'>, rating: Rating, now: number) {
  let { ease, interval, reps } = item;
  if (rating === 'again') {
    return { ease: Math.max(1.3, ease - 0.2), interval: 0, reps: 0, due: now + 60_000 };
  }
  const q = rating === 'hard' ? 3 : rating === 'good' ? 4 : 5;
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  reps += 1;
  if (reps === 1) interval = rating === 'easy' ? 3 : 1;
  else if (reps === 2) interval = rating === 'hard' ? 3 : 6;
  else interval = Math.max(1, Math.round(interval * (rating === 'hard' ? 1.2 : rating === 'easy' ? ease * 1.3 : ease)));
  return { ease, interval, reps, due: now + interval * DAY };
}

/** Preview text for a rating button ("<1 min", "3 days"). */
export function nextIntervalLabel(item: Pick<ProgressItem, 'ease' | 'interval' | 'reps'>, rating: Rating, now = Date.now()): string {
  const s = schedule(item, rating, now);
  return s.interval === 0 ? '<1 min' : s.interval === 1 ? '1 day' : `${s.interval} days`;
}

interface ProgressState {
  items: Record<string, ProgressItem>;
  /** Days (YYYY-MM-DD) with a finished daily challenge. */
  doneDays: string[];
  /** Streak freezes used, by ISO week. */
  freezes: string[];
  /** Record an answer from any game (right = good, wrong = again). */
  record: (projectId: string, card: StudyCard, correct: boolean) => void;
  rate: (key: string, rating: Rating) => void;
  /** Add an item to review if it is new (due now). Returns true when added. */
  seed: (projectId: string, card: StudyCard) => boolean;
  markDailyDone: () => void;
}

/** One thing to remember: what is asked, the answer, and the numbered sources it came from. */
export interface StudyCard { prompt: string; answer: string; src?: number[] }

export const itemKey = (projectId: string, answer: string, prompt: string) =>
  `${projectId}:${answer.trim().toLowerCase().slice(0, 60)}:${prompt.trim().toLowerCase().slice(0, 40)}`;

export const useStudyProgress = create<ProgressState>()(
  persist(
    (set, get) => ({
      items: {},
      doneDays: [],
      freezes: [],
      record: (projectId, card, correct) => {
        const { prompt, answer, src } = card;
        if (!prompt.trim() || !answer.trim()) return;
        const key = itemKey(projectId, answer, prompt);
        const now = Date.now();
        const prev = get().items[key] ?? { key, projectId, prompt, answer, src, ease: 2.5, interval: 0, reps: 0, due: now, correct: 0, wrong: 0 };
        const next = schedule(prev, correct ? 'good' : 'again', now);
        set((s) => ({ items: { ...s.items, [key]: { ...prev, ...next, src: src ?? prev.src, correct: prev.correct + (correct ? 1 : 0), wrong: prev.wrong + (correct ? 0 : 1) } } }));
      },
      rate: (key, rating) => {
        const prev = get().items[key];
        if (!prev) return;
        const next = schedule(prev, rating, Date.now());
        set((s) => ({ items: { ...s.items, [key]: { ...prev, ...next, correct: prev.correct + (rating === 'again' ? 0 : 1), wrong: prev.wrong + (rating === 'again' ? 1 : 0) } } }));
      },
      seed: (projectId, card) => {
        const { prompt, answer, src } = card;
        if (!prompt.trim() || !answer.trim()) return false;
        const key = itemKey(projectId, answer, prompt);
        if (get().items[key]) return false;
        const item: ProgressItem = { key, projectId, prompt, answer, src, ease: 2.5, interval: 0, reps: 0, due: Date.now(), correct: 0, wrong: 0 };
        set((s) => ({ items: { ...s.items, [key]: item } }));
        return true;
      },
      markDailyDone: () => {
        const today = dayKey(Date.now());
        set((s) => (s.doneDays.includes(today) ? s : { doneDays: [...s.doneDays, today].slice(-400) }));
      },
    }),
    {
      name: 'atlas-study-progress',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ items: s.items, doneDays: s.doneDays, freezes: s.freezes }),
    },
  ),
);

export function dueItems(projectId: string | null, now = Date.now(), limit = 50): ProgressItem[] {
  return Object.values(useStudyProgress.getState().items)
    .filter((i) => (!projectId || i.projectId === projectId) && i.due <= now)
    .sort((a, b) => a.due - b.due)
    .slice(0, limit);
}

/** Items answered wrong more often than right (weak spots). */
export function weakItems(projectId: string, limit = 20): ProgressItem[] {
  return Object.values(useStudyProgress.getState().items)
    .filter((i) => i.projectId === projectId && i.wrong > 0)
    .sort((a, b) => (b.wrong - b.correct) - (a.wrong - a.correct))
    .slice(0, limit);
}

/**
 * Current streak in days, allowing one missed day per ISO week (a "freeze").
 * Pure so it can be tested: pass the finished days.
 */
export function streakFrom(doneDays: string[], today = dayKey(Date.now())): number {
  const done = new Set(doneDays);
  let streak = 0;
  let freezesLeft = 1;
  let t = Date.parse(`${today}T12:00:00Z`);
  // Today not finished yet does not break the streak.
  if (!done.has(today)) t -= DAY;
  for (let guard = 0; guard < 400; guard++) {
    const key = dayKey(t);
    if (done.has(key)) { streak++; }
    else if (freezesLeft > 0 && streak > 0) { freezesLeft--; }
    else break;
    if (new Date(t).getUTCDay() === 1) freezesLeft = 1; // new week (Monday) refills the freeze
    t -= DAY;
  }
  return streak;
}
