/**
 * REAL tests for pro/audio/audioFilePlayer.ts.
 *
 * We drive the REAL AudioFilePlayer / decodeFileWaveform logic. The ONLY things
 * mocked are genuine boundaries:
 *  - `react-native-audio-api` (native AudioContext / BufferSource) — a controllable
 *    fake whose `currentTime` we advance by hand and whose `onEnded` we fire when we
 *    choose, so the real position/session/state-machine logic runs against it.
 *  - `@offgrid/core/services/audioSessionManager` — the iOS audio-session native owner.
 *
 * `resolveDocumentPath` and `buildWaveformEnvelope` run FOR REAL (pure logic). We
 * assert observable state (getPosition/getDuration/isPlaying/isActive, decoded
 * envelope values, the ordering of session begin vs stop) — never "a fn was called".
 */

// ---- controllable AudioContext / BufferSource fake (native boundary) ----
type Ctx = {
  currentTime: number;
  __closed: boolean;
  __lastSource: FakeSource | null;
  __decodeImpl: (src: string) => Promise<FakeBuffer>;
  createBufferSource: () => FakeSource;
  decodeAudioData: (src: unknown) => Promise<FakeBuffer>;
  destination: object;
  resume: jest.Mock;
  suspend: jest.Mock;
  close: jest.Mock;
};
type FakeBuffer = { duration: number; getChannelData: (n: number) => Float32Array };
type FakeSource = {
  buffer: FakeBuffer | null;
  playbackRate: { value: number };
  onEnded: null | (() => void);
  connect: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  __started: boolean;
  __stopped: boolean;
  __fireEnded: () => void;
};

// Shared, out-of-factory state lives on globalThis so the jest.mock factory
// (which may not close over module-scope vars) can reach it.
interface AudioTestBag {
  ctxHandles: Ctx[];
  sessionEvents: string[];
  startShouldThrow: boolean;
  decodeShouldReject: boolean;
  decodeBufferDuration: number;
  decodeSamples: Float32Array;
  makeCtx: () => Ctx;
}
const bag = (globalThis as unknown as { __audioBag: AudioTestBag }).__audioBag ?? {
  ctxHandles: [] as Ctx[],
  sessionEvents: [] as string[],
  startShouldThrow: false,
  decodeShouldReject: false,
  decodeBufferDuration: 4.0,
  decodeSamples: new Float32Array([0.5, 0.5, 0.5, 0.5]),
  makeCtx(): Ctx {
    const ctx: Ctx = {
      currentTime: 0,
      __closed: false,
      __lastSource: null,
      __decodeImpl: async () => ({
        duration: bag.decodeBufferDuration,
        getChannelData: () => bag.decodeSamples,
      }),
      destination: {},
      createBufferSource: () => {
        const src: FakeSource = {
          buffer: null,
          playbackRate: { value: 1 },
          onEnded: null,
          connect: jest.fn(),
          start: jest.fn(() => {
            if (bag.startShouldThrow) throw new Error('bad offset');
            src.__started = true;
          }),
          stop: jest.fn(() => {
            src.__stopped = true;
          }),
          __started: false,
          __stopped: false,
          __fireEnded: () => src.onEnded?.(),
        };
        ctx.__lastSource = src;
        return src;
      },
      decodeAudioData: async () => {
        if (bag.decodeShouldReject) throw new Error('decode failed');
        return { duration: bag.decodeBufferDuration, getChannelData: () => bag.decodeSamples };
      },
      resume: jest.fn().mockResolvedValue(undefined),
      suspend: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    bag.ctxHandles.push(ctx);
    return ctx;
  },
};
(globalThis as unknown as { __audioBag: AudioTestBag }).__audioBag = bag;

jest.mock('react-native-audio-api', () => ({
  AudioContext: jest.fn().mockImplementation(() =>
    (globalThis as unknown as { __audioBag: AudioTestBag }).__audioBag.makeCtx(),
  ),
  AudioManager: {
    setAudioSessionOptions: jest.fn(),
    setAudioSessionActivity: jest.fn().mockResolvedValue(true),
  },
}));

// audioSessionManager: the iOS session native owner. Record ordering so we can
// prove play() ensures the playback session BEFORE decoding/starting the source.
jest.mock('@offgrid/core/services/audioSessionManager', () => ({
  audioSessionManager: {
    ensurePlayback: jest.fn(async () => {
      (globalThis as unknown as { __audioBag: AudioTestBag }).__audioBag.sessionEvents.push('ensurePlayback');
    }),
  },
}));

const ctxHandles = bag.ctxHandles;
const sessionEvents = bag.sessionEvents;

import { audioSessionManager } from '@offgrid/core/services/audioSessionManager';
import { decodeFileWaveform, audioFilePlayer } from '@offgrid/pro/audio/audioFilePlayer';

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  ctxHandles.length = 0;
  sessionEvents.length = 0;
  bag.startShouldThrow = false;
  bag.decodeShouldReject = false;
  bag.decodeBufferDuration = 4.0;
  bag.decodeSamples = new Float32Array([0.5, 0.5, 0.5, 0.5]);
  // Reset the singleton to a clean context between tests.
  audioFilePlayer.resetContext();
  ctxHandles.length = 0;
  (audioSessionManager.ensurePlayback as jest.Mock).mockClear();
});

