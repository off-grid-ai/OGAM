/**
 * Joining Whisper's timed text with the speaker turns from on-device diarization.
 * Pure functions: the recorder service calls them, and they are tested without a device.
 */
export interface TimedText { start: number; end: number; text: string }
export interface SpeakerTurn { start: number; end: number; speaker: number }
export interface Utterance { start: number; end: number; speaker: number; text: string }

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** The speaker who talks most during a piece of text, or the nearest turn when none overlaps. */
function speakerFor(seg: TimedText, turns: SpeakerTurn[]): number {
  if (!turns.length) return 0;
  const talk = new Map<number, number>();
  for (const t of turns) {
    const o = overlap(seg, t);
    if (o > 0) talk.set(t.speaker, (talk.get(t.speaker) ?? 0) + o);
  }
  if (talk.size) return [...talk.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const mid = (seg.start + seg.end) / 2;
  const dist = (t: SpeakerTurn) => (mid < t.start ? t.start - mid : mid > t.end ? mid - t.end : 0);
  return turns.reduce((best, t) => (dist(t) < dist(best) ? t : best)).speaker;
}

/**
 * Labels each piece of text with a speaker and joins consecutive pieces by the same person.
 * Speakers are renumbered 0, 1, 2... in the order they first talk.
 */
export function labelTranscript(segments: TimedText[], turns: SpeakerTurn[]): Utterance[] {
  const order = new Map<number, number>();
  const out: Utterance[] = [];
  for (const seg of [...segments].sort((a, b) => a.start - b.start)) {
    const raw = speakerFor(seg, turns);
    if (!order.has(raw)) order.set(raw, order.size);
    const speaker = order.get(raw)!;
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) {
      last.end = seg.end;
      last.text = `${last.text} ${seg.text}`.trim();
    } else {
      out.push({ start: seg.start, end: seg.end, speaker, text: seg.text.trim() });
    }
  }
  return out;
}

/** "Speaker 1" unless the user named them. */
export const speakerName = (names: Record<number, string> | undefined, speaker: number): string =>
  names?.[speaker]?.trim() || `Speaker ${speaker + 1}`;

/** m:ss or h:mm:ss */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Plain-text transcript for saving to a project or sharing. */
export function transcriptText(title: string, utterances: Utterance[], names?: Record<number, string>): string {
  return [`# ${title}`, '', ...utterances.map((u) => `[${clock(u.start)}] ${speakerName(names, u.speaker)}: ${u.text}`)].join('\n');
}
