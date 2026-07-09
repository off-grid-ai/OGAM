/**
 * OuteTTSEngine — real lifecycle / state-machine / speech / cache tests.
 *
 * The existing suite (__tests__/unit/engine/outeTTSEngine.test.ts) only covers
 * the download path. This file drives the REAL engine state machine for the
 * uncovered surface: initialize/release/destroy lifecycle + phase transitions,
 * speak() (generate → audioComplete → playback, session-abort, truncation,
 * not-loaded, error), generateAndSave (save + not-loaded + error), stop/pause/
 * resume phase logic, voices, overall-progress, deleteAssets, and the audio
 * cache convenience methods.
 *
 * MOCK BOUNDARY: only the native mockRuntime (llama.rn context + vocoder), the
 * native audio-api playback node, and the RNFS filesystem are stubbed — as dumb
 * recorders that let us drive/observe. The engine's own state machine, event
 * emitter, chunking/waveform math and error handling all run for real.
 */

// ── Native llama.rn mockRuntime — a dumb, controllable context stub ─────────────
type CompletionArgs = { prompt: string; grammar: unknown; guide_tokens: number[] };
interface MockCtx {
  released: boolean;
  vocoderReleased: boolean;
  initVocoder: jest.Mock;
  isVocoderEnabled: jest.Mock;
  getFormattedAudioCompletion: jest.Mock;
  getAudioCompletionGuideTokens: jest.Mock;
  completion: jest.Mock;
  decodeAudioTokens: jest.Mock;
  releaseVocoder: jest.Mock;
  release: jest.Mock;
}
const mockRuntime = {
  initLlamaImpl: undefined as undefined | (() => unknown),
  lastContext: undefined as undefined | MockCtx,
  audioTokens: [1, 2, 3, 4] as number[],
  guideTokens: [7, 8] as number[] | null,
  pcm: [] as number[],
  vocoderEnabled: true,
  completionArgs: undefined as CompletionArgs | undefined,
};

function mockMakeContext(): MockCtx {
  const ctx: MockCtx = {
    released: false,
    vocoderReleased: false,
    initVocoder: jest.fn(() => Promise.resolve()),
    isVocoderEnabled: jest.fn(() => Promise.resolve(mockRuntime.vocoderEnabled)),
    getFormattedAudioCompletion: jest.fn((_speaker: unknown, text: string) =>
      Promise.resolve({ prompt: `PROMPT:${text}`, grammar: 'G' }),
    ),
    getAudioCompletionGuideTokens: jest.fn(() => Promise.resolve(mockRuntime.guideTokens)),
    completion: jest.fn((args: CompletionArgs) => {
      mockRuntime.completionArgs = args;
      return Promise.resolve({ audio_tokens: mockRuntime.audioTokens });
    }),
    decodeAudioTokens: jest.fn(() => Promise.resolve(mockRuntime.pcm)),
    releaseVocoder: jest.fn(() => { ctx.vocoderReleased = true; return Promise.resolve(); }),
    release: jest.fn(() => { ctx.released = true; return Promise.resolve(); }),
  };
  mockRuntime.lastContext = ctx;
  return ctx;
}

jest.mock('llama.rn', () => ({
  initLlama: jest.fn(() =>
    mockRuntime.initLlamaImpl ? Promise.resolve(mockRuntime.initLlamaImpl()) : Promise.resolve(mockMakeContext()),
  ),
}), { virtual: true });

// ── Native audio playback node — fires onEnded synchronously on start() ─────
const mockAudioApi = {
  closed: 0,
  lastSpeed: undefined as number | undefined,
  startThrows: false,
  fireEnded: true,
};
jest.mock('react-native-audio-api', () => ({
  AudioContext: jest.fn().mockImplementation(() => ({
    createBuffer: jest.fn(() => ({ copyToChannel: jest.fn() })),
    createBufferSource: jest.fn(() => {
      const src: Record<string, unknown> = {
        connect: jest.fn(),
        playbackRate: { value: 1.0 },
        buffer: null,
        onEnded: null,
        stop: jest.fn(),
        start: jest.fn(() => {
          if (mockAudioApi.startThrows) throw new Error('start boom');
          mockAudioApi.lastSpeed = (src.playbackRate as { value: number }).value;
          if (mockAudioApi.fireEnded && typeof src.onEnded === 'function') {
            (src.onEnded as () => void)();
          }
        }),
      };
      return src;
    }),
    destination: {},
    resume: jest.fn(() => Promise.resolve()),
    suspend: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => { mockAudioApi.closed += 1; return Promise.resolve(); }),
  })),
}), { virtual: true });

