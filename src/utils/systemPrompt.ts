import { replyLanguageLine } from '@offgrid/i18n';
import { APP_CONFIG, PREVIOUS_DEFAULT_SYSTEM_PROMPTS } from '../constants';

const hasText = (prompt: string | undefined | null): prompt is string => !!prompt?.trim();

// A prompt an earlier build saved as its own default is not the user's writing: it reads as the
// current built-in one, so a better built-in reaches every phone without rewriting stored settings.
const isPreviousDefault = (prompt: string): boolean =>
  PREVIOUS_DEFAULT_SYSTEM_PROMPTS.some(previous => previous.trim() === prompt.trim());

/** The first prompt with words in it. A blank one ("\n", spaces) is no prompt, so it never wins over the next. */
export const firstPrompt = (...prompts: Array<string | undefined | null>): string | undefined => {
  const found = prompts.find(hasText);
  return found && isPreviousDefault(found) ? APP_CONFIG.defaultSystemPrompt : found;
};

/** The prompt chat sends: the first with words in it, else the built-in one. */
export const resolveSystemPrompt = (...prompts: Array<string | undefined | null>): string =>
  firstPrompt(...prompts) ?? APP_CONFIG.defaultSystemPrompt;

export const isBuiltInPrompt = (prompt: string | undefined | null): boolean =>
  !hasText(prompt) || prompt.trim() === APP_CONFIG.defaultSystemPrompt.trim() || isPreviousDefault(prompt);

/** The prompt plus the "Reply in my language" line when the person turned it on for a non-English app. */
export const withReplyLanguage = (prompt: string, appLanguage: string, replyInLanguage: boolean): string => {
  const line = replyLanguageLine(appLanguage, replyInLanguage);
  return line ? `${prompt}\n\n${line}` : prompt;
};

