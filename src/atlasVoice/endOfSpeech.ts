/**
 * Decides from the microphone's loudness when a person has finished talking, so a call needs no tap to send.
 * The first few samples set the room's noise floor; speech is anything clearly louder; the turn ends after a
 * stretch of quiet that follows speech. Pure (time is passed in), so it is tested without a device.
 */
export type SpeechVerdict = 'none' | 'end' | 'nothing';

export interface EndOfSpeechOptions {
  /** Quiet after speech that means "finished talking". */
  silenceMs: number;
  /** Give up when nobody spoke for this long. */
  noSpeechMs: number;
  /** End a turn that has run this long whatever happens. */
  maxTurnMs: number;
}

export const CALL_END_OF_SPEECH: EndOfSpeechOptions = { silenceMs: 1000, noSpeechMs: 15000, maxTurnMs: 60000 };

export class EndOfSpeechDetector {
  private heardAt = 0;
  private lastLoud = 0;
  private floor = 0.01;
  private samples = 0;
  private decided = false;
  /** How many loudness samples arrived (0 means this recording reports no levels at all). */
  levels = 0;

  constructor(private readonly startedAt: number, private readonly opts: EndOfSpeechOptions = CALL_END_OF_SPEECH) {}

  /** Feed one loudness sample (0..1). Returns 'end' / 'nothing' once, then 'none' forever. */
  push(rms: number, now: number): SpeechVerdict {
    if (this.decided) return 'none';
    this.levels++;
    // The room's noise floor. The first samples seed it (the quietest one, so a person who starts talking at once
    // does not become "the noise"); after that it follows the room down quickly and up slowly, on quiet samples only.
    if (this.samples < 4) {
      this.floor = this.samples === 0 ? Math.max(0.003, rms) : Math.max(0.003, Math.min(this.floor, rms));
      this.samples++;
      return 'none';
    }
    const loud = rms > Math.max(0.02, Math.min(this.floor, 0.03) * 3);
    if (loud) {
      if (!this.heardAt) this.heardAt = now;
      this.lastLoud = now;
    } else {
      this.floor = Math.max(0.003, rms < this.floor ? (this.floor + rms) / 2 : this.floor * 0.98 + rms * 0.02);
    }
    if ((this.heardAt && now - this.lastLoud > this.opts.silenceMs) || now - this.startedAt > this.opts.maxTurnMs) {
      this.decided = true;
      return 'end';
    }
    if (!this.heardAt && now - this.startedAt > this.opts.noSpeechMs) {
      this.decided = true;
      return 'nothing';
    }
    return 'none';
  }
}
