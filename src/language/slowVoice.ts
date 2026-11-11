import { setRateAdjuster } from '../atlasVoice/tts';
import { useLanguage } from './store';

/** The spoken lines that belong to the language course (see the message ids passed to speakIn / speakInAndWait). */
const COURSE_LINES = new Set(['lesson', 'listening', 'call', 'call-hint', 'crossword', 'word']);
/** Speech rate with the slower-voice option on (1 is normal). */
export const SLOW_RATE = 0.7;

/** Slows the course's spoken lines when the learner turned on "Slower voice"; every other speech is untouched. */
export const courseRate = (messageId: string, rate: number): number =>
  (useLanguage.getState().slowVoice && COURSE_LINES.has(messageId.split('~')[0]) ? Math.min(rate, SLOW_RATE) : rate);

export function installSlowVoice(): void {
  setRateAdjuster(courseRate);
}