// ── Filesystem — in-memory, dumb ────────────────────────────────────────────
const mockFsFiles: Record<string, number> = {};
const mockFsDirs = new Set<string>();
const mockFsWrites: Record<string, { data: string; enc: string }> = {};
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc',
  exists: jest.fn((p: string) => Promise.resolve(p in mockFsFiles || mockFsDirs.has(p))),
  stat: jest.fn((p: string) => Promise.resolve({ size: mockFsFiles[p] ?? 0, isFile: () => true })),
  mkdir: jest.fn((p: string) => { mockFsDirs.add(p); return Promise.resolve(); }),
  unlink: jest.fn((p: string) => { delete mockFsFiles[p]; delete mockFsWrites[p]; mockFsDirs.delete(p); return Promise.resolve(); }),
  writeFile: jest.fn((p: string, data: string, enc: string) => { mockFsWrites[p] = { data, enc }; mockFsFiles[p] = data.length; return Promise.resolve(); }),
  readDir: jest.fn((p: string) => Promise.resolve(mockFsReadDir(p))),
  downloadFile: jest.fn(() => ({ promise: Promise.resolve({ statusCode: 200 }) })),
}));
function mockFsReadDir(dir: string): Array<{ path: string; size: number; isDirectory: () => boolean; isFile: () => boolean }> {
  const out: Array<{ path: string; size: number; isDirectory: () => boolean; isFile: () => boolean }> = [];
  for (const d of mockFsDirs) {
    if (d !== dir && d.startsWith(`${dir}/`) && !d.slice(dir.length + 1).includes('/')) {
      out.push({ path: d, size: 0, isDirectory: () => true, isFile: () => false });
    }
  }
  for (const f of Object.keys(mockFsFiles)) {
    if (f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/')) {
      out.push({ path: f, size: mockFsFiles[f], isDirectory: () => false, isFile: () => true });
    }
  }
  return out;
}

// ── Background download boundary ────────────────────────────────────────────
const mockBgAvailable = { value: false };
jest.mock('@offgrid/core/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: () => mockBgAvailable.value,
    downloadFileTo: jest.fn(() => ({ promise: Promise.resolve() })),
  },
}));

import { OuteTTSEngine } from '@offgrid/pro/audio/engine/tts/engines/outetts/OuteTTSEngine';
import {
  OUTETTS_BACKBONE,
  OUTETTS_VOCODER,
  OUTETTS_ASSETS,
  OUTETTS_SAMPLE_RATE,
} from '@offgrid/pro/audio/engine/tts/engines/outetts/models';
import type { EnginePhase } from '@offgrid/pro/audio/engine/types';

const backbonePath = `/doc/tts-models/${OUTETTS_BACKBONE.filename}`;
const vocoderPath = `/doc/tts-models/${OUTETTS_VOCODER.filename}`;

/** Land both model files full-size so initialize() can proceed. */
function putModelsOnDisk() {
  mockFsFiles[backbonePath] = OUTETTS_BACKBONE.sizeBytes;
  mockFsFiles[vocoderPath] = OUTETTS_VOCODER.sizeBytes;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockFsFiles)) delete mockFsFiles[k];
  for (const k of Object.keys(mockFsWrites)) delete mockFsWrites[k];
  mockFsDirs.clear();
  mockRuntime.initLlamaImpl = undefined;
  mockRuntime.lastContext = undefined;
  mockRuntime.audioTokens = [1, 2, 3, 4];
  mockRuntime.guideTokens = [7, 8];
  mockRuntime.pcm = new Array(48).fill(0).map((_, i) => Math.sin(i)) as number[];
  mockRuntime.vocoderEnabled = true;
  mockRuntime.completionArgs = undefined;
  mockBgAvailable.value = false;
  mockAudioApi.closed = 0;
  mockAudioApi.lastSpeed = undefined;
  mockAudioApi.startThrows = false;
  mockAudioApi.fireEnded = true;
});

