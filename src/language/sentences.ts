/**
 * Example sentences for vocabulary units: six everyday sentences that use the unit's words,
 * so a lesson is not the same few lines every time.
 */
import { PHRASE_LANGUAGES } from '../phrases/data';
import { unitById } from './curriculum';
import { SENTENCES, parseSentences, sentencesPrompt } from './coursePrompts';
import type { Item } from './lessons';
import { useLanguage } from './store';
import { levelGuide, type LevelGuide } from './teaching';

const langName = (code: string) => PHRASE_LANGUAGES.find((l) => l.code === code)?.name ?? code;

const sentenceCount = (items: Item[]) => items.filter((x) => x.t.trim().split(/\s+/).length >= 3).length;

/** Six everyday sentences using a vocabulary unit's words (none if the model cannot write them). */
export async function writeSentences(llm: any, o: { words: Item[]; level: LevelGuide; name: string; code: string }): Promise<Item[]> {
  try {
    const raw = await llm.generateResponse(sentencesPrompt({ language: o.name, level: o.level, code: o.code, words: o.words }), { disableThinking: true });
    const have = new Set(o.words.map((w) => w.t));
    return (parseSentences(raw, o.level, o.code) ?? []).filter((x) => !have.has(x.t));
  } catch { return []; }
}

/**
 * A vocabulary unit written before it had example sentences gets them the next time it is
 * opened, if the model is already loaded (never a wait for a model load just for this).
 */
const toppedUp = new Set<string>();
export async function topUpSentences(unitId: string, kept: Item[], onStep: (m: string) => void): Promise<Item[]> {
  const code = useLanguage.getState().language;
  if (sentenceCount(kept) >= SENTENCES || toppedUp.has(`${code}:${unitId}`)) return kept;
  const { llmService } = require('../services/llm');
  if (!llmService.isModelLoaded?.() || llmService.isCurrentlyGenerating?.()) return kept;
  toppedUp.add(`${code}:${unitId}`);
  const unit = unitById(unitId)!;
  onStep('Adding example sentences...');
  const more = await writeSentences(llmService, { words: kept, level: levelGuide(unit.level), name: langName(code), code });
  if (!more.length) return kept;
  const items = [...kept, ...more];
  useLanguage.setState((s) => ({ content: { ...s.content, [code]: { ...s.content[code], [unitId]: items } } }));
  return items;
}
