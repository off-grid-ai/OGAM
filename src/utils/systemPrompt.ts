import { APP_CONFIG } from '../constants';

const hasText = (prompt: string | undefined | null): prompt is string => !!prompt?.trim();

/** The first prompt with words in it. A blank one ("\n", spaces) is no prompt, so it never wins over the next. */
export const firstPrompt = (...prompts: Array<string | undefined | null>): string | undefined =>
  prompts.find(hasText);

/** The prompt chat sends: the first with words in it, else the built-in one. */
export const resolveSystemPrompt = (...prompts: Array<string | undefined | null>): string =>
  firstPrompt(...prompts) ?? APP_CONFIG.defaultSystemPrompt;

export const isBuiltInPrompt = (prompt: string | undefined | null): boolean =>
  !hasText(prompt) || prompt.trim() === APP_CONFIG.defaultSystemPrompt.trim();