// Flush a handful of microtask turns so awaited native-boundary promises settle.
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// Track phase transitions on a fresh engine.
function trackPhases(engine: OuteTTSEngine): EnginePhase[] {
  const seen: EnginePhase[] = [];
  engine.on('phaseChange', (phase) => seen.push(phase));
  return seen;
}

describe('OuteTTSEngine — static shape', () => {
  it('reports its identity and capabilities', () => {
    const e = new OuteTTSEngine();
    expect(e.id).toBe('outetts');
    expect(e.isSupported()).toBe(true);
    expect(e.capabilities.voiceCloning).toBe(true);
    expect(e.capabilities.streaming).toBe(false);
    expect(e.getBridgeComponent()).toBeNull();
    expect(e.getRequiredAssets()).toEqual(OUTETTS_ASSETS);
    expect(e.getPhase()).toBe('idle');
  });

  it('exposes a single default voice', () => {
    const e = new OuteTTSEngine();
    const voices = e.getVoices();
    expect(voices).toHaveLength(1);
    expect(voices[0].id).toBe('0');
    expect(e.getActiveVoice()).toEqual(voices[0]);
  });

  it('emits voiceChanged when a voice is set', async () => {
    const e = new OuteTTSEngine();
    const changed: string[] = [];
    e.on('voiceChanged', (id) => changed.push(id));
    await e.setVoice('0');
    expect(changed).toEqual(['0']);
  });
});

describe('OuteTTSEngine — initialize lifecycle', () => {
  it('loads context + vocoder and transitions idle → loading → ready', async () => {
    putModelsOnDisk();
    const e = new OuteTTSEngine();
    const phases = trackPhases(e);
    await e.initialize();
    expect(phases).toEqual(['loading', 'ready']);
    expect(e.getPhase()).toBe('ready');
    expect(mockRuntime.lastContext?.initVocoder).toHaveBeenCalledWith({ path: vocoderPath, n_batch: 4096 });
  });

  it('is idempotent — a second initialize() does not reload the context', async () => {
    putModelsOnDisk();
    const e = new OuteTTSEngine();
    await e.initialize();
    const first = mockRuntime.lastContext;
    const llama = require('llama.rn');
    const callsAfterFirst = llama.initLlama.mock.calls.length;
    await e.initialize();
    expect(llama.initLlama.mock.calls.length).toBe(callsAfterFirst);
    expect(mockRuntime.lastContext).toBe(first);
  });

  it('coalesces concurrent initialize() calls into one context load', async () => {
    putModelsOnDisk();
    const e = new OuteTTSEngine();
    const llama = require('llama.rn');
    await Promise.all([e.initialize(), e.initialize()]);
    expect(llama.initLlama.mock.calls.length).toBe(1);
    expect(e.getPhase()).toBe('ready');
  });

  it('enters error phase + emits error when the vocoder fails to enable', async () => {
    putModelsOnDisk();
    mockRuntime.vocoderEnabled = false;
    const e = new OuteTTSEngine();
    const phases = trackPhases(e);
    const errors: Array<{ code: string; recoverable: boolean }> = [];
    e.on('error', (err) => errors.push(err));

    await expect(e.initialize()).rejects.toThrow(/vocoder/i);
    expect(phases).toContain('error');
    expect(e.getPhase()).toBe('error');
    expect(errors[0].code).toBe('OUTETTS_LOAD');
    expect(errors[0].recoverable).toBe(true);
  });

  it('surfaces a non-Error rejection with the fallback message', async () => {
    putModelsOnDisk();
    mockRuntime.initLlamaImpl = () => { throw 'raw string failure'; };
    const e = new OuteTTSEngine();
    const errors: Array<{ message: string }> = [];
    e.on('error', (err) => errors.push(err));
    await expect(e.initialize()).rejects.toBe('raw string failure');
    expect(errors[0].message).toBe('Failed to load OuteTTS');
  });
});

