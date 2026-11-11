/**
 * What the on-device model is asked for each part of the course, and how its answers are
 * checked. Every request carries the teaching method and the learner's level (teaching.ts).
 */
import { parseJsonLoose, str } from '../study/games/json';
import type { Unit } from './curriculum';
import type { Item } from './lessons';
import { methodFor, storyParts, type LevelGuide } from './teaching';

type Msg = { id: string; role: 'system' | 'user'; content: string; timestamp: number };
const NON_LATIN = /^(ja|zh|ko|ar|hi|ru|uk|el|th|he)/;
export const needsRomanization = (code: string) => NON_LATIN.test(code);
const romanField = (code: string) => (needsRomanization(code) ? ', "r": pronunciation in Latin letters' : '');
const msgs = (system: string, user: string): Msg[] => [
  { id: 's', role: 'system', content: system, timestamp: 0 },
  { id: 'u', role: 'user', content: user, timestamp: 0 },
];

/** Vocabulary units: translate the unit's exact English items. */
export function vocabPrompt({ unit, language, level, code, extra = '' }: { unit: Unit; language: string; level: LevelGuide; code: string; extra?: string }): Msg[] {
  return msgs(
    `You are a careful ${language} teacher. ${methodFor(level, language)} Translate exactly, using the most common everyday wording.`,
    `Translate each English item into ${language}.${extra}\nReply with ONLY a JSON array, one object per item in the same order: {"en": English, "t": ${language} translation${romanField(code)}}.\n${unit.items.map((x, i) => `${i + 1}. ${x}`).join('\n')}`,
  );
}

/** Grammar and theme units: a short rule or context note and example sentences at the level. */
export function unitPrompt({ unit, language, level, code, known }: { unit: Unit; language: string; level: LevelGuide; code: string; known: string[] }): Msg[] {
  const kind = unit.kind === 'grammar' ? 'grammar point' : 'theme';
  return msgs(
    `You are an experienced ${language} teacher writing one lesson of a course. ${methodFor(level, language)}`,
    `Lesson ${kind}: ${unit.goal}.\nWrite ${level.items} different example sentences in ${language} that teach it, from easiest to hardest, each at most ${level.maxWords} words, each with its natural English meaning.${known.length ? `\nWords the learner knows (reuse some): ${known.slice(0, 60).join(', ')}.` : ''}\nAlso write a "tip": ${unit.kind === 'grammar' ? 'the rule in two or three plain English sentences with one short example' : 'two or three plain English sentences of useful context for this theme'}.\nReply with ONLY JSON: {"tip": "...", "items": [{"en": "English", "t": "${language}"${romanField(code)}}]}`,
  );
}

/** Vocabulary units: six everyday sentences that use the unit's words, so lessons are not the same few lines. */
export function sentencesPrompt({ language, level, code, words }: { language: string; level: LevelGuide; code: string; words: Item[] }): Msg[] {
  return msgs(
    `You are an experienced ${language} teacher. ${methodFor(level, language)}`,
    `Write ${SENTENCES} different, natural everyday sentences in ${language}, each at most ${level.maxWords} words, each using at least one of these words: ${words.map((w) => w.t).join(', ')}.\nVary them: questions, statements, a negative, different people (I, you, we, they).\nReply with ONLY JSON: {"items": [{"en": "English", "t": "${language}"${romanField(code)}}]}`,
  );
}

/** Example sentences per vocabulary unit. */
export const SENTENCES = 6;

/** Sentences written for a vocabulary unit: at least four usable ones, or null. */
export function parseSentences(raw: string, level: LevelGuide, code: string): Item[] | null {
  const items = parseItems(raw, level, code).filter((x) => x.t.split(/\s+/).length >= 3);
  return items.length >= 4 ? items.slice(0, SENTENCES) : null;
}

function parseItems(raw: string, level: LevelGuide, code: string): Item[] {
  const d = parseJsonLoose<any>(raw);
  const list: any[] = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : [];
  const items: Item[] = list.map((x) => {
    const r = needsRomanization(code) ? str(x?.r, 160) : '';
    return { en: str(x?.en, 200), t: str(x?.t, 200), ...(r ? { r } : {}) };
  }).filter((x) => x.en && x.t && x.en.toLowerCase() !== x.t.toLowerCase() && x.t.split(/\s+/).length <= level.maxWords * 1.5);
  return items.filter((x, i) => items.findIndex((y) => y.t === x.t) === i);
}

/** Checks a written lesson: enough items, translated (not copied), within the level's sentence length. */
export function parseUnitLesson(raw: string, level: LevelGuide, code: string): { items: Item[]; tip: string } | null {
  const d = parseJsonLoose<any>(raw);
  const unique = parseItems(raw, level, code);
  if (unique.length < Math.max(4, level.items - 3)) return null;
  return { items: unique.slice(0, level.items), tip: str(d?.tip, 600) };
}

/** Stories and podcasts at the learner's level, built around words they know. */
export function listeningPrompt(o: { kind: 'story' | 'podcast'; language: string; level: LevelGuide; topic: string; known: string[]; outline?: string }): Msg[] {
  const { kind, language, level, topic, known, outline } = o;
  const follow = outline ? `Tell this, in simple words for the learner's level, keeping what happens: ${outline}\n` : '';
  const shape = kind === 'story'
    ? '{"title": "...", "parts": [{"lines": [{"t": "two or three sentences in TARGET", "en": "English"}], "question": {"q": "a question in English about this part", "options": ["...", "...", "..."], "answer": 0}}], "vocab": [{"t": "word in TARGET", "en": "meaning"}]}'
    : '{"title": "...", "parts": [{"lines": [{"speaker": "Ana", "t": "one sentence in TARGET", "en": "English"}, {"speaker": "Leo", "t": "...", "en": "..."}], "question": {"q": "a question in English", "options": ["...", "...", "..."], "answer": 1}}], "vocab": [{"t": "word in TARGET", "en": "meaning"}]}';
  return msgs(
    `You write ${language} listening and reading practice. ${methodFor(level, language)}`,
    `Write a ${kind === 'story' ? 'short story' : 'short podcast conversation between two friends, Ana and Leo,'} in ${language}${topic.trim() ? ` about ${topic.trim()}` : ''}, in ${storyParts(level)} parts.\n${follow}${known.length ? `The learner knows these words; use them often: ${known.slice(0, 80).join(', ')}.\n` : ''}After each part ask one question that checks understanding. Then list up to 10 words from it that are NOT in the known list, with their English meaning.\nReply with ONLY JSON like this (TARGET = ${language}):\n${shape}`,
  );
}