/** Start a play() but hold it at the source (don't fire onEnded); return the live source. */
async function startPlay(uri = 'clip.wav', opts: Parameters<typeof audioFilePlayer.play>[1] = {}) {
  const p = audioFilePlayer.play(uri, opts);
  // Let ensurePlayback + decode + _playBuffer synchronously reach source.start().
  await flush();
  await flush();
  const ctx = ctxHandles[ctxHandles.length - 1];
  return { p, ctx, source: ctx.__lastSource! };
}

describe('decodeFileWaveform', () => {
  it('decodes real samples into an amplitude envelope (real buildWaveformEnvelope)', async () => {
    bag.decodeSamples = new Float32Array([1, 1, 0, 0, 0.5, 0.5]);
    const env = await decodeFileWaveform('rec.wav', 3);
    // 6 samples / 3 points => blocks [1,1],[0,0],[0.5,0.5] => means 1, 0, 0.5.
    expect(env).toEqual([1, 0, 0.5]);
  });

  it('returns [] when decode throws (catch branch)', async () => {
    bag.decodeShouldReject = true;
    const env = await decodeFileWaveform('missing.wav', 4);
    expect(env).toEqual([]);
  });

  it('closes the temporary context in finally on success', async () => {
    await decodeFileWaveform('rec.wav', 2);
    const ctx = ctxHandles[ctxHandles.length - 1];
    expect(ctx.close).toHaveBeenCalled();
  });

  it('closes the temporary context in finally even after a decode failure', async () => {
    bag.decodeShouldReject = true;
    await decodeFileWaveform('rec.wav', 2);
    const ctx = ctxHandles[ctxHandles.length - 1];
    expect(ctx.close).toHaveBeenCalled();
  });
});

