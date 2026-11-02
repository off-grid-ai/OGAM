/**
 * speechDevice — the device under the app's speech stack, for tests that run the REAL Kokoro engine.
 *
 * Everything that is ours runs for real: the TTS store, the playback machine, the streaming-speech
 * coordinator, the file player, the engine registry, the Kokoro engine and its executorch bridge
 * (mounted by the real EngineBridge), the residency manager and the hardware service.
 *
 * Faked, at the device edge only:
 *  - `react-native-audio-api`: the audio output. Each AudioContext keeps its own clock, which moves
 *    only when the test plays time (`output.play(seconds)`) and only while the context is running.
 *    A buffer source ends (fires onEnded) once its audio has played out. Saved files decode to the
 *    duration the test put on the device (`output.files`).
 *  - `react-native-executorch`'s `useTextToSpeech`: the speech runtime. It records each synthesis
 *    request, and by default answers with one chunk of audio. The test can make the next request
 *    hang (a wedged runtime) or fail, and can hold a model load or fail it.
 *  - ExecuTorch's resource cache (installKokoroResourceBoundary) and RAM (installNativeBoundary).
 *
 * The fakes decide nothing: they produce audio, advance a clock and record what reached them.
 */
import { installNativeBoundary, requireRTL, GB, type NativeBoundary, type RamProfile } from './nativeBoundary';
import { installKokoroResourceBoundary } from './kokoroResourceBoundary';

export const SAMPLE_RATE = 24000;

// ── Audio output (react-native-audio-api) ────────────────────────────────────────────────────────

export interface FakeBufferSource {
  buffer: { duration: number } | null;
  playbackRate: { value: number };
  onEnded: null | (() => void);
  /** The context this source plays on. */
  context: FakeAudioContext;
  /** Offset into the buffer (seconds) it was started at; null until start(). */
  offset: number | null;
  /** Buffer seconds played so far. */
  played: number;
  ended: boolean;
  stopped: boolean;
  connect(): void;
  start(when?: number, offset?: number): void;
  stop(): void;
}

export interface FakeAudioContext {
  sampleRate: number;
  currentTime: number;
  state: 'suspended' | 'running' | 'closed';
  destination: object;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  createBuffer(channels: number, length: number, rate: number): { duration: number };
  createBufferSource(): FakeBufferSource;
  decodeAudioData(src: unknown): Promise<{ duration: number; getChannelData: () => Float32Array }>;
}

export interface AudioOutput {
  /** Saved files on the device: path → decoded duration in seconds, or the error decoding raises. */
  files: Map<string, number | Error>;
  contexts: FakeAudioContext[];
  sources: FakeBufferSource[];
  /** Sources started and still sounding (not ended, not stopped, context not closed). */
  sounding(): FakeBufferSource[];
  /** Let `seconds` of wall time pass on every running context. Sources that play out end. */
  play(seconds: number): void;
}

