/**
 * recordingController — the single owner of the record lifecycle. These lock in
 * the contract every mic depends on: toggle() decides from the authoritative
 * phase (so a second tap STOPS instead of starting a second recording — the hero
 * tap-to-stop bug), intents are guarded by phase, and subscribers see transitions.
 */
import { recordingController } from '../../../src/services/recordingController';

const handlers = () => ({ start: jest.fn(), stop: jest.fn(), cancel: jest.fn() });

beforeEach(() => recordingController._reset());

describe('recordingController', () => {
  it('toggle() starts when idle', () => {
    const h = handlers();
    recordingController.registerHandlers(h);
    recordingController.toggle();
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('toggle() stops when recording (does not start a second recording)', () => {
    const h = handlers();
    recordingController.registerHandlers(h);
    recordingController.setPhase('recording');
    recordingController.toggle();
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.start).not.toHaveBeenCalled();
  });

  it('toggle() is a no-op while transcribing (the stop already happened)', () => {
    const h = handlers();
    recordingController.registerHandlers(h);
    recordingController.setPhase('transcribing');
    recordingController.toggle();
    expect(h.start).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('start() only fires from idle; stop() only fires while recording', () => {
    const h = handlers();
    recordingController.registerHandlers(h);
    recordingController.stop(); // not recording → ignored
    expect(h.stop).not.toHaveBeenCalled();
    recordingController.start();
    expect(h.start).toHaveBeenCalledTimes(1);
    recordingController.setPhase('recording');
    recordingController.start(); // already recording → ignored
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers on phase transitions only', () => {
    const seen: string[] = [];
    recordingController.subscribe((p) => seen.push(p));
    recordingController.setPhase('recording');
    recordingController.setPhase('recording'); // no change → no notify
    recordingController.setPhase('transcribing');
    recordingController.setPhase('idle');
    expect(seen).toEqual(['recording', 'transcribing', 'idle']);
  });

  it('unregister stops a stale recorder from receiving intents', () => {
    const h = handlers();
    const unregister = recordingController.registerHandlers(h);
    unregister();
    recordingController.toggle();
    expect(h.start).not.toHaveBeenCalled();
  });

  it('exposes isRecording from the authoritative phase', () => {
    expect(recordingController.isRecording()).toBe(false);
    recordingController.setPhase('recording');
    expect(recordingController.isRecording()).toBe(true);
  });
});
