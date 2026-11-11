/**
 * Detects the user talking over a spoken answer ("barge-in") from mic loudness alone.
 *
 * The recorder has no echo cancellation, so the answer itself reaches the mic. The answer's
 * echo is fairly steady; a person speaking near the phone makes the level jump well above
 * it. A frame counts as speech when it is louder than both an absolute floor and `ratio`
 * times the loudest recent non-speech frame; `sustain` speech frames in a row trigger.
 * Each frame is one recorder buffer (100 ms at 16 kHz / 1600 samples).
 */
export type BargeInOptions = { minRms: number; ratio: number; sustain: number; history: number; warmup: number };

export const DEFAULT_BARGE_IN: BargeInOptions = { minRms: 0.06, ratio: 2.5, sustain: 3, history: 20, warmup: 3 };

export class BargeInDetector {
  private recent: number[] = [];
  private streak = 0;
  private frames = 0;

  constructor(private readonly opts: BargeInOptions = DEFAULT_BARGE_IN) {}

  /** Feed one frame's RMS (0..1); true once the user has clearly started talking. */
  push(rms: number): boolean {
    this.frames++;
    const echo = this.recent.length ? Math.max(...this.recent) : 0;
    const speech = this.frames > this.opts.warmup && rms > Math.max(this.opts.minRms, echo * this.opts.ratio);
    if (!speech) {
      this.streak = 0;
      this.recent.push(rms);
      if (this.recent.length > this.opts.history) this.recent.shift();
      return false;
    }
    this.streak++;
    return this.streak >= this.opts.sustain;
  }
}
