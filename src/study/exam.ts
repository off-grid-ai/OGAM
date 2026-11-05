/** A timed practice exam: a fixed set of questions, no feedback until the end, then a score by topic. */
import { check, practiceSet, type Exercise, type Progress } from './exercises';

export interface Exam { ids: string[]; minutes: number; startedAt: number }
export interface ExamResult { correct: number; total: number; unanswered: number; percent: number; byTopic: Array<{ topic: string; correct: number; total: number }>; wrong: string[] }

/** Picks `count` questions across all topics (due and missed first) and starts the clock. */
export function buildExam(exercises: Exercise[], progress: Record<string, Progress>, opts: { count: number; minutes: number; now?: number }): Exam {
  const set = practiceSet(exercises, progress, { count: opts.count, now: opts.now });
  return { ids: set.map((e) => e.id), minutes: opts.minutes, startedAt: opts.now ?? Date.now() };
}

export const secondsLeft = (exam: Exam, now: number): number => Math.max(0, Math.round(exam.minutes * 60 - (now - exam.startedAt) / 1000));

/** Grades the answers given so far. A question left blank counts as wrong and as unanswered. */
export function gradeExam(exam: Exam, exercises: Record<string, Exercise>, answers: Record<string, unknown>): ExamResult {
  const topics = new Map<string, { correct: number; total: number }>();
  const wrong: string[] = [];
  let correct = 0; let unanswered = 0;
  for (const id of exam.ids) {
    const ex = exercises[id]; if (!ex) continue;
    const given = answers[id];
    const blank = given === undefined || given === '' || (Array.isArray(given) && given.length === 0);
    if (blank) unanswered++;
    const ok = !blank && check(ex, given).correct;
    if (ok) correct++; else wrong.push(id);
    const t = topics.get(ex.topic ?? 'General') ?? { correct: 0, total: 0 };
    topics.set(ex.topic ?? 'General', { correct: t.correct + (ok ? 1 : 0), total: t.total + 1 });
  }
  const total = exam.ids.length;
  return { correct, total, unanswered, percent: total ? Math.round((correct / total) * 100) : 0, byTopic: [...topics].map(([topic, v]) => ({ topic, ...v })).sort((a, b) => a.correct / a.total - b.correct / b.total), wrong };
}
