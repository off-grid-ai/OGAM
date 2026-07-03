/**
 * playbackMachine — the SINGLE writer of `playbackStatus`.
 *
 * Direct unit coverage of `dispatchPlayback(deps, event)`: the one transition table
 * that every audio backend (engine / file player / streaming coordinator) routes
 * through. These tests pin the core invariants the machine exists to guarantee:
 *
 *  - `start` mints a monotonic session token (prev+1), enters `preparing`, resets fields.
 *  - `flowing` promotes ONLY `preparing → playing` (never un-pauses), and is session-guarded.
 *  - `position` updates the clock WITHOUT touching status, and is session-guarded.
 *  - pause/resume transitions and their guards.
 *  - `ended` resets only when the session matches AND status !== idle (idempotent).
 *  - `failed` sets error + idle; `stop` resets.
 *  - the core race guard: a SUPERSEDED session's late `ended`/`position` is ignored.
 *  - IDLE_RESET clears messageId / elapsed / duration / amplitude / audioPath.
 *
 * smLog is mocked to a no-op (logger mocked) so we assert state, not log strings.
 */
jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { dispatchPlayback, PlaybackStatus } from '../../../pro/audio/playbackMachine';

interface StoreShape {
  playbackStatus: PlaybackStatus;
  playSessionId: number;
  currentMessageId: string | null;
  playbackElapsed: number;
  playbackDuration: number;
  currentAmplitude: number;
  error: string | null;
  currentAudioPath: string | null;
}

function freshState(): StoreShape {
  return {
    playbackStatus: 'idle',
    playSessionId: 0,
    currentMessageId: null,
    playbackElapsed: 0,
    playbackDuration: 0,
    currentAmplitude: 0,
    error: null,
    currentAudioPath: null,
  };
}

/** Tiny fake store mirroring the real Zustand store shape: object + set (object or
 *  updater fn) + get. */
function makeStore(initial?: Partial<StoreShape>) {
  let state: StoreShape = { ...freshState(), ...initial };
  const deps = {
    set: (p: any) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; },
    get: () => state,
  };
  return { deps, get: () => state };
}