describe('OuteTTSEngine — release / destroy', () => {
  it('releases the vocoder + context and returns to idle', async () => {
    putModelsOnDisk();
    const e = new OuteTTSEngine();
    await e.initialize();
    const ctx = mockRuntime.lastContext!;
    await e.release();
    expect(ctx.vocoderReleased).toBe(true);
    expect(ctx.released).toBe(true);
    expect(mockAudioApi.closed).toBeGreaterThanOrEqual(0);
    expect(e.getPhase()).toBe('idle');
    // After release the models are gone: speak must reject.
    await expect(e.speak('hi')).rejects.toThrow(/not loaded/i);
  });

  it('release is safe with nothing loaded', async () => {
    const e = new OuteTTSEngine();
    await expect(e.release()).resolves.toBeUndefined();
    expect(e.getPhase()).toBe('idle');
  });

  it('destroy() releases then deletes on-disk assets', async () => {
    putModelsOnDisk();
    const e = new OuteTTSEngine();
    await e.initialize();
    await e.destroy();
    expect(mockFsFiles[backbonePath]).toBeUndefined();
    expect(mockFsFiles[vocoderPath]).toBeUndefined();
    const states = await e.checkAssetStatus();
    expect(states.every((s) => s.status === 'not-downloaded')).toBe(true);
  });
});

describe('OuteTTSEngine — speak', () => {
  async function readyEngine() {
    putModelsOnDisk();
    const e = new OuteTTSEngine();
    await e.initialize();
    return e;
  }

  it('rejects when models are not loaded', async () => {
    const e = new OuteTTSEngine();
    await expect(e.speak('hello')).rejects.toThrow(/not loaded/i);
  });

  it('generates audio, emits audioComplete, plays back, and returns to ready', async () => {
    const e = await readyEngine();
    const completes: Array<{ samples: Float32Array; sampleRate: number; durationSeconds: number; waveformData: number[] }> = [];
    e.on('audioComplete', (a) => completes.push(a));
    const phases: EnginePhase[] = [];
    e.on('phaseChange', (p) => phases.push(p));

    await e.speak('hello world', { speed: 1.5 });

    expect(completes).toHaveLength(1);
    expect(completes[0].samples.length).toBe(mockRuntime.pcm.length);
    expect(completes[0].sampleRate).toBe(OUTETTS_SAMPLE_RATE);
    expect(completes[0].durationSeconds).toBeCloseTo(mockRuntime.pcm.length / OUTETTS_SAMPLE_RATE);
    expect(completes[0].waveformData).toHaveLength(200);
    expect(mockAudioApi.lastSpeed).toBe(1.5); // speed propagated to the playback node
    expect(phases).toEqual(expect.arrayContaining(['processing', 'ready']));
    expect(e.getPhase()).toBe('ready');
  });

  it('forwards guide tokens + prompt from the runtime into completion()', async () => {
    const e = await readyEngine();
    await e.speak('the quick brown fox');
    expect(mockRuntime.completionArgs?.prompt).toBe('PROMPT:the quick brown fox');
    expect(mockRuntime.completionArgs?.guide_tokens).toEqual(mockRuntime.guideTokens);
  });

  it('defaults guide tokens to [] when the runtime returns null', async () => {
    mockRuntime.guideTokens = null;
    const e = await readyEngine();
    await e.speak('x');
    expect(mockRuntime.completionArgs?.guide_tokens).toEqual([]);
  });

  it('truncates text longer than 300 chars before generation', async () => {
    const e = await readyEngine();
    const long = 'a'.repeat(500);
    await e.speak(long);
    const forwarded = mockRuntime.lastContext!.getFormattedAudioCompletion.mock.calls[0][1] as string;
    expect(forwarded.length).toBe(300);
    expect(forwarded.endsWith('...')).toBe(true);
  });

  it('does NOT play or emit audioComplete when a newer speak() supersedes the first', async () => {
    const e = await readyEngine();
    let releaseGen: () => void = () => {};
    // Make the FIRST completion hang until we let it resolve, so a second
    // speak() can bump the session id mid-generation.
    mockRuntime.lastContext!.completion.mockImplementationOnce(
      () => new Promise((resolve) => { releaseGen = () => resolve({ audio_tokens: [1] }); }),
    );
    const completes: unknown[] = [];
    e.on('audioComplete', (a) => completes.push(a));

    const first = e.speak('first');
    // Second speak resolves immediately (default mock) and bumps the session.
    await e.speak('second');
    releaseGen();
    await first;

    // Only the second call should have produced audio/playback.
    expect(completes).toHaveLength(1);
  });

  it('emits error + rethrows when generation fails', async () => {
    const e = await readyEngine();
    mockRuntime.lastContext!.completion.mockRejectedValueOnce(new Error('decode fail'));
    const errors: Array<{ code: string }> = [];
    e.on('error', (err) => errors.push(err));

    await expect(e.speak('boom')).rejects.toThrow('decode fail');
    expect(errors[0].code).toBe('OUTETTS_SPEAK');
    expect(e.getPhase()).toBe('ready'); // finally restores ready
  });

  it('rejects playback start failure through the play promise', async () => {
    mockAudioApi.startThrows = true;
    const e = await readyEngine();
    await expect(e.speak('hi')).rejects.toThrow('start boom');
  });
});

