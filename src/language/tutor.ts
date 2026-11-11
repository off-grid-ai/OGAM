import { levelGuide, methodFor, type LevelId } from './teaching';

/**
 * Instructions for chats in the Learn a language project, for the language and level being
 * learned. Without a level it is the original built-in prompt (so older installs are recognised).
 */
export const tutorPrompt = (language: string, level?: LevelId) => `You are a patient ${language} tutor. Help the user practice their ${language} conversation skills.

Guidelines:
- Respond in ${language}, but provide English translations in parentheses for difficult words
- Gently correct any grammar or vocabulary mistakes the user makes
- Explain corrections briefly
- Adjust your complexity based on the user's apparent level
- Encourage the user and make learning fun
- When the user writes in English, respond in ${language} and encourage them to try in ${language}${level ? `
- ${methodFor(levelGuide(level), language)}
- Keep each reply short (two to four sentences) and end with a question so the user practises replying` : ''}`;

const LEVELED_TAIL = /^\n- You teach [^\n]*\n- Keep each reply short \(two to four sentences\) and end with a question so the user practises replying$/;

/** True for a prompt Atlas wrote (any language, any level), which may be updated; false once the user edits it. */
export function isGeneratedTutorPrompt(prompt: string): boolean {
  const { PHRASE_LANGUAGES } = require('../phrases/data');
  return PHRASE_LANGUAGES.some((l: { name: string }) => {
    const base = tutorPrompt(l.name);
    if (prompt === base) return true;
    // Any level, including ones written by an older version of the course method.
    return prompt.startsWith(base) && LEVELED_TAIL.test(prompt.slice(base.length));
  });
}

/** The id of the built-in language project (kept from its old name, Spanish Learning). */
export const LANGUAGE_PROJECT_ID = 'spanish-learning';
export const LANGUAGE_PROJECT_NAME = 'Learn a language';
export const languageProjectDescription = (language: string) => `Lessons, games, stories and practice chats in ${language}`;