describe('AudioFilePlayer play + lifecycle', () => {
  it('ensures the playback session BEFORE starting the source', async () => {
    const { p, source } = await startPlay();
    // The source only starts after ensurePlayback resolved.
    expect(sessionEvents).toEqual(['ensurePlayback']);
    expect(source.__started).toBe(true);
    source.__fireEnded();
    await p;
  });

  it('resolves play() when the source fires onEnded, and clears active/playing state', async () => {
    const onEnded = jest.fn();
    const { p, source } = await startPlay('clip.wav', { onEnded });
    expect(audioFilePlayer.isActive()).toBe(true);
    expect(audioFilePlayer.isPlaying()).toBe(true);
    source.__fireEnded();
    await p;
    // onEnded fired for the still-current session; source cleared => not active/playing.
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(audioFilePlayer.isActive()).toBe(false);
    expect(audioFilePlayer.isPlaying()).toBe(false);
  });

  it('fires onStart when the source starts', async () => {
    const onStart = jest.fn();
    const { p, source } = await startPlay('clip.wav', { onStart });
    expect(onStart).toHaveBeenCalledTimes(1);
    source.__fireEnded();
    await p;
  });

  it('records the decoded buffer duration as the authoritative getDuration()', async () => {
    bag.decodeBufferDuration = 7.5;
    const { p, source } = await startPlay();
    expect(audioFilePlayer.getDuration()).toBe(7.5);
    source.__fireEnded();
    await p;
  });

  it('reuses one warm AudioContext across successive plays', async () => {
    const a = await startPlay('one.wav');
    a.source.__fireEnded();
    await a.p;
    const before = ctxHandles.length;
    const b = await startPlay('two.wav');
    b.source.__fireEnded();
    await b.p;
    // No new context was constructed for the second play.
    expect(ctxHandles.length).toBe(before);
  });
});

describe('AudioFilePlayer getPosition', () => {
  it('is 0 before any play (no context)', () => {
    expect(audioFilePlayer.getPosition()).toBe(0);
  });

  it('advances at speed x wall-clock while playing', async () => {
    const { p, ctx, source } = await startPlay('clip.wav', { startOffset: 2, speed: 2 });
    ctx.currentTime += 3; // 3s of ctx time elapsed at 2x
    // 2 (offset) + 3 * 2 = 8
    expect(audioFilePlayer.getPosition()).toBe(8);
    source.__fireEnded();
    await p;
  });

  it('holds the seek offset while decoding (context set, source not yet started)', async () => {
    // Make decode hang so the source is never created for this session.
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const ctxSpy = () => {
      const c = bag.makeCtx();
      c.decodeAudioData = async () => {
        await gate;
        return { duration: bag.decodeBufferDuration, getChannelData: () => bag.decodeSamples };
      };
      return c;
    };
    const RNAudio = require('react-native-audio-api');
    (RNAudio.AudioContext as jest.Mock).mockImplementationOnce(ctxSpy);

    const p = audioFilePlayer.play('clip.wav', { startOffset: 5 });
    await flush();
    // Decoding: ctx exists, source not started -> getPosition returns the seek offset.
    expect(audioFilePlayer.getPosition()).toBe(5);
    release();
    await flush();
    await flush();
    ctxHandles[ctxHandles.length - 1].__lastSource?.__fireEnded();
    await p;
  });
});

describe('AudioFilePlayer setSpeed', () => {
  it('setSpeed with no active source takes the no-op branch (no crash, no position rebase)', () => {
    // No source and no ctx: the guard `if (!this.source)` returns before touching
    // `this.ctx!` — proving it does NOT deref a null context or rebase the clock.
    expect(() => audioFilePlayer.setSpeed(1.5)).not.toThrow();
    expect(audioFilePlayer.getPosition()).toBe(0);
  });

  it('rebases position and applies rate live when a source is active', async () => {
    const { p, ctx, source } = await startPlay('clip.wav', { speed: 1 });
    ctx.currentTime += 2; // played 2s at 1x -> position 2
    audioFilePlayer.setSpeed(3);
    // Rebased: startOffset becomes 2, clock reset to now.
    expect(source.playbackRate.value).toBe(3);
    ctx.currentTime += 1; // 1 more ctx second at 3x -> +3
    expect(audioFilePlayer.getPosition()).toBe(5);
    source.__fireEnded();
    await p;
  });
});

