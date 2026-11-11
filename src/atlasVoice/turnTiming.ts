/**
 * Where the time goes in one turn of a call: you stop talking -> your words are sent to the AI (listening and
 * writing them down) -> the voice starts (the AI writes the first sentence and the voice makes it). Shown on the
 * call screen and logged, so a slow call can be pinned on one stage instead of guessed at. Pure, tested without a device.
 */
export interface TurnTimes { stoppedAt?: number; sentAt?: number; voiceAt?: number }
export type TurnEvent = 'stopped' | 'sent' | 'voice';

/** A new "stopped" starts a fresh turn; "sent" and "voice" only count in order, and only once. */
export function nextTimes(t: TurnTimes, event: TurnEvent, now: number): TurnTimes {
  if (event === 'stopped') return { stoppedAt: now };
  if (event === 'sent') return t.stoppedAt !== undefined && t.sentAt === undefined ? { ...t, sentAt: now } : t;
  return t.sentAt !== undefined && t.voiceAt === undefined ? { ...t, voiceAt: now } : t;
}

let lastText: string | null = null;
/** The newest finished turn's timing line, for the diagnostics summary. */
export const rememberCallTiming = (text: string): void => { lastText = text; };
export const lastCallTiming = (): string | null => lastText;

const sec = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

/** "Heard and sent 0.8 s, then the voice started 3.2 s later", once the voice has started. */
export function describeTurn(t: TurnTimes): string | null {
  if (t.stoppedAt === undefined || t.sentAt === undefined || t.voiceAt === undefined) return null;
  return `Last turn: sent ${sec(t.sentAt - t.stoppedAt)} after you stopped, voice started ${sec(t.voiceAt - t.sentAt)} later`;
}
