/**
 * The board for one level: every space is one sitting of about the same length. Each unit is
 * one lesson space, or two for harder topics (grammar, and themes from B2 up, or units
 * with many items), and every two lessons the player lands on a story, a podcast, a speed
 * round, a word search or a review. Each level ends with a checkpoint. Pure, so the board is tested without a device.
 */
import { unitsForLevel, type Unit } from './curriculum';
import type { Item } from './lessons';
import { levelGuide, type LevelId } from './teaching';

export type SpaceKind = 'lesson' | 'story' | 'podcast' | 'speed' | 'wordsearch' | 'review' | 'exam' | 'call' | 'crossword' | 'checkpoint';

export interface Space {
  /** Progress key: the unit id for a one-lesson unit, "unit:2" for a second part, "story@4" for a special space. */
  key: string;
  kind: SpaceKind;
  title: string;
  icon: string;
  unitId?: string;
  /** Lesson part (1-based) and how many parts the unit has. */
  part?: number;
  parts?: number;
}

/** Lessons between special spaces. */
export const SPECIAL_EVERY = 2;
/** Lessons between exams: a test of everything since the last one (70% to pass). */
export const EXAM_EVERY = 8;
/** Lessons between practice phone calls: the AI plays someone in the situation of the lesson before. */
export const CALL_EVERY = 6;
/** Lessons between crosswords: an optional puzzle with English clues and answers in the language (Skip moves on). */
export const CROSSWORD_EVERY = 5;
const SPECIALS: { kind: SpaceKind; title: string; icon: string }[] = [
  { kind: 'story', title: 'Story', icon: 'book-open' },
  { kind: 'podcast', title: 'Podcast', icon: 'headphones' },
  { kind: 'speed', title: 'Speed round', icon: 'zap' },
  { kind: 'wordsearch', title: 'Word search', icon: 'grid' },
  { kind: 'review', title: 'Review', icon: 'refresh-cw' },
];

/** Harder topics take two lessons so each sitting stays about the same length. */
export const partsFor = (u: Unit) =>
  (u.kind === 'grammar' || (u.kind === 'theme' && u.level >= 4) || u.items.length > 10 ? 2 : 1);

export const lessonKey = (unitId: string, part: number) => (part > 1 ? `${unitId}:${part}` : unitId);

export function boardFor(level: LevelId): Space[] {
  const out: Space[] = [];
  let lessons = 0;
  let special = 0;
  let exams = 0;
  let calls = 0;
  let crosswords = 0;
  for (const u of unitsForLevel(level)) {
    const parts = partsFor(u);
    for (let part = 1; part <= parts; part++) {
      out.push({ key: lessonKey(u.id, part), kind: 'lesson', title: parts > 1 ? `${u.title} ${part}/${parts}` : u.title, icon: u.icon, unitId: u.id, part, parts });
      lessons++;
      if (lessons % SPECIAL_EVERY === 0) {
        const s = SPECIALS[special++ % SPECIALS.length];
        // Numbered without the exams, calls and crosswords, so adding them did not change any saved square's key.
        out.push({ key: `${s.kind}@${level}.${out.length - exams - calls - crosswords}`, kind: s.kind, title: s.title, icon: s.icon });
      }
      if (lessons % EXAM_EVERY === 0) {
        exams++;
        out.push({ key: `exam@${level}.${exams}`, kind: 'exam', title: 'Exam', icon: 'clipboard' });
      }
      if (lessons % CALL_EVERY === 0) {
        calls++;
        out.push({ key: `call@${level}.${calls}`, kind: 'call', title: 'Phone call', icon: 'phone' });
      }
      if (lessons % CROSSWORD_EVERY === 0) {
        crosswords++;
        out.push({ key: `crossword@${level}.${crosswords}`, kind: 'crossword', title: 'Crossword', icon: 'layout' });
      }
    }
  }
  // An exam right before the checkpoint would test the same thing twice.
  if (out[out.length - 1]?.kind === 'exam') out.pop();
  // The level ends with a checkpoint: a longer test of the whole level (80% to pass).
  out.push({ key: `checkpoint@${level}`, kind: 'checkpoint', title: `${levelGuide(level).cefr} checkpoint`, icon: 'flag' });
  return out;
}

/** A unit's items for one part: the first part teaches the first half (the easier items, as written), the second the rest with a short recap. */
export function partItems(items: Item[], part: number, parts: number): Item[] {
  if (parts <= 1 || items.length < 6) return items;
  // Every sitting goes through all of the unit's example sentences; only the single words are shared out between sittings.
  const isSentence = (x: Item) => x.t.trim().split(/\s+/).length >= 3;
  const sentences = items.filter(isSentence);
  const single = items.filter((x) => !isSentence(x));
  if (single.length < 4) {
    const half = Math.ceil(items.length / 2);
    return part === 1 ? items.slice(0, half) : [...items.slice(half), ...items.slice(0, 2)];
  }
  const half = Math.ceil(single.length / 2);
  const mine = part === 1 ? single.slice(0, half) : [...single.slice(half), ...single.slice(0, 2)];
  return [...mine, ...sentences];
}

/** How many lessons are left before the next exam that is not done yet, counting the one you are on; null when none is ahead. */
export function lessonsUntilExam(spaces: Space[], current: number, done: (key: string) => boolean): number | null {
  const exam = spaces.findIndex((s, i) => i >= current && s.kind === 'exam' && !done(s.key));
  if (exam < 0) return null;
  const left = spaces.slice(current, exam).filter((s) => s.kind === 'lesson' && !done(s.key)).length;
  return left || null;
}

/** The first space of a level is open; after that a space opens when the one before it is done. */
export function spaceOpen(spaces: Space[], i: number, done: (key: string) => boolean): boolean {
  return i <= 0 || done(spaces[i - 1].key);
}

/** A unit is finished when all its lesson parts are done. */
export const unitDone = (u: Unit, done: (key: string) => boolean) =>
  Array.from({ length: partsFor(u) }, (_, i) => lessonKey(u.id, i + 1)).every(done);
