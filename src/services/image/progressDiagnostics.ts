/**
 * How often the raw native progress event is worth writing to the log.
 *
 * A diffusion run emits one `LocalDreamProgress` event per step, and `logger` mirrors every line
 * into the dev file sink, so logging each event turned a 20-step generation into 20 stringified
 * writes and a long run into hundreds - on the JS thread, while the run is what the user is
 * waiting for. The first step proves the wire shape, the last proves the run reached the end, and
 * one every few steps in between keeps the trace readable without the storm.
 */
const SAMPLE_EVERY_STEPS = 5;

/** Whether this progress step's raw event should be logged. Pure; no state, no clock. */
export function shouldLogProgressStep(step: number, totalSteps: number): boolean {
  // A step outside the run is itself the diagnostic worth seeing.
  if (!Number.isInteger(step) || step < 1) return true;
  if (step === 1 || step === totalSteps) return true;
  return step % SAMPLE_EVERY_STEPS === 0;
}