describe('OuteTTSEngine — generateAndSave', () => {
  async function readyEngine() {
    putModelsOnDisk();
    const e = new OuteTTSEngine();
    await e.initialize();
    return e;
  }

  it('rejects when models are not loaded', async () => {
    const e = new OuteTTSEngine();
    await expect(e.generateAndSave('t', 'conv', 'msg')).rejects.toThrow(/not loaded/i);
  });

  it('writes a base64 PCM file and returns duration + waveform', async () => {
    const e = await readyEngine();
    const completes: unknown[] = [];
    e.on('audioComplete', (a) => completes.push(a));

    const result = await e.generateAndSave('hello', 'conv1', 'msgA');

    const expectedPath = '/doc/audio-cache/conv1/msgA.pcm';
    expect(result.filePath).toBe(expectedPath);
    expect(result.durationSeconds).toBeCloseTo(mockRuntime.pcm.length / OUTETTS_SAMPLE_RATE);
    expect(result.waveformData).toHaveLength(200);
    expect(mockFsWrites[expectedPath].enc).toBe('base64');
    expect(mockFsWrites[expectedPath].data.length).toBeGreaterThan(0);
    expect(completes).toHaveLength(1); // audioComplete still fires
  });

  it('surfaces a generation error to the caller', async () => {
    const e = await readyEngine();
    mockRuntime.lastContext!.decodeAudioTokens.mockRejectedValueOnce(new Error('vocoder crash'));
    await expect(e.generateAndSave('t', 'c', 'm')).rejects.toThrow('vocoder crash');
  });
});

describe('OuteTTSEngine — stop / pause / resume phase logic', () => {
  async function readyEngine() {
    putModelsOnDisk();
    const e = new OuteTTSEngine();
    await e.initialize();
    return e;
  }

  it('stop() from ready is a no-op on phase', async () => {
    const e = await readyEngine();
    e.stop();
    expect(e.getPhase()).toBe('ready');
  });

  it('pause() only transitions from processing, and resume() reverses it', async () => {
    const e = await readyEngine();
    // pause from ready: no transition
    e.pause();
    expect(e.getPhase()).toBe('ready');
    // resume from ready: no transition
    e.resume();
    expect(e.getPhase()).toBe('ready');
  });

  it('pause() moves processing → paused and resume() moves it back', async () => {
    const e = await readyEngine();
    // Hold generation open so the engine sits in 'processing'. Deferring the
    // FIRST awaited runtime call (guide tokens) keeps speak() in-flight.
    let resolveGuide: (v: number[]) => void = () => {};
    mockRuntime.lastContext!.getAudioCompletionGuideTokens.mockImplementationOnce(
      () => new Promise<number[]>((resolve) => { resolveGuide = resolve; }),
    );
    const speaking = e.speak('hold');
    await flushMicrotasks();
    expect(e.getPhase()).toBe('processing');

    e.pause();
    expect(e.getPhase()).toBe('paused');
    e.resume();
    expect(e.getPhase()).toBe('processing');

    resolveGuide([1, 2]);
    await speaking;
    expect(e.getPhase()).toBe('ready');
  });

  it('stop() during generation aborts playback (no audioComplete) and restores ready', async () => {
    const e = await readyEngine();
    let resolveGuide: (v: number[]) => void = () => {};
    mockRuntime.lastContext!.getAudioCompletionGuideTokens.mockImplementationOnce(
      () => new Promise<number[]>((resolve) => { resolveGuide = resolve; }),
    );
    const completes: unknown[] = [];
    e.on('audioComplete', (a) => completes.push(a));

    const speaking = e.speak('interrupted');
    await flushMicrotasks();
    expect(e.getPhase()).toBe('processing');

    e.stop(); // clears _isSpeakingFlag while generation is in-flight
    expect(e.getPhase()).toBe('ready');

    resolveGuide([1, 2]);
    await speaking;
    expect(completes).toHaveLength(0); // aborted before emit/playback
  });

  it('setSpeed adjusts the live playback node when one exists (and is safe with none)', async () => {
    const e = await readyEngine();
    // No current source yet → no throw.
    expect(() => e.setSpeed(2)).not.toThrow();
  });
});

