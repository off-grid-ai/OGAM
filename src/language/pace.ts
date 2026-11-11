/**
 * How long each kind of exercise takes, so every lesson lasts about the same time whatever
 * its games. Starts from typical times and then follows the learner's own pace: each answer
 * updates a running average for its kind.
 */
export type ExerciseKind =
  | 'choose' | 'meaning' | 'listen' | 'match' | 'build' | 'hear' | 'blank' | 'type' | 'dictation' | 'scramble' | 'truefalse' | 'speak';

/** A lesson aims for this long. */
export const LESSON_SECONDS = 5 * 60;

/** Typical seconds per exercise, before the learner's own pace is known. */
export const TYPICAL_SECONDS: Record<ExerciseKind, number> = {
  choose: 12, meaning: 12, truefalse: 12, listen: 15, blank: 18, scramble: 20,
  build: 30, hear: 30, speak: 20, type: 35, dictation: 35, match: 40,
};

export interface Pace { seconds: number; samples: number }

/** Seconds to plan for one exercise: the learner's average once there are 3 answers, else typical. */
export function secondsFor(kind: ExerciseKind, pace: Partial<Record<ExerciseKind, Pace>> = {}): number {
  const p = pace[kind];
  return p && p.samples >= 3 ? p.seconds : TYPICAL_SECONDS[kind];
}

/**
 * Adds one measured answer to the average (recent answers count more). Very long times are
 * capped so a break in the middle of a lesson does not skew it.
 */
export function updatePace(p: Pace | undefined, seconds: number): Pace {
  const s = Math.max(4, Math.min(120, seconds));
  if (!p) return { seconds: s, samples: 1 };
  const w = Math.min(0.3, 1 / (p.samples + 1));
  return { seconds: Math.round((p.seconds * (1 - w) + s * w) * 10) / 10, samples: p.samples + 1 };
}
