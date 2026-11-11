/**
 * How Atlas teaches a language. This is the method the on-device model is given for every
 * lesson, story, podcast and practice chat, so the course behaves like a planned course and
 * not like random translation.
 *
 * Built on widely used, well-tested ideas:
 * - CEFR levels (Council of Europe): A1 beginner, A2 elementary, B1 intermediate, B2 upper
 *   intermediate, C1 advanced, C2 proficient, each described by what the learner CAN DO.
 * - Comprehensible input (Krashen's "i+1"): reading and listening should be about 95% known
 *   words, with a few new ones learned from context.
 * - Active recall and the testing effect: producing an answer (typing, ordering words) teaches
 *   more than recognising it, so lessons move from recognition to production.
 * - Spaced repetition (Leitner boxes): words you miss come back sooner, words you know come back
 *   later (see review.ts).
 * - Short daily sessions: about 5-10 minutes, so a streak is easy to keep.
 */

export type LevelId = 1 | 2 | 3 | 4 | 5 | 6;

export interface LevelGuide {
  id: LevelId;
  name: string;
  cefr: string;
  /** What a learner at this level can do (CEFR-style "can do" statement). */
  canDo: string;
  /** Longest sentence for this level, in words. */
  maxWords: number;
  /** Grammar the level may use; anything beyond it is avoided in its texts. */
  grammar: string;
  /** Exercises in one lesson (about 30-40 seconds each). */
  lessonLength: number;
  /** Items taught in one unit. */
  items: number;
  /** Share of a lesson that asks the learner to produce (type or build) rather than pick. */
  production: number;
}

export const LEVELS: LevelGuide[] = [
  { id: 1, name: 'Beginner', cefr: 'A1', canDo: 'greet people, introduce yourself, and understand and use basic phrases about yourself, family, food and numbers', maxWords: 5, grammar: 'present tense of to be, to have and the most common verbs, articles and gender, plurals, simple questions and negatives', lessonLength: 10, items: 8, production: 0.25 },
  { id: 2, name: 'Elementary', cefr: 'A2', canDo: 'use everyday expressions for shopping, directions, work, your day and simple plans', maxWords: 8, grammar: 'A1 grammar plus the simple past of common verbs, going to, can, possessives, there is, comparisons and frequency words', lessonLength: 11, items: 8, production: 0.35 },
  { id: 3, name: 'Intermediate', cefr: 'B1', canDo: 'handle familiar topics and travel, describe experiences and plans, give simple reasons and opinions', maxWords: 10, grammar: 'past and future tenses, past habits, reflexive verbs, comparisons, object pronouns, commands, common connectors (because, but, so)', lessonLength: 12, items: 10, production: 0.45 },
  { id: 4, name: 'Upper intermediate', cefr: 'B2', canDo: 'follow complex texts and news, explain a viewpoint, talk fluently and naturally with native speakers', maxWords: 16, grammar: 'all main tenses, conditional (would), if-sentences, subjunctive or its equivalent, passive voice, relative clauses, reported speech', lessonLength: 14, items: 10, production: 0.55 },
  { id: 5, name: 'Advanced', cefr: 'C1', canDo: 'use the language flexibly for social, academic and professional purposes, and understand long texts and implied meaning', maxWords: 20, grammar: 'everything, including idioms, register (formal and informal), emphasis and precise connectors', lessonLength: 14, items: 10, production: 0.6 },
  { id: 6, name: 'Proficient', cefr: 'C2', canDo: 'understand almost everything heard or read, and express yourself spontaneously, precisely and with fine shades of meaning', maxWords: 24, grammar: 'everything, including literary, archaic, regional and stylistic forms, wordplay and irony', lessonLength: 14, items: 10, production: 0.65 },
];

/** Levels saved before the course had six (1 Basic, 2 Intermediate, 3 Advanced, 4 Fluent), as CEFR levels. */
export const fromFourLevels = (old: number): LevelId => (([1, 3, 4, 5] as LevelId[])[old - 1] ?? 1);

export const levelGuide = (id: LevelId | number) => LEVELS.find((l) => l.id === id) ?? LEVELS[0];

/** The teaching method in a few lines, given to the model with every course request. */
export function methodFor(level: LevelGuide, language: string): string {
  return [
    `You teach ${language} to an English speaker at level ${level.id} (${level.name}, CEFR ${level.cefr}).`,
    `At this level the learner can ${level.canDo}.`,
    `Use only this grammar: ${level.grammar}. Keep sentences to at most ${level.maxWords} words.`,
    'Use natural, common, current everyday wording that a native speaker would really say. Prefer the standard, neutral form of the language.',
    'Teach new words and patterns in context, and reuse words the learner already knows (about 95% known words, a few new ones).',
  ].join(' ');
}

/** Parts in a story or podcast: longer pieces as the learner can follow more. */
export const storyParts = (level: LevelGuide) => (level.id <= 2 ? 4 : level.id === 3 ? 5 : 6);
