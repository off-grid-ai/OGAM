/**
 * BATCH 5 (TTS & Audio) — hardening — playback machine: pause during preparing,
 * then a LATE flowing must stay paused.
 *
 * The existing playbackMachine.test.ts pins "flowing never un-pauses" starting from a
 * store already in `paused`. This file pins the fuller, realistic RACE: a user taps
 * pause DURING the (slow) load window (status 'preparing'), and the backend's
 * `flowing` event — emitted when audio actually starts — arrives AFTER the pause.
 * `flowing` promotes ONLY preparing→playing, so a late `flowing` on a session that the
 * user already paused must NOT resurrect playback. This is the exact interaction the
 * Provit journey exercises (cases 14/16/20/21: pause/stop/background during the
 * preparing→playing transition, no stuck-or-restarted playback).
 *
 * Drives the REAL dispatchPlayback transition table (from @offgrid/pro) over a tiny
 * in-memory store that mirrors the Zustand shape — no mock of the machine under test.
 */
jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { dispatchPlayback, PlaybackStatus } from '../../pro/audio/playbackMachine';

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

function makeStore() {
  let state: StoreShape = {
    playbackStatus: 'idle', playSessionId: 0, currentMessageId: null,
    playbackElapsed: 0, playbackDuration: 0, currentAmplitude: 0, error: null, currentAudioPath: null,
  };
  const deps = {
    set: (p: any) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; },
    get: () => state,
  };
  return { deps, get: () => state };
}

describe('playback machine — pause during preparing, then late flowing', () => {
  it('start → pause (while preparing) → late flowing STAYS paused', () => {
    const store = makeStore();
    const session = dispatchPlayback(store.deps, { t: 'start', messageId: 'm1' }) as number;
    expect(store.get().playbackStatus).toBe('preparing');

    // User pauses before audio is out — pause is valid from preparing.
    dispatchPlayback(store.deps, { t: 'pause' });
    expect(store.get().playbackStatus).toBe('paused');

    // Backend finally produces the first frame and fires flowing for THIS session.
    // flowing promotes only preparing→playing, so from paused it must be a no-op.
    dispatchPlayback(store.deps, { t: 'flowing', session });
    expect(store.get().playbackStatus).toBe('paused'); // NOT resurrected to playing
  });

  it('a resume after the late flowing then plays (paused was honoured, not lost)', () => {
    const store = makeStore();
    const session = dispatchPlayback(store.deps, { t: 'start', messageId: 'm1' }) as number;
    dispatchPlayback(store.deps, { t: 'pause' });
    dispatchPlayback(store.deps, { t: 'flowing', session }); // ignored (stays paused)

    dispatchPlayback(store.deps, { t: 'resume' });
    expect(store.get().playbackStatus).toBe('playing'); // resume works from the honoured pause
  });

  it('a late flowing from a SUPERSEDED session cannot un-pause the current one', () => {
    // While paused-during-preparing on session N, a stale flowing from session N-1
    // (a playback the user already replaced) must be ignored on BOTH the session guard
    // AND the paused guard.
    const store = makeStore();
    dispatchPlayback(store.deps, { t: 'start', messageId: 'm-old' }); // session 1
    const current = dispatchPlayback(store.deps, { t: 'start', messageId: 'm-new' }) as number; // session 2
    dispatchPlayback(store.deps, { t: 'pause' });
    expect(store.get().playbackStatus).toBe('paused');

    dispatchPlayback(store.deps, { t: 'flowing', session: current - 1 }); // stale session 1
    expect(store.get().playbackStatus).toBe('paused');
  });

  it('the normal (un-paused) path still promotes: start → flowing → playing', () => {
    // Behaviour-neutral guard: without an intervening pause, a same-session flowing
    // still promotes preparing → playing.
    const store = makeStore();
    const session = dispatchPlayback(store.deps, { t: 'start', messageId: 'm1' }) as number;
    dispatchPlayback(store.deps, { t: 'flowing', session });
    expect(store.get().playbackStatus).toBe('playing');
  });
});