describe('playbackMachine.dispatchPlayback', () => {
  describe('start', () => {
    it('mints session = prev + 1, enters preparing, and resets fields', () => {
      const store = makeStore({
        playSessionId: 4,
        playbackStatus: 'playing',
        currentMessageId: 'old',
        playbackElapsed: 99,
        playbackDuration: 120,
        error: 'boom',
      });
      const session = dispatchPlayback(store.deps, { t: 'start', messageId: 'm1' });
      expect(session).toBe(5);
      const s = store.get();
      expect(s.playSessionId).toBe(5);
      expect(s.playbackStatus).toBe('preparing');
      expect(s.currentMessageId).toBe('m1');
      expect(s.playbackElapsed).toBe(0);
      expect(s.playbackDuration).toBe(0);
      expect(s.error).toBeNull();
    });

    it('honours startOffset and audioPath', () => {
      const store = makeStore();
      dispatchPlayback(store.deps, { t: 'start', messageId: 'm1', startOffset: 12, audioPath: '/tmp/a.wav' });
      const s = store.get();
      expect(s.playbackElapsed).toBe(12);
      expect(s.currentAudioPath).toBe('/tmp/a.wav');
    });

    it('does NOT overwrite currentAudioPath when audioPath is omitted', () => {
      const store = makeStore({ currentAudioPath: '/keep.wav' });
      dispatchPlayback(store.deps, { t: 'start', messageId: 'm1' });
      expect(store.get().currentAudioPath).toBe('/keep.wav');
    });
  });

  describe('flowing (preparing → playing only)', () => {
    it('promotes preparing → playing for the current session', () => {
      const store = makeStore();
      const session = dispatchPlayback(store.deps, { t: 'start', messageId: 'm1' }) as number;
      dispatchPlayback(store.deps, { t: 'flowing', session });
      expect(store.get().playbackStatus).toBe('playing');
    });

    it('is a no-op from idle', () => {
      const store = makeStore({ playbackStatus: 'idle', playSessionId: 3 });
      dispatchPlayback(store.deps, { t: 'flowing', session: 3 });
      expect(store.get().playbackStatus).toBe('idle');
    });

    it('never un-pauses (paused stays paused)', () => {
      const store = makeStore({ playbackStatus: 'paused', playSessionId: 3 });
      dispatchPlayback(store.deps, { t: 'flowing', session: 3 });
      expect(store.get().playbackStatus).toBe('paused');
    });

    it('is ignored for a stale session', () => {
      const store = makeStore({ playbackStatus: 'preparing', playSessionId: 5 });
      dispatchPlayback(store.deps, { t: 'flowing', session: 4 });
      expect(store.get().playbackStatus).toBe('preparing');
    });
  });

  describe('position (clock only, never status)', () => {
    it('updates elapsed and duration without changing status', () => {
      const store = makeStore({ playbackStatus: 'preparing', playSessionId: 2 });
      dispatchPlayback(store.deps, { t: 'position', session: 2, elapsed: 10, duration: 60 });
      const s = store.get();
      expect(s.playbackElapsed).toBe(10);
      expect(s.playbackDuration).toBe(60);
      expect(s.playbackStatus).toBe('preparing');
    });

    it('updates elapsed but leaves duration when duration is omitted', () => {
      const store = makeStore({ playSessionId: 2, playbackDuration: 60 });
      dispatchPlayback(store.deps, { t: 'position', session: 2, elapsed: 5 });
      const s = store.get();
      expect(s.playbackElapsed).toBe(5);
      expect(s.playbackDuration).toBe(60);
    });

    it('is ignored for a stale session', () => {
      const store = makeStore({ playSessionId: 9, playbackElapsed: 0 });
      dispatchPlayback(store.deps, { t: 'position', session: 8, elapsed: 42, duration: 100 });
      const s = store.get();
      expect(s.playbackElapsed).toBe(0);
      expect(s.playbackDuration).toBe(0);
    });
  });

  describe('amplitude', () => {
    it('updates currentAmplitude and never touches status (no session guard)', () => {
      const store = makeStore({ playbackStatus: 'playing' });
      dispatchPlayback(store.deps, { t: 'amplitude', amplitude: 0.7 });
      const s = store.get();
      expect(s.currentAmplitude).toBe(0.7);
      expect(s.playbackStatus).toBe('playing');
    });
  });

  describe('pause / resume', () => {
    it('pause: playing → paused and clears amplitude', () => {
      const store = makeStore({ playbackStatus: 'playing', currentAmplitude: 0.9 });
      dispatchPlayback(store.deps, { t: 'pause' });
      const s = store.get();
      expect(s.playbackStatus).toBe('paused');
      expect(s.currentAmplitude).toBe(0);
    });

    it('pause: preparing → paused', () => {
      const store = makeStore({ playbackStatus: 'preparing' });
      dispatchPlayback(store.deps, { t: 'pause' });
      expect(store.get().playbackStatus).toBe('paused');
    });

    it('pause: no-op from idle and from paused', () => {
      const idle = makeStore({ playbackStatus: 'idle' });
      dispatchPlayback(idle.deps, { t: 'pause' });
      expect(idle.get().playbackStatus).toBe('idle');

      const paused = makeStore({ playbackStatus: 'paused' });
      dispatchPlayback(paused.deps, { t: 'pause' });
      expect(paused.get().playbackStatus).toBe('paused');
    });

    it('resume: paused → playing', () => {
      const store = makeStore({ playbackStatus: 'paused' });
      dispatchPlayback(store.deps, { t: 'resume' });
      expect(store.get().playbackStatus).toBe('playing');
    });

    it('resume: no-op when not paused', () => {
      const store = makeStore({ playbackStatus: 'preparing' });
      dispatchPlayback(store.deps, { t: 'resume' });
      expect(store.get().playbackStatus).toBe('preparing');
    });
  });

  describe('ended', () => {
    it('resets to idle when session matches and status !== idle', () => {
      const store = makeStore({
        playbackStatus: 'playing',
        playSessionId: 3,
        currentMessageId: 'm1',
        playbackElapsed: 30,
        playbackDuration: 60,
        currentAmplitude: 0.5,
        currentAudioPath: '/a.wav',
      });
      dispatchPlayback(store.deps, { t: 'ended', session: 3 });
      const s = store.get();
      expect(s.playbackStatus).toBe('idle');
      expect(s.currentMessageId).toBeNull();
      expect(s.playbackElapsed).toBe(0);
      expect(s.playbackDuration).toBe(0);
      expect(s.currentAmplitude).toBe(0);
      expect(s.currentAudioPath).toBeNull();
    });

    it('is idempotent — no reset when already idle', () => {
      const store = makeStore({ playbackStatus: 'idle', playSessionId: 3, currentMessageId: 'lingering' });
      dispatchPlayback(store.deps, { t: 'ended', session: 3 });
      // status already idle → guard short-circuits, fields untouched.
      expect(store.get().currentMessageId).toBe('lingering');
    });

    it('is ignored for a superseded (stale) session — the core race guard', () => {
      // A late `ended` from a playback that was already replaced must NOT reset the
      // playback that superseded it.
      const store = makeStore({ playbackStatus: 'playing', playSessionId: 6, currentMessageId: 'new', playbackElapsed: 12 });
      dispatchPlayback(store.deps, { t: 'ended', session: 5 });
      const s = store.get();
      expect(s.playbackStatus).toBe('playing');
      expect(s.currentMessageId).toBe('new');
      expect(s.playbackElapsed).toBe(12);
    });
  });

  describe('failed', () => {
    it('sets error and resets to idle for the current session', () => {
      const store = makeStore({
        playbackStatus: 'playing',
        playSessionId: 2,
        currentMessageId: 'm1',
        playbackElapsed: 8,
        playbackDuration: 40,
        currentAudioPath: '/a.wav',
      });
      dispatchPlayback(store.deps, { t: 'failed', session: 2, error: 'decode error' });
      const s = store.get();
      expect(s.playbackStatus).toBe('idle');
      expect(s.error).toBe('decode error');
      expect(s.currentMessageId).toBeNull();
      expect(s.playbackElapsed).toBe(0);
      expect(s.playbackDuration).toBe(0);
      expect(s.currentAudioPath).toBeNull();
    });

    it('is ignored for a stale session', () => {
      const store = makeStore({ playbackStatus: 'playing', playSessionId: 7, error: null });
      dispatchPlayback(store.deps, { t: 'failed', session: 6, error: 'late failure' });
      const s = store.get();
      expect(s.playbackStatus).toBe('playing');
      expect(s.error).toBeNull();
    });
  });

  describe('stop', () => {
    it('resets to idle and clears IDLE_RESET fields when playing', () => {
      const store = makeStore({
        playbackStatus: 'playing',
        currentMessageId: 'm1',
        playbackElapsed: 20,
        playbackDuration: 50,
        currentAmplitude: 0.3,
        currentAudioPath: '/a.wav',
      });
      dispatchPlayback(store.deps, { t: 'stop' });
      const s = store.get();
      expect(s.playbackStatus).toBe('idle');
      expect(s.currentMessageId).toBeNull();
      expect(s.playbackElapsed).toBe(0);
      expect(s.playbackDuration).toBe(0);
      expect(s.currentAmplitude).toBe(0);
      expect(s.currentAudioPath).toBeNull();
    });

    it('still resets when idle but a lingering currentMessageId remains', () => {
      const store = makeStore({ playbackStatus: 'idle', currentMessageId: 'lingering', playbackElapsed: 9 });
      dispatchPlayback(store.deps, { t: 'stop' });
      const s = store.get();
      expect(s.currentMessageId).toBeNull();
      expect(s.playbackElapsed).toBe(0);
    });

    it('is a no-op when fully idle with no lingering message', () => {
      const store = makeStore({ playbackStatus: 'idle', currentMessageId: null, playbackElapsed: 0 });
      const before = { ...store.get() };
      dispatchPlayback(store.deps, { t: 'stop' });
      expect(store.get()).toEqual(before);
    });
  });

  describe('full lifecycle integration', () => {
    it('start → flowing → position → pause → resume → ended walks the states', () => {
      const store = makeStore({ playSessionId: 0 });
      const session = dispatchPlayback(store.deps, { t: 'start', messageId: 'm1' }) as number;
      expect(store.get().playbackStatus).toBe('preparing');

      dispatchPlayback(store.deps, { t: 'flowing', session });
      expect(store.get().playbackStatus).toBe('playing');

      dispatchPlayback(store.deps, { t: 'position', session, elapsed: 5, duration: 30 });
      expect(store.get().playbackElapsed).toBe(5);
      expect(store.get().playbackStatus).toBe('playing');

      dispatchPlayback(store.deps, { t: 'pause' });
      expect(store.get().playbackStatus).toBe('paused');

      dispatchPlayback(store.deps, { t: 'resume' });
      expect(store.get().playbackStatus).toBe('playing');

      dispatchPlayback(store.deps, { t: 'ended', session });
      expect(store.get().playbackStatus).toBe('idle');
      expect(store.get().currentMessageId).toBeNull();
    });
  });
});
