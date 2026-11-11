/** Verbs in the word bubble: finding the infinitive of a tapped word, and its conjugation table. */
import { useLanguage } from './store';
import { conjugateSpanish, PERSONS } from './conjugation';

const plain = (w: string) => w.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * The infinitive of a tapped word when it is a verb, from its meaning ("to speak", or
 * "I speak (hablar: to speak)"); null for other words. A reflexive infinitive (levantarse) gives its base.
 */
export function verbOf(word: string, meaning: string): string | null {
  const w = plain(word);
  const listed = /\(\s*([\p{L}]+)\s*:\s*to\s/u.exec(meaning)?.[1];
  if (listed) return plain(listed);
  if (/^to\s/i.test(meaning.trim()) && /(ar|er|ir|ír|ér)(se)?$/.test(w)) return w.replace(/se$/, '');
  return null;
}

type Ask = (messages: { id: string; role: 'system' | 'user'; content: string; timestamp: number }[]) => Promise<string>;

/** Spanish is conjugated offline by rule; other languages are written once by the AI and kept in the glossary. */
export async function conjugationFor(infinitive: string, ask: Ask, langName: (code: string) => string): Promise<{ name: string; lines: string[] }[]> {
  const code = useLanguage.getState().language;
  if (code.toLowerCase().startsWith('es')) {
    const tenses = conjugateSpanish(infinitive);
    if (tenses) return tenses.map((t) => ({ name: t.name, lines: t.forms.map((f, i) => `${PERSONS[i]} ${f}`) }));
  }
  const key = `conj:${infinitive}`;
  const kept = useLanguage.getState().glossary[code]?.[key];
  if (kept) return [{ name: 'Present', lines: kept.split('\n') }];
  const name = langName(code);
  const raw = await ask([
    { id: 's', role: 'system', content: `You are a ${name} teacher. Conjugate the verb in the present tense. Reply with exactly six lines, one for each person (I, you, he or she, we, you all, they), each as the pronoun then the verb form. No other text.`, timestamp: 0 },
    { id: 'u', role: 'user', content: `${name} verb: ${infinitive}`, timestamp: 0 },
  ]);
  const lines = raw.replace(/<think>[\s\S]*?<\/think>/g, '').split('\n').map((l) => l.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 6);
  if (lines.length < 3) throw new Error('The AI could not conjugate this verb. Try again.');
  useLanguage.setState((st) => ({ glossary: { ...st.glossary, [code]: { ...st.glossary[code], [key]: lines.join('\n') } } }));
  return [{ name: 'Present', lines }];
}