describe('AudioFilePlayer pause / resume', () => {
  it('pause suspends the context and stops isPlaying, but stays active', async () => {
    const { p, ctx, source } = await startPlay();
    audioFilePlayer.pause();
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    expect(audioFilePlayer.isPlaying()).toBe(false);
    expect(audioFilePlayer.isActive()).toBe(true);
    source.__fireEnded();
    await p;
  });

  it('pause is a no-op when already paused (guard branch)', async () => {
    const { p, ctx, source } = await startPlay();
    audioFilePlayer.pause();
    audioFilePlayer.pause();
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    source.__fireEnded();
    await p;
  });

  it('resume resumes the context and restores isPlaying', async () => {
    const { p, ctx, source } = await startPlay();
    audioFilePlayer.pause();
    ctx.resume.mockClear();
    audioFilePlayer.resume();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(audioFilePlayer.isPlaying()).toBe(true);
    source.__fireEnded();
    await p;
  });

  it('resume is a no-op when not paused (guard branch)', async () => {
    const { p, ctx, source } = await startPlay();
    ctx.resume.mockClear();
    audioFilePlayer.resume(); // not paused
    expect(ctx.resume).not.toHaveBeenCalled();
    source.__fireEnded();
    await p;
  });
});

describe('AudioFilePlayer stop', () => {
  it('stops the source and clears active/playing (context stays warm)', async () => {
    const { p, source } = await startPlay();
    audioFilePlayer.stop();
    expect(source.__stopped).toBe(true);
    expect(audioFilePlayer.isActive()).toBe(false);
    expect(audioFilePlayer.isPlaying()).toBe(false);
    // The still-pending play promise resolves when the (now orphaned) source ends.
    source.__fireEnded();
    await p;
  });

  it('a stop during decode aborts the session: the source never starts and play() still resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const RNAudio = require('react-native-audio-api');
    (RNAudio.AudioContext as jest.Mock).mockImplementationOnce(() => {
      const c = bag.makeCtx();
      c.decodeAudioData = async () => {
        await gate;
        return { duration: bag.decodeBufferDuration, getChannelData: () => bag.decodeSamples };
      };
      return c;
    });
    const p = audioFilePlayer.play('clip.wav');
    await flush();
    audioFilePlayer.stop(); // bumps sessionId while decoding
    release();
    await p; // resolves via the stale-session early return in _playBuffer
    const ctx = ctxHandles[ctxHandles.length - 1];
    // Source was never created for the aborted session.
    expect(ctx.__lastSource).toBeNull();
    expect(audioFilePlayer.isActive()).toBe(false);
  });

  it('onEnded callback does NOT fire when stopped mid-play (stale session)', async () => {
    const onEnded = jest.fn();
    const { p, source } = await startPlay('clip.wav', { onEnded });
    audioFilePlayer.stop(); // session bumped
    source.__fireEnded(); // resolves the promise but session is stale
    await p;
    expect(onEnded).not.toHaveBeenCalled();
  });
});

describe('AudioFilePlayer start failure', () => {
  it('rejects and clears the source when source.start throws (catch branch)', async () => {
    bag.startShouldThrow = true;
    const onEnded = jest.fn();
    const onStart = jest.fn();
    await expect(audioFilePlayer.play('bad.wav', { onEnded, onStart })).rejects.toThrow('bad offset');
    // A failed start must clear the source so isActive/isPlaying report false.
    expect(audioFilePlayer.isActive()).toBe(false);
    expect(audioFilePlayer.isPlaying()).toBe(false);
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
  });
});

describe('AudioFilePlayer resetContext', () => {
  it('closes the warm context so the next play builds a fresh one', async () => {
    const a = await startPlay('one.wav');
    a.source.__fireEnded();
    await a.p;
    const warm = ctxHandles[ctxHandles.length - 1];
    const countBefore = ctxHandles.length;

    audioFilePlayer.resetContext();
    expect(warm.close).toHaveBeenCalled();

    const b = await startPlay('two.wav');
    // A brand-new context was constructed after reset.
    expect(ctxHandles.length).toBe(countBefore + 1);
    b.source.__fireEnded();
    await b.p;
  });

  it('getPosition returns 0 again after resetContext (context nulled)', async () => {
    const { p, source } = await startPlay();
    source.__fireEnded();
    await p;
    audioFilePlayer.resetContext();
    expect(audioFilePlayer.getPosition()).toBe(0);
  });
});
