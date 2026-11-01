/**
 * ttsEngineSubscription — maps engine events into the unified playback state.
 *
 * Pins the pause/play fix: when the engine DIES mid-playback (released under memory
 * pressure / evicted / runtime error) it emits phaseChange('idle'|'error'). The
 * store must reflect that back to idle instead of leaving status='playing' over a
 * dead engine — the desync that made pause/play "do nothing" (the buttons toggled
 * status while engine.pause()/resume() hit a null bridge). Also covers the existing
 * preparing→playing and →paused promotions, and the file-player-owns-playback case.
 */
import { subscribeToEngine } from '../../../pro/audio/ttsEngineSubscription';
import { audioFilePlayer } from '../../../pro/audio/audioFilePlayer';

// subscribeToEngine and the real audioFilePlayer run; the player plays over react-native-audio-api's
// AudioContext (faked in jest.setup). The engine below is a test emitter of the engine event contract.

/** A voice note is playing through the file player (it owns playback until stopped). */
async function playVoiceNote() {
  // The device decodes the file into a 3 s buffer (the jest.setup context has no decoder).
  const api = require('react-native-audio-api') as { AudioContext: jest.Mock };
  const makeContext = api.AudioContext.getMockImplementation()!;
  api.AudioContext.mockImplementation(() => ({ ...makeContext(), decodeAudioData: async () => ({ duration: 3 }) }));
  void audioFilePlayer.play('/docs/voice-note.wav').catch(() => {});
  for (let i = 0; i < 20 && !audioFilePlayer.isActive(); i += 1) await new Promise(resolve => setImmediate(resolve));
  expect(audioFilePlayer.isActive()).toBe(true);
}

type Cb = (...args: any[]) => void;
function makeEngine() {
  const listeners: Record<string, Cb[]> = {};
  return {
    on: (evt: string, cb: Cb) => { (listeners[evt] ||= []).push(cb); return () => {}; },
    emit: (evt: string, ...args: any[]) => (listeners[evt] || []).forEach((cb) => cb(...args)),
    getOverallDownloadProgress: () => 1,
  };
}

let state: Record<string, any>;
const deps = () => ({
  set: (p: any) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; },
  get: () => state,
  phaseToFlags: () => ({}),
});

afterEach(() => audioFilePlayer.stop());

beforeEach(() => {
  expect(audioFilePlayer.isActive()).toBe(false);
  state = { currentMessageId: 'm1', playbackStatus: 'playing', playbackElapsed: 5, currentAmplitude: 0.3, error: null };
});

describe('engine death reflects into the unified state (pause/play fix)', () => {
  it('resets to idle when the engine goes idle while it owns playback', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('phaseChange', 'idle');
    expect(state.playbackStatus).toBe('idle');
    expect(state.currentMessageId).toBeNull();
    expect(state.playbackElapsed).toBe(0);
  });

  it('resets to idle on a runtime error mid-playback', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('phaseChange', 'error');
    expect(state.playbackStatus).toBe('idle');
    expect(state.currentMessageId).toBeNull();
  });

  it('does NOT touch unified state when the file player owns playback', async () => {
    await playVoiceNote();
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('phaseChange', 'idle');
    // File player drives its own status; engine going idle must not clobber it.
    expect(state.playbackStatus).toBe('playing');
    expect(state.currentMessageId).toBe('m1');
  });

  it('does not spuriously reset when already idle (no active message)', () => {
    state = { currentMessageId: null, playbackStatus: 'idle', playbackElapsed: 0, currentAmplitude: 0, error: null };
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('phaseChange', 'idle');
    expect(state.playbackStatus).toBe('idle');
  });
});

describe('phase promotions still work', () => {
  it('promotes preparing → playing when the engine starts processing', () => {
    state = { currentMessageId: 'm1', playbackStatus: 'preparing', error: null };
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('phaseChange', 'processing');
    expect(state.playbackStatus).toBe('playing');
  });

  it('reflects engine pause → paused', () => {
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('phaseChange', 'paused');
    expect(state.playbackStatus).toBe('paused');
  });
});

describe('completion edge — the stuck stop-button fix', () => {
  it('ends playback when the engine settles back to ready AFTER playing', () => {
    // The bug: nothing mapped engine 'ready' (natural completion) → idle, so status
    // stuck on 'playing', the bottom-bar stop button stayed active, and recording was
    // blocked until a manual stop. This is now one transition.
    state = { currentMessageId: 'm1', playbackStatus: 'playing', playbackElapsed: 5, currentAmplitude: 0.3, error: null, playSessionId: 1 };
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('phaseChange', 'ready');
    expect(state.playbackStatus).toBe('idle');
    expect(state.currentMessageId).toBeNull();
    expect(state.playbackElapsed).toBe(0);
  });

  it('does NOT end on ready while still preparing (that is load-complete, not playback-complete)', () => {
    state = { currentMessageId: 'm1', playbackStatus: 'preparing', error: null, playSessionId: 1 };
    const engine = makeEngine();
    subscribeToEngine(engine as any, deps());
    engine.emit('phaseChange', 'ready');
    expect(state.playbackStatus).toBe('preparing');
    expect(state.currentMessageId).toBe('m1');
  });
});