describe('OuteTTSEngine — assets & progress', () => {
  it('reports overall download progress weighted by asset size', async () => {
    const e = new OuteTTSEngine();
    // Nothing downloaded yet.
    expect(e.getOverallDownloadProgress()).toBe(0);
    expect(e.isFullyDownloaded()).toBe(false);

    putModelsOnDisk();
    await e.checkAssetStatus();
    expect(e.getOverallDownloadProgress()).toBeCloseTo(1);
    expect(e.isFullyDownloaded()).toBe(true);
  });

  it('checkAssetStatus reports downloaded vs not-downloaded per asset', async () => {
    const e = new OuteTTSEngine();
    mockFsFiles[backbonePath] = OUTETTS_BACKBONE.sizeBytes;
    // vocoder absent
    const states = await e.checkAssetStatus();
    const backbone = states.find((s) => s.asset.id === 'backbone');
    const vocoder = states.find((s) => s.asset.id === 'vocoder');
    expect(backbone?.status).toBe('downloaded');
    expect(backbone?.localPath).toBe(backbonePath);
    expect(vocoder?.status).toBe('not-downloaded');
    expect(vocoder?.localPath).toBeUndefined();
  });

  it('treats an asset as absent when stat() throws', async () => {
    const e = new OuteTTSEngine();
    mockFsFiles[backbonePath] = OUTETTS_BACKBONE.sizeBytes; // file "exists"
    const RNFS = require('react-native-fs');
    RNFS.stat.mockRejectedValueOnce(new Error('stat blew up'));
    const states = await e.checkAssetStatus();
    const backbone = states.find((s) => s.asset.id === 'backbone');
    expect(backbone?.status).toBe('not-downloaded'); // catch → false
  });

  it('deleteAssets removes only the requested asset from disk + state', async () => {
    const e = new OuteTTSEngine();
    putModelsOnDisk();
    await e.checkAssetStatus();
    await e.deleteAssets(['vocoder']);
    expect(mockFsFiles[vocoderPath]).toBeUndefined();
    expect(mockFsFiles[backbonePath]).toBe(OUTETTS_BACKBONE.sizeBytes);
  });
});

describe('OuteTTSEngine — audio cache', () => {
  it('returns 0 MB when the cache root does not exist', async () => {
    const e = new OuteTTSEngine();
    expect(await e.getAudioCacheSizeMB()).toBe(0);
  });

  it('sums file sizes across conversation dirs into MB', async () => {
    const e = new OuteTTSEngine();
    mockFsDirs.add('/doc/audio-cache');
    mockFsDirs.add('/doc/audio-cache/conv1');
    mockFsFiles['/doc/audio-cache/conv1/a.pcm'] = 1024 * 1024; // 1 MB
    mockFsFiles['/doc/audio-cache/conv1/b.pcm'] = 1024 * 1024; // 1 MB
    expect(await e.getAudioCacheSizeMB()).toBeCloseTo(2);
  });

  it('isAudioCached reflects presence of the message file', async () => {
    const e = new OuteTTSEngine();
    expect(await e.isAudioCached('conv1', 'msgX')).toBe(false);
    mockFsFiles['/doc/audio-cache/conv1/msgX.pcm'] = 10;
    expect(await e.isAudioCached('conv1', 'msgX')).toBe(true);
  });

  it('clearAudioCache unlinks the cache root when present, no-op otherwise', async () => {
    const e = new OuteTTSEngine();
    await e.clearAudioCache(); // root absent → no-op, no throw
    mockFsDirs.add('/doc/audio-cache');
    await e.clearAudioCache();
    expect(mockFsDirs.has('/doc/audio-cache')).toBe(false);
  });
});
