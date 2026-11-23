/**
 * Prompt filter: an image prompt that asks for sexual content never reaches an image model.
 *
 * It runs on the words the person typed and on the words the prompt enhancer wrote, for local and
 * remote image models alike. There is no setting that turns it off.
 *
 * The match is on whole words after the text is folded: lower case, accents removed, common digit
 * and symbol swaps undone (n4ked -> naked, s3x -> sex), and separators inside a word removed
 * (n.u.d.e -> nude). Phrases match on the folded word sequence.
 */

/** Single words that ask for sexual or nude content. */
const BLOCKED_WORDS = [
  'nude', 'nudes', 'nudity', 'naked', 'topless', 'bottomless', 'undressed', 'unclothed',
  'nsfw', 'porn', 'porno', 'pornographic', 'pornography', 'hentai', 'ecchi', 'xxx',
  'sex', 'sexy', 'sexual', 'sexually', 'intercourse', 'orgasm', 'erotic', 'erotica', 'explicit',
  'nipple', 'nipples', 'areola', 'areolas', 'breasts', 'boobs', 'tits', 'titties', 'cleavage',
  'genital', 'genitals', 'genitalia', 'vagina', 'labia', 'pubic', 'pubes', 'crotch', 'phallus', 'phallic',
  'undress', 'undressing', 'vulva', 'penis', 'cock', 'dick', 'pussy', 'clit', 'clitoris',
  'testicles', 'scrotum', 'anus', 'butthole', 'buttocks',
  'blowjob', 'handjob', 'cumshot', 'cum', 'creampie', 'masturbate', 'masturbating', 'masturbation',
  'fellatio', 'cunnilingus', 'bukkake', 'gangbang', 'threesome', 'orgy', 'bdsm', 'bondage',
  'fetish', 'lingerie', 'stripper', 'striptease', 'camgirl', 'onlyfans', 'lewd', 'smut', 'horny',
  'aroused', 'seductive', 'sensual', 'voluptuous', 'lolicon', 'loli', 'shota', 'shotacon',
  'rule34', 'r34', 'futanari', 'futa', 'upskirt', 'downblouse', 'nudist', 'nudism',
] as const;

/** Phrases whose single words are fine alone. */
const BLOCKED_PHRASES = [
  'no clothes', 'without clothes', 'no clothing', 'without clothing', 'wearing nothing',
  'taking off clothes', 'taking off her clothes', 'taking off his clothes', 'see through',
  'see-through', 'wet t shirt', 'spread legs', 'legs spread', 'bare chest woman', 'bare breasts',
  'bare butt', 'bare bottom', 'full frontal', 'in the nude', 'birthday suit', 'sex scene',
  'having sex', 'making love', 'adult content', 'adult only', 'not safe for work', 'only fans',
  'private parts', 'private part', 'intimate parts', 'bare breast', 'exposed breast', 'exposed breasts',
] as const;

const SWAPS: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i',
};

const WORDS = new Set<string>(BLOCKED_WORDS);
const PHRASES = BLOCKED_PHRASES.map(phrase => foldWords(phrase).join(' '));

/** Fold one word: swaps undone, everything but letters and digits removed. */
function foldWord(raw: string): string {
  return raw
    .split('')
    .map(ch => SWAPS[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

/** The text as folded words. A word is a run of characters between spaces, commas and the like. */
function foldWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[\s,;:/\\|()[\]{}"'`?<>+=_~^&#%*-]+/)
    .map(foldWord)
    .filter(Boolean);
}

export interface PromptVerdict {
  allowed: boolean;
  /** The word or phrase that blocked it, for logs only (never shown back to the person). */
  match?: string;
}

/** Whether an image prompt may go to an image model. */
export function checkImagePrompt(text: string | null | undefined): PromptVerdict {
  if (!text) return { allowed: true };
  const words = foldWords(text);
  for (const word of words) {
    if (WORDS.has(word)) return { allowed: false, match: word };
    // A plural or verb ending on a blocked word ("nudes", "boobies" are listed; this catches the rest).
    const stem = word.replace(/(es|s|ed|ing|y)$/, '');
    if (stem.length >= 4 && WORDS.has(stem)) return { allowed: false, match: stem };
  }
  const joined = ` ${words.join(' ')} `;
  const phrase = PHRASES.find(p => joined.includes(` ${p} `));
  return phrase ? { allowed: false, match: phrase } : { allowed: true };
}

/** What the person sees when a prompt or an image is blocked. */
export const BLOCKED_PROMPT_MESSAGE =
  "Off Grid AI doesn't make sexual or nude images. Try a different description.";
export const BLOCKED_IMAGE_MESSAGE =
  "This image was blocked because it may contain nudity or sexual content. Try a different description.";
export const BLOCKED_VIDEO_PROMPT_MESSAGE =
  "Off Grid AI doesn't make sexual or nude videos. Try a different description.";
export const BLOCKED_VIDEO_MESSAGE =
  "This video was blocked because it may contain nudity or sexual content. Try a different description.";