/** Replace the audio output with a clocked fake. Call after installNativeBoundary (fresh graph). */
export function installAudioOutput(): AudioOutput {
  const output: AudioOutput = {
    files: new Map(),
    contexts: [],
    sources: [],
    sounding: () =>
      output.sources.filter(s => s.offset !== null && !s.ended && !s.stopped && s.context.state !== 'closed'),
    play(seconds: number) {
      for (const ctx of output.contexts) {
        if (ctx.state !== 'running') continue;
        ctx.currentTime += seconds;
        for (const source of output.sources) {
          if (source.context !== ctx || source.offset === null || source.ended || source.stopped) continue;
          source.played += seconds * source.playbackRate.value;
          const length = (source.buffer?.duration ?? 0) - source.offset;
          if (source.played >= length - 1e-9) {
            source.ended = true;
            source.onEnded?.();
          }
        }
      }
    },
  };

  class AudioContext implements FakeAudioContext {
    sampleRate: number;
    currentTime = 0;
    state: FakeAudioContext['state'] = 'suspended';
    destination = {};
    constructor(opts?: { sampleRate?: number }) {
      this.sampleRate = opts?.sampleRate ?? 44100;
      output.contexts.push(this);
    }
    async resume() { if (this.state !== 'closed') this.state = 'running'; }
    async suspend() { if (this.state === 'running') this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
    createBuffer(_channels: number, length: number, rate: number) {
      return { duration: length / rate, copyToChannel: () => {} };
    }
    createBufferSource(): FakeBufferSource {
      const source: FakeBufferSource = {
        buffer: null,
        playbackRate: { value: 1 },
        onEnded: null,
        context: this,
        offset: null,
        played: 0,
        ended: false,
        stopped: false,
        connect: () => {},
        start(_when = 0, offset = 0) {
          if (source.context.state === 'closed') throw new Error('AudioContext is closed');
          source.offset = offset;
        },
        stop() {
          if (source.stopped || source.ended) return;
          source.stopped = true;
          // Web Audio: a stopped source still reports that it ended.
          source.onEnded?.();
        },
      };
      output.sources.push(source);
      return source;
    }
    async decodeAudioData(src: unknown) {
      const path = String(src).replace(/^file:\/\//, '');
      const file = output.files.get(path);
      if (file instanceof Error) throw file;
      if (file === undefined) throw new Error(`No audio file at ${path}`);
      return { duration: file, getChannelData: () => new Float32Array(16).fill(0.5) };
    }
  }

  require('react-native-audio-api').AudioContext = AudioContext;
  return output;
}

// ── Speech runtime (react-native-executorch useTextToSpeech) ─────────────────────────────────────

/** How the runtime answers one synthesis request. */
export type SpeechReply =
  /** Synthesize this many seconds of audio, as one chunk. */
  | { seconds: number }
  /** A wedged runtime: nothing is produced and the request never settles. */
  | 'hang'
  /** The runtime rejects the request. */
  | Error;

export interface SpeechRuntime {
  /** Every synthesis request that reached the runtime, in order. */
  spoken: Array<{ voice: string; text: string }>;
  /** How many times the app told the runtime to stop streaming. */
  stops: number;
  /** Voices the runtime is loaded with right now (one per mounted hook that is not preventLoad). */
  loaded(): string[];
  /** Queue how the next requests are answered (default: one second of audio each). */
  reply(...replies: SpeechReply[]): void;
  /** Model loads stay in progress (not ready) until `finishLoad()`. */
  holdLoad(): void;
  finishLoad(): void;
  /** Model loads report this runtime error instead of becoming ready. */
  failLoad(message: string): void;
}

/** Replace the executorch speech hook with a recording runtime. Call after installNativeBoundary. */
export function installSpeechRuntime(): SpeechRuntime {
  const replies: SpeechReply[] = [];
  const mounted = new Map<symbol, string>();
  const rerenders = new Set<() => void>();
  let loadHeld = false;
  let loadError: string | null = null;
  const runtime: SpeechRuntime = {
    spoken: [],
    stops: 0,
    loaded: () => [...mounted.values()],
    reply: (...next) => { replies.push(...next); },
    holdLoad: () => { loadHeld = true; },
    finishLoad: () => {
      loadHeld = false;
      rerenders.forEach(rerender => rerender());
    },
    failLoad: (message: string) => {
      loadError = message;
      rerenders.forEach(rerender => rerender());
    },
  };

  const executorch = require('react-native-executorch/legacy');
  function useTextToSpeech(config: { voiceSource?: string }, opts?: { preventLoad?: boolean }) {
    const React = require('react');
    const voice = /\/([^/]+)\.[^/.]+$/.exec(String(config.voiceSource))?.[1] ?? String(config.voiceSource);
    const [, setTick] = React.useState(0);
    const [id] = React.useState(() => Symbol(voice));
    const preventLoad = !!opts?.preventLoad;
    const ready = !preventLoad && !loadHeld && !loadError;
    React.useEffect(() => {
      const rerender = () => setTick((n: number) => n + 1);
      rerenders.add(rerender);
      return () => { rerenders.delete(rerender); };
    }, []);
    React.useEffect(() => {
      if (ready) mounted.set(id, voice);
      return () => { mounted.delete(id); };
    }, [ready, id, voice]);
    const error = preventLoad ? null : loadError;
    return React.useMemo(() => ({
      isReady: ready,
      downloadProgress: ready ? 1 : 0,
      error,
      stream: async ({ text, onNext, onEnd }: {
        text: string;
        onNext: (chunk: Float32Array) => Promise<void> | void;
        onEnd?: () => Promise<void> | void;
      }) => {
        runtime.spoken.push({ voice, text });
        const answer = replies.shift() ?? { seconds: 1 };
        if (answer === 'hang') return new Promise<void>(() => {});
        if (answer instanceof Error) throw answer;
        // executorch hands over the next chunk only once the previous onNext settled.
        await onNext(new Float32Array(Math.round(answer.seconds * SAMPLE_RATE)));
        await onEnd?.();
      },
      streamStop: () => { runtime.stops += 1; },
    }), [ready, error, voice]);
  }
  executorch.useTextToSpeech = useTextToSpeech;
  return runtime;
}

// ── Launch ───────────────────────────────────────────────────────────────────────────────────────

export interface SpeechLaunchOptions {
  /** RAM the device reports. Default: a 12 GB Android phone with 8 GB free. */
  ram?: RamProfile;
  /** Choose Kokoro (as the voice screens do). Default true; false leaves no active engine. */
  selectEngine?: boolean;
  /** Download Kokoro through the store and wait for the engine to read ready. Default true. */
  download?: boolean;
  /** ExecuTorch cache files from a previous launch (relaunch over the same device). */
  files?: Set<string>;
  /** Keep the app storage a previous launch wrote. Default false (a fresh install). */
  preserveStorage?: boolean;
}

/** Start the speech stack on a fresh module graph, with the engine's bridge mounted by EngineBridge. */
export async function launchSpeech(options: SpeechLaunchOptions = {}) {
  const boundary: NativeBoundary = installNativeBoundary({
    ram: options.ram ?? { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  const cache = installKokoroResourceBoundary(options.files);
  const output = installAudioOutput();
  const runtime = installSpeechRuntime();
  const storage = require('@react-native-async-storage/async-storage');
  if (!options.preserveStorage) await storage.removeItem('tts-store');

  const React = require('react');
  const rtl = requireRTL();
  const { useTTSStore } = require('@offgrid/pro/audio/ttsStore') as typeof import('@offgrid/pro/audio/ttsStore');
  const { EngineBridge } = require('@offgrid/pro/audio/ui/EngineBridge') as typeof import('@offgrid/pro/audio/ui/EngineBridge');
  const { ttsRegistry } = require('@offgrid/pro/audio/engine') as typeof import('@offgrid/pro/audio/engine');
  const streaming = require('@offgrid/pro/audio/streamingSpeech') as typeof import('@offgrid/pro/audio/streamingSpeech');
  const { modelResidencyManager } = require('@offgrid/core/services/modelResidency') as
    typeof import('@offgrid/core/services/modelResidency');
  const store = () => useTTSStore.getState();

  // The persisted settings are read before anything uses them, as at app start.
  await rtl.act(async () => { await useTTSStore.persist.rehydrate(); });
  const selectEngine = options.selectEngine ?? true;
  const download = selectEngine && (options.download ?? true);
  if (selectEngine) await rtl.act(async () => { await store().setEngine('kokoro'); });
  if (download) await rtl.act(async () => { await store().downloadModels(); });

  const view = rtl.render(React.createElement(EngineBridge));
  if (download) await rtl.waitFor(() => expect(store().isReady).toBe(true));

  /** Let pending promise callbacks and React updates run. */
  const settle = async () => {
    await rtl.act(async () => {
      for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve));
    });
  };

  /**
   * Run an app action that may mount the engine's bridge while it is pending (a model load waits for
   * the bridge to attach). Awaiting it inside one act() would hold React's updates until the act
   * ends, so the bridge could never mount; instead the app renders while the action runs.
   */
  async function run<T>(task: () => Promise<T>): Promise<T> {
    let outcome: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
    await rtl.act(async () => {
      task().then(value => { outcome = { ok: true, value }; }, error => { outcome = { ok: false, error }; });
    });
    await rtl.waitFor(() => expect(outcome).toBeDefined());
    const settled = outcome!;
    if (!settled.ok) throw settled.error;
    return settled.value;
  }

  return {
    boundary,
    cache,
    run,
    output,
    runtime,
    rtl,
    view,
    store,
    useTTSStore,
    streaming,
    residency: modelResidencyManager,
    engine: () => ttsRegistry.getActiveEngine(),
    settle,
    /** Play `seconds` of audio, then let the app react to what ended. */
    async play(seconds: number) {
      await rtl.act(async () => { output.play(seconds); });
      await settle();
    },
    /** What the runtime was asked to say, in order. */
    said: () => runtime.spoken.map(request => request.text),
    async close() {
      await rtl.act(async () => { store().stop(); });
      view.unmount();
    },
  };
}

export type SpeechApp = Awaited<ReturnType<typeof launchSpeech>>;
