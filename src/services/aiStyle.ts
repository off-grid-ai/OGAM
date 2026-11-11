/**
 * Global AI style: how every assistant answers (length, tone, level, emoji, plus the
 * user's own standing instructions), whichever agent or project is active. Turned
 * into one prompt note here so the settings screen and the prompt builder agree.
 */
export type AiLength = 'brief' | 'balanced' | 'detailed';
export type AiTone = 'friendly' | 'neutral' | 'formal' | 'playful' | 'direct';
export type AiLevel = 'simple' | 'normal' | 'expert';

export type AiEmoji = 'never' | 'sometimes' | 'often';

export interface AiStyle {
  length?: AiLength;
  tone?: AiTone;
  level?: AiLevel;
  /** 'never' | 'sometimes' | 'often'; legacy boolean values (false/true) are still accepted. */
  emoji?: AiEmoji | boolean;
  /** Ask a follow-up question at the end of answers. Unset means only when the answer truly needs one. */
  followUps?: boolean;
  /** Free-text standing instructions ("Always use metric units"). */
  custom?: string;
}

export const AI_LENGTHS: Array<{ id: AiLength; name: string; hint: string }> = [
  { id: 'brief', name: 'Brief', hint: 'A few sentences' },
  { id: 'balanced', name: 'Balanced', hint: 'As long as needed' },
  { id: 'detailed', name: 'Detailed', hint: 'Thorough, with examples' },
];
export const AI_TONES: Array<{ id: AiTone; name: string }> = [
  { id: 'friendly', name: 'Friendly' }, { id: 'neutral', name: 'Neutral' }, { id: 'direct', name: 'Direct' },
  { id: 'formal', name: 'Formal' }, { id: 'playful', name: 'Playful' },
];
export const AI_LEVELS: Array<{ id: AiLevel; name: string }> = [
  { id: 'simple', name: 'Simple words' }, { id: 'normal', name: 'Everyday' }, { id: 'expert', name: 'Expert' },
];

const LENGTH_NOTE: Record<AiLength, string> = {
  brief: 'Keep answers short: a few sentences, or a short list when steps are needed. Skip introductions and summaries.',
  balanced: 'Make answers as long as the question needs and no longer.',
  detailed: 'Give thorough answers with explanation, examples and the reasoning behind them.',
};
const TONE_NOTE: Record<AiTone, string> = {
  friendly: 'Sound warm and encouraging.',
  neutral: 'Sound calm and neutral.',
  direct: 'Be direct and to the point; no filler or pleasantries.',
  formal: 'Use a formal, professional tone.',
  playful: 'Be light-hearted and playful where it fits, but stay accurate.',
};
const LEVEL_NOTE: Record<AiLevel, string> = {
  simple: 'Explain in simple, everyday words a young teenager would follow; define any technical term.',
  normal: '',
  expert: 'The user is knowledgeable: use precise technical language and skip the basics.',
};

/**
 * Models end nearly every answer with "Would you like me to...?" unless told not to, so the default (nothing chosen)
 * is to ask only when the answer cannot be given without more information.
 */
/** Always on: models fill gaps with confident inventions unless told that "I am not sure" is an acceptable answer. */
export const BE_HONEST = 'If you are not sure of a fact, say so. Never invent names, numbers, dates, quotes, links or sources.';
export const NO_IDLE_QUESTIONS = 'Do not end your answer with a question or an offer ("Would you like me to...", "Let me know if..."). Ask a question only when you cannot do what was asked without one more piece of information.';
function followUpNote(followUps: boolean | undefined): string {
  if (followUps === true) return 'End with one short follow-up question when it would help.';
  return followUps === false ? 'Never end with a follow-up question or an offer to do more.' : NO_IDLE_QUESTIONS;
}

/** The prompt note for the user's AI style (it always says not to end with idle questions unless the user turned them on). */
export function aiStyleNote(style?: AiStyle): string {
  const parts = [
    style?.length && style.length !== 'balanced' ? LENGTH_NOTE[style.length] : '',
    style?.tone && style.tone !== 'neutral' ? TONE_NOTE[style.tone] : '',
    style?.level ? LEVEL_NOTE[style.level] : '',
    style?.emoji === 'often' ? 'Feel free to use emoji to express yourself.' :
    (style?.emoji === 'sometimes' || style?.emoji === true) ? 'An occasional emoji is fine.' :
    (style?.emoji === 'never' || style?.emoji === false) ? 'Do not use emoji.' : '',
    followUpNote(style?.followUps),
    BE_HONEST,
  ].filter(Boolean);
  const custom = style?.custom?.trim();
  if (!parts.length && !custom) return '';
  const rules = parts.length ? `\n${parts.join(' ')}` : '';
  const own = custom ? `\nThe user's standing instructions: ${custom.slice(0, 1200)}` : '';
  return `\n\nHOW THE USER WANTS YOU TO ANSWER (always follow, unless a safety rule says otherwise):${rules}${own}`;
}
