/**
 * nativeBoundary — the ONE shared "outside-our-system" boundary for UI-level integration tests.
 *
 * Taxonomy (per the team standard): an INTEGRATION test mocks ONLY what is outside our system —
 * native modules, the RAM sensor, the network/MCP transport, the clock. Everything we own — screens,
 * hooks, stores, services, the residency manager, parsing, the tool loop — runs FOR REAL on top.
 *
 * This module seeds that boundary once. The fakes are honest DATA SOURCES + ARG RECORDERS: they return
 * plain data (a token, a transcript, an image path, a RAM number) and record what they received. They
 * NEVER decide `fits` / parse / finalize — so a red test fails because OUR logic is wrong, not because a
 * mock was told to fail.
 *
 * Injection: RN captures `const { X } = NativeModules` at import and services are construct-time
 * singletons, so a fake must be on `NativeModules` BEFORE the service is required. We `jest.resetModules()`,
 * MUTATE the real `require('react-native').NativeModules` (not `jest.doMock('react-native')` wholesale — a
 * full screen must still mount without the DevMenu/TurboModule crash), THEN `require()` the services so
 * their module-scope destructure captures the fake. Proven in-tree by litertSamplerRedflow.test.ts.
 *
 * npm native packages (llama.rn, whisper.rn, react-native-fs, react-native-device-info,
 * react-native-zip-archive) are already `jest.mock`-ed in jest.setup.ts — we augment those handles here,
 * we do NOT add __mocks__/ files.
 *
 * Coexists with deviceMemory.ts: that harness spies `hardwareService.get*MemoryGB` for the PURE
 * modelResidencyManager budget tests. This harness seeds the leaf BELOW that (DeviceMemoryModule +
 * device-info) so the real budget math runs end-to-end from a mounted screen. Do not use both on one test.
 */

// ---------------------------------------------------------------------------
// Fake: LiteRTModule (Android litert engine). Destructured at import in src/services/litert.ts.
// A driveable event emitter + arg-recording methods. Native events: litert_token/thinking/complete/
// error/tool_call. loadModel resolves { backend, maxNumTokens }.
// ---------------------------------------------------------------------------

type Listener = (payload: unknown) => void;

/**
 * Require @testing-library/react-native AFTER installNativeBoundary()'s jest.resetModules() (so React +
 * RNTL + the component share one module graph). RNTL's index registers afterEach cleanup ON REQUIRE;
 * requiring it mid-run would throw "add a hook after tests started". We set RNTL_SKIP_AUTO_CLEANUP ONLY
 * for the duration of this synchronous require (restored immediately) so it never leaks to other suites
 * sharing this worker's process.env. Render tests use this instead of require('@testing-library/...').
 */
export function requireRTL(): typeof import('@testing-library/react-native') {
  const prev = process.env.RNTL_SKIP_AUTO_CLEANUP;
  process.env.RNTL_SKIP_AUTO_CLEANUP = 'true';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rtl = require('@testing-library/react-native');
    // Register THIS instance's cleanup on a global so jest.setup's afterEach can unmount the tree WITHOUT
    // requiring RTL fresh (requiring it fresh after a test's resetModules corrupts the module graph and
    // breaks the next test — a real regression). Only tests that render (call requireRTL) get cleaned up.
    (globalThis as unknown as { __RTL_CLEANUP__?: () => void }).__RTL_CLEANUP__ = rtl.cleanup;
    return rtl;
  } finally {
    if (prev === undefined) delete process.env.RNTL_SKIP_AUTO_CLEANUP;
    else process.env.RNTL_SKIP_AUTO_CLEANUP = prev;
  }
}

/** An in-JS stand-in for a native module's NativeEventEmitter surface. Drive events from the test. */
export interface FakeEmitterHandle {
  emit(event: string, payload?: unknown): void;
  listenerCount(event: string): number;
}

function makeEmitterRegistry() {
  const listeners = new Map<string, Set<Listener>>();
  const add = (event: string, cb: Listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
    return { remove: () => listeners.get(event)?.delete(cb) };
  };
  const handle: FakeEmitterHandle = {
    emit: (event, payload) => listeners.get(event)?.forEach(cb => cb(payload)),
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
  };
  return { add, handle };
}

/** One scripted native turn: optional tool calls the model "emits", then the final content/reasoning. */
export interface LiteRTTurn {
  /** Tool calls the native model emits (litert_tool_call). The REAL service runs them + respondToToolCall. */
  toolCalls?: Array<{ id?: string; name: string; arguments: Record<string, unknown> }>;
  /** Reasoning tokens emitted on the litert_thinking channel before completion. */
  reasoning?: string;
  /** Final content tokens emitted on litert_token before litert_complete. Empty ⇒ the model said nothing. */
  content?: string;
}

export interface LiteRTFake {
  module: Record<string, jest.Mock>;
  events: FakeEmitterHandle;
  /** Records of every generateRaw / sendMessage* call for arg assertions. */
  calls: { generateRaw: unknown[][]; resetConversation: unknown[][]; sendMessageWithMedia: unknown[][]; sendMessageWithImages: unknown[][] };
  /**
   * Script the native side of the NEXT turn: when our code calls sendMessage*, emit the tool calls
   * (which the real service dispatches to the real tool loop, then calls respondToToolCall), then on the
   * last respondToToolCall (or immediately if no tools) emit reasoning + content tokens + litert_complete.
   * Honest: the fake only emits device-shaped events; OUR loop decides what the user sees.
   */
  scriptTurn(turn: LiteRTTurn): void;
  /**
   * Script a QUEUE of turns consumed one-per-generateRaw — for flows with more than one native round
   * trip (e.g. the LiteRT tool-router does a separate generateToolSelection pass, THEN the main turn).
   */
  scriptTurns(turns: LiteRTTurn[]): void;
}

/** Run fn on a macrotask so it lands after the current async chain (native call → awaited resolve). */
const defer = (fn: () => void) => { setTimeout(fn, 0); };

function makeLiteRTFake(handle: FakeEmitterHandle): LiteRTFake {
  const calls: LiteRTFake['calls'] = { generateRaw: [], resetConversation: [], sendMessageWithMedia: [], sendMessageWithImages: [] };

  // Scripted turn state — set by scriptTurn()/scriptTurns(), consumed by the send/respond methods below.
  let pending: LiteRTTurn | null = null;
  const queue: LiteRTTurn[] = [];
  let currentTurn: LiteRTTurn | null = null; // the turn onSend picked (for respondToToolCall completion)
  let toolCallsRemaining = 0;

  const emitCompletion = (turn: LiteRTTurn) => {
    if (turn.reasoning) handle.emit('litert_thinking', turn.reasoning);
    if (turn.content) handle.emit('litert_token', turn.content);
    handle.emit('litert_complete', '{}');
  };

  const onSend = () => {
    const turn = queue.length ? queue.shift()! : pending;
    currentTurn = turn;
    if (!turn) { defer(() => handle.emit('litert_complete', '{}')); return; }
    const tcs = turn.toolCalls ?? [];
    toolCallsRemaining = tcs.length;
    if (tcs.length === 0) { defer(() => emitCompletion(turn)); return; }
    // Emit each tool call; the REAL service dispatches it and calls respondToToolCall.
    defer(() => tcs.forEach((tc, i) =>
      handle.emit('litert_tool_call', JSON.stringify({ id: tc.id ?? `tc-${i}`, name: tc.name, arguments: tc.arguments }))));
  };

  const module: Record<string, jest.Mock> = {
    loadModel: jest.fn().mockResolvedValue({ backend: 'gpu', maxNumTokens: 4096 }),
    resetConversation: jest.fn((...args: unknown[]) => { calls.resetConversation.push(args); return Promise.resolve(); }),
    sendMessage: jest.fn(() => { onSend(); return Promise.resolve(); }),
    sendMessageWithImages: jest.fn((...args: unknown[]) => { calls.sendMessageWithImages.push(args); onSend(); return Promise.resolve(); }),
    sendMessageWithAudio: jest.fn(() => { onSend(); return Promise.resolve(); }),
    sendMessageWithMedia: jest.fn((...args: unknown[]) => { calls.sendMessageWithMedia.push(args); onSend(); return Promise.resolve(); }),
    respondToToolCall: jest.fn(() => {
      // After the LAST tool result is delivered, the native model continues and completes.
      if (currentTurn && --toolCallsRemaining <= 0) { const turn = currentTurn; defer(() => emitCompletion(turn)); }
      return Promise.resolve();
    }),
    generateRaw: jest.fn((...args: unknown[]) => { calls.generateRaw.push(args); return Promise.resolve(''); }),
    stopGeneration: jest.fn().mockResolvedValue(undefined),
    unloadModel: jest.fn().mockResolvedValue(undefined),
    getMemoryInfo: jest.fn().mockResolvedValue({ totalRamMb: 12000, usedRamMb: 4000, availRamMb: 8000, gpuPrivateMb: 0, lowMemory: false }),
    // RN's NativeEventEmitter constructor calls addListener/removeListeners on the module on iOS.
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };

  return {
    module,
    events: handle,
    calls,
    scriptTurn: (turn: LiteRTTurn) => { pending = turn; },
    scriptTurns: (turns: LiteRTTurn[]) => { queue.length = 0; queue.push(...turns); },
  };
}

// ---------------------------------------------------------------------------
// Fake: llama.rn (the GGUF text engine, an npm native package globally jest.mock-ed in jest.setup).
// A scriptable llama context whose completion returns the exact model text (and/or structured
// tool_calls) the test wants, so the REAL llmService + generationToolLoop parse it. Tool-calling is
// enabled via a jinja caps stub so the loop keeps the tools.
// ---------------------------------------------------------------------------

export interface LlamaFake {
  /** Set the result the NEXT context.completion() resolves with (text drives the text tool-call parser).
   *  Pass { throwMessage } to make completion REJECT (e.g. a native context-overflow error). */
  scriptCompletion(result: { text?: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>; throwMessage?: string }): void;
  /** react-native module object to inject for 'llama.rn'. */
  module: Record<string, jest.Mock>;
  calls: { completion: unknown[][] };
}

function makeLlamaFake(): LlamaFake {
  const calls: LlamaFake['calls'] = { completion: [] };
  let pending: { text: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>; throwMessage?: string } = { text: '' };

  const context: Record<string, jest.Mock> = {
    // Faithful to llama.rn: completion(params, onToken) STREAMS token-by-token through the callback
    // (each call carries the delta `token` + the cumulative `content`, as the native lib does) BEFORE
    // resolving with the final result. This drives the REAL streaming render path (getStreamingDelta →
    // streamingMessage), not a single-shot final text. onToken stops being fed once isGenerating flips
    // false (a real stop), because the service's own callback guards on `data.token` + isGenerating.
    completion: jest.fn(async (params: unknown, onToken?: (data: { token: string; content: string }) => void) => {
      calls.completion.push([params]);
      if (pending.throwMessage) throw new Error(pending.throwMessage);
      if (pending.text && typeof onToken === 'function') {
        const tokens = pending.text.match(/\S+\s*|\s+/g) ?? [pending.text];
        let acc = '';
        for (const t of tokens) { acc += t; onToken({ token: t, content: acc }); }
      }
      return {
        text: pending.text,
        content: pending.text,
        tool_calls: pending.toolCalls,
        tokens_predicted: 8, tokens_evaluated: 4,
        timings: { predicted_per_token_ms: 50, predicted_per_second: 20 },
      };
    }),
    stopCompletion: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    tokenize: jest.fn().mockResolvedValue({ tokens: [1, 2, 3] }),
    initMultimodal: jest.fn().mockResolvedValue(false),
    getMultimodalSupport: jest.fn().mockResolvedValue({ vision: false, audio: false }),
  };
  // The service reads context.model.chatTemplates.jinja to decide tool-calling support.
  (context as Record<string, unknown>).model = {
    nParams: 1_000_000,
    chatTemplates: { jinja: { defaultCaps: { toolCalls: true }, toolUse: true, toolUseCaps: { toolCalls: true } } },
  };

  const module: Record<string, jest.Mock> = {
    initLlama: jest.fn().mockResolvedValue(context),
    releaseContext: jest.fn().mockResolvedValue(undefined),
    completion: jest.fn().mockResolvedValue({ text: '' }),
    stopCompletion: jest.fn().mockResolvedValue(undefined),
    tokenize: jest.fn().mockResolvedValue({ tokens: [1, 2, 3] }),
    detokenize: jest.fn().mockResolvedValue({ text: '' }),
  };

  return { module, calls, scriptCompletion: (r) => { pending = { text: r.text ?? '', toolCalls: r.toolCalls, throwMessage: r.throwMessage }; } };
}

// ---------------------------------------------------------------------------
// Fake: diffusion native (NativeModules.LocalDreamModule / CoreMLDiffusionModule). Destructured at
// import in src/services/localDreamGenerator.ts (DiffusionModule = Platform.select). generateImage
// ECHOES the width/height/seed it was called with (native renders at the requested size), so the REAL
// imageGenerationService's size/guidance flooring surfaces in the rendered generation-meta.
// ---------------------------------------------------------------------------

export interface DiffusionFake {
  module: Record<string, jest.Mock>;
  /** Every generateImage nativeParams, for arg-level cross-checks if needed. */
  calls: { generateImage: Array<Record<string, unknown>> };
}

function makeDiffusionFake(seedFile?: (path: string, sizeBytes: number) => void): DiffusionFake {
  const calls: DiffusionFake['calls'] = { generateImage: [] };
  let seedCounter = 0;
  const module: Record<string, jest.Mock> = {
    isModelLoaded: jest.fn().mockResolvedValue(true),
    getLoadedModelPath: jest.fn().mockResolvedValue(null),
    loadModel: jest.fn().mockResolvedValue(true),
    unloadModel: jest.fn().mockResolvedValue(true),
    cancelGeneration: jest.fn().mockResolvedValue(true),
    getGeneratedImages: jest.fn().mockResolvedValue([]),
    deleteGeneratedImage: jest.fn().mockResolvedValue(true),
    hasOpenCLCache: jest.fn().mockResolvedValue(true),
    clearOpenCLCache: jest.fn().mockResolvedValue(0),
    getConstants: jest.fn().mockReturnValue({
      DEFAULT_STEPS: 8, DEFAULT_GUIDANCE_SCALE: 7.5, DEFAULT_WIDTH: 512, DEFAULT_HEIGHT: 512,
      SUPPORTED_WIDTHS: [256, 512], SUPPORTED_HEIGHTS: [256, 512],
    }),
    generateImage: jest.fn((nativeParams: Record<string, unknown>) => {
      calls.generateImage.push(nativeParams);
      seedCounter += 1;
      const imagePath = `/generated/img-${seedCounter}.png`;
      // The real native module writes the rendered PNG to disk — mirror that so the app's
      // downstream file reads (save-to-gallery, thumbnails) find a real file.
      seedFile?.(imagePath, 1024);
      // Native renders at exactly the requested size — echo it back so the meta reflects reality.
      return Promise.resolve({
        id: `img-${seedCounter}`,
        imagePath,
        width: nativeParams.width,
        height: nativeParams.height,
        seed: nativeParams.seed ?? seedCounter,
      });
    }),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  return { module, calls };
}

// ---------------------------------------------------------------------------
// Fake: background-download native (NativeModules.DownloadManagerModule). Destructured at import in
// backgroundDownloadService. A stateful active-download set + a driveable event emitter
// (DownloadProgress/Complete/Error). simulateRelaunch() drops the in-memory rows to model an app-kill
// (Android WorkManager survives some; iOS URLSession loses them) so hydrate/reconcile runs against reality.
// ---------------------------------------------------------------------------

export interface DownloadRow {
  downloadId: string; fileName?: string; modelId?: string; modelType?: string;
  status?: string; bytesDownloaded?: number; totalBytes?: number;
}

export interface DownloadFake {
  module: Record<string, jest.Mock>;
  events: FakeEmitterHandle;
  /** Put a row into the native active set (as if a download were in flight). */
  seedActive(row: DownloadRow): void;
  /** Currently-active native rows. */
  active(): DownloadRow[];
  /** Model an app-kill: iOS URLSession loses its rows; pass {survive} for Android WorkManager rows. */
  simulateRelaunch(opts?: { survive?: string[] }): void;
}

function makeDownloadFake(handle: FakeEmitterHandle): DownloadFake {
  const rows = new Map<string, DownloadRow>();
  const module: Record<string, jest.Mock> = {
    startDownload: jest.fn(async (params: DownloadRow) => {
      const row: DownloadRow = { status: 'running', bytesDownloaded: 0, totalBytes: 0, ...params, downloadId: params.downloadId ?? `dl-${rows.size + 1}` };
      rows.set(row.downloadId, row);
      return row;
    }),
    cancelDownload: jest.fn(async (id: string) => { rows.delete(id); }),
    retryDownload: jest.fn(async () => {}),
    getActiveDownloads: jest.fn(async () => [...rows.values()]),
    moveCompletedDownload: jest.fn(async (_id: string, target: string) => target),
    startProgressPolling: jest.fn(),
    stopProgressPolling: jest.fn(),
    requestNotificationPermission: jest.fn(),
    isBatteryOptimizationIgnored: jest.fn(async () => true),
    requestBatteryOptimizationIgnore: jest.fn(),
    excludePathFromBackup: jest.fn(async () => true),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  return {
    module,
    events: handle,
    seedActive: (row) => rows.set(row.downloadId, { status: 'running', ...row }),
    active: () => [...rows.values()],
    simulateRelaunch: (opts) => {
      const survive = new Set(opts?.survive ?? []);
      [...rows.keys()].forEach(k => { if (!survive.has(k)) rows.delete(k); });
    },
  };
}

// ---------------------------------------------------------------------------
// Fake: whisper.rn (STT). initWhisper returns a driveable CONTEXT (whisperService calls
// this.context.transcribeRealtime / transcribeFile). Realtime is the chat-mode hold-to-talk path; the
// fake lets the test emit device-shaped RealtimeTranscribeEvents ({ isCapturing, data:{result}, ... }) so
// the REAL whisperService → useWhisperTranscription → onTranscript → input wiring runs on top. transcribeFile
// is the voice-mode path. Opt-in ({ whisper: true }); overrides the dumb global jest.setup whisper.rn mock.
// ---------------------------------------------------------------------------

export interface WhisperFake {
  module: Record<string, jest.Mock>;
  /** Emit a device-shaped realtime event to the LIVE subscriber (isCapturing:true = partial; false = final).
   *  Pass { noData: true } to model the B26 device symptom (spoke, but the mic captured no audio). */
  emitRealtime(opts: { text?: string; isCapturing: boolean; recordingTime?: number; noData?: boolean }): void;
  /** Set what the NEXT transcribeFile resolves with (voice-mode path). */
  setFileTranscript(text: string): void;
  /** True once whisperService has started a realtime session (subscribe wired). */
  hasRealtimeSubscriber(): boolean;
}

function makeWhisperFake(): WhisperFake {
  let realtimeCb: ((evt: unknown) => void) | null = null;
  let fileTranscript = 'Transcribed text';
  const context: Record<string, jest.Mock> = {
    transcribeFile: jest.fn(async () => ({ result: fileTranscript, segments: [{ text: fileTranscript, t0: 0, t1: 100 }] })),
    transcribeRealtime: jest.fn(async () => ({
      stop: jest.fn(async () => { /* native stop; the test drives the final event explicitly */ }),
      subscribe: (cb: (evt: unknown) => void) => { realtimeCb = cb; },
    })),
    release: jest.fn(async () => { realtimeCb = null; }),
    bench: jest.fn(async () => ''),
  };
  const module: Record<string, jest.Mock> = {
    initWhisper: jest.fn(async () => context),
    releaseAllWhisper: jest.fn(async () => {}),
    // Some call sites read module-level too; mirror the context.
    transcribeFile: context.transcribeFile,
  };
  return {
    module,
    emitRealtime: ({ text, isCapturing, recordingTime, noData }) => {
      if (!realtimeCb) return;
      realtimeCb({
        isCapturing,
        data: noData ? undefined : { result: text ?? '', segments: text ? [{ text, t0: 0, t1: 100 }] : [] },
        processTime: 10,
        recordingTime: recordingTime ?? 500,
      });
    },
    setFileTranscript: (t) => { fileTranscript = t; },
    hasRealtimeSubscriber: () => realtimeCb != null,
  };
}

// ---------------------------------------------------------------------------
// Fake: RAM sensor. DeviceMemoryModule.getMemoryInfo() (dynamic access in hardware.ts) +
// react-native-device-info.getTotalMemory. Seed exact device numbers; the REAL memoryBudget runs.
// ---------------------------------------------------------------------------

export interface RamProfile {
  platform: 'ios' | 'android';
  /** Total physical RAM in bytes. */
  totalBytes: number;
  /** Truly-free RAM right now, in bytes (os_proc_available). */
  availBytes: number;
}

export const GB = 1024 * 1024 * 1024;
export const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Fake: react-native-fs — a stateful in-memory filesystem (the REAL device leaf we can't run in node).
// Replaces the dumb global jest.setup stub (exists→false / readDir→[]) so the real listing/scan/
// integrity/finalize logic runs against a true disk the test seeds. Opt-in (installNativeBoundary({fs}))
// so it never perturbs tests that don't touch the filesystem.
// ---------------------------------------------------------------------------

export interface FsFake {
  module: Record<string, unknown>;
  /** Seed a file on the virtual disk with an exact byte size (for truncated/partial-file cases). */
  seedFile(path: string, sizeBytes: number): void;
  /** Seed a directory so exists()/readDir() see it even when empty. */
  seedDir(path: string): void;
  DocumentDirectoryPath: string;
}

function makeFsFake(): FsFake {
  const DocumentDirectoryPath = '/docs';
  // Backed by memfs — a REAL in-memory filesystem engine does the storage/tree work; this only maps the
  // react-native-fs API onto it. (Off-the-shelf fake engine, per the plan, not a hand-rolled tree.)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Volume } = require('memfs');
  const vol = Volume.fromJSON({});
  vol.mkdirSync(DocumentDirectoryPath, { recursive: true });

  const norm = (p: string) => p.replace(/^file:\/\//, '').replace(/\/+$/, '') || '/';
  const base = (p: string) => norm(p).slice(norm(p).lastIndexOf('/') + 1);
  const mkStat = (p: string, st: { size: number; isFile(): boolean; isDirectory(): boolean; mtime: Date }) => ({
    path: norm(p), name: base(p), size: Number(st.size),
    isFile: () => st.isFile(), isDirectory: () => st.isDirectory(), mtime: st.mtime,
  });

  const seedFile = (path: string, sizeBytes: number) => {
    const p = norm(path);
    vol.mkdirSync(p.slice(0, p.lastIndexOf('/')) || '/', { recursive: true });
    vol.writeFileSync(p, Buffer.alloc(sizeBytes));
  };
  const seedDir = (path: string) => vol.mkdirSync(norm(path), { recursive: true });

  const module: Record<string, unknown> = {
    DocumentDirectoryPath,
    CachesDirectoryPath: '/caches',
    exists: jest.fn(async (p: string) => vol.existsSync(norm(p))),
    mkdir: jest.fn(async (p: string) => { vol.mkdirSync(norm(p), { recursive: true }); }),
    readDir: jest.fn(async (p: string) => {
      const dir = norm(p);
      return (vol.readdirSync(dir) as string[]).map((name) => {
        const full = `${dir}/${name}`;
        return mkStat(full, vol.statSync(full) as never);
      });
    }),
    stat: jest.fn(async (p: string) => mkStat(p, vol.statSync(norm(p)) as never)),
    writeFile: jest.fn(async (p: string, contents: string) => {
      const np = norm(p);
      vol.mkdirSync(np.slice(0, np.lastIndexOf('/')) || '/', { recursive: true });
      vol.writeFileSync(np, String(contents ?? ''));
    }),
    readFile: jest.fn(async (p: string) => vol.readFileSync(norm(p), 'utf8')),
    read: jest.fn(async () => 'GGUF'),
    unlink: jest.fn(async (p: string) => { vol.rmSync(norm(p), { recursive: true, force: true }); }),
    moveFile: jest.fn(async (from: string, to: string) => { vol.renameSync(norm(from), norm(to)); }),
    copyFile: jest.fn(async (from: string, to: string) => { vol.copyFileSync(norm(from), norm(to)); }),
    hash: jest.fn(async () => 'deadbeef'),
    downloadFile: jest.fn(() => ({ jobId: 1, promise: Promise.resolve({ statusCode: 200, bytesWritten: 0 }) })),
    stopDownload: jest.fn(),
  };
  return { module, seedFile, seedDir, DocumentDirectoryPath };
}

// ---------------------------------------------------------------------------
// installNativeBoundary — seed the set, then freshly require services/stores on top.
// ---------------------------------------------------------------------------

export interface InstallOpts {
  /** RAM profile seeded at the DeviceMemoryModule + device-info leaf. */
  ram?: RamProfile;
  /** Replace the dumb global react-native-fs stub with a stateful in-memory filesystem. */
  fs?: boolean;
  /** Replace the global llama.rn stub with a scriptable context (boundary.llama.scriptCompletion). */
  llama?: boolean;
  /** Seed a stateful background-download native module (boundary.download). */
  download?: boolean;
  /** Replace the global whisper.rn stub with a driveable STT context (boundary.whisper). */
  whisper?: boolean;
}

export interface NativeBoundary {
  litert: LiteRTFake;
  /** Drive LiteRT native events (litert_token, litert_tool_call, litert_complete, …). */
  litertEvents: FakeEmitterHandle;
  /** Image diffusion native (LocalDream / CoreMLDiffusion). generateImage echoes the requested size. */
  diffusion: DiffusionFake;
  /** Stateful in-memory filesystem — present only when installed with { fs: true }. */
  fs?: FsFake;
  /** Scriptable llama.rn text engine — present only when installed with { llama: true }. */
  llama?: LlamaFake;
  /** Stateful background-download native — present only when installed with { download: true }. */
  download?: DownloadFake;
  /** Driveable whisper STT context — present only when installed with { whisper: true }. */
  whisper?: WhisperFake;
  /** Re-read RAM at the leaf mid-test (e.g. simulate OS pressure between a pre-check and the load). */
  setRam(profile: RamProfile): void;
}

/**
 * Seed NativeModules + npm-package handles for the given profile, BEFORE requiring services.
 * Call at the very top of a test body (after jest.resetModules is safe — this calls it), then
 * `require()` the screen/services you need so they capture the fakes.
 */
export function installNativeBoundary(opts: InstallOpts = {}): NativeBoundary {
  const ram: RamProfile = opts.ram ?? { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB };

  jest.resetModules();

  // A single emitter registry shared by every NativeEventEmitter built over our fake modules.
  const { add, handle } = makeEmitterRegistry();

  const litert = makeLiteRTFake(handle);
  const downloadFake = opts.download ? makeDownloadFake(handle) : undefined;

  // Stateful FS: override the dumb global react-native-fs stub BEFORE any service requires it.
  const fsFake = opts.fs ? makeFsFake() : undefined;
  if (fsFake) jest.doMock('react-native-fs', () => fsFake.module);

  // Diffusion writes its rendered PNG to the (memfs) disk when fs is present, like the native module.
  const diffusion = makeDiffusionFake(fsFake?.seedFile);

  // Scriptable llama.rn: override the global stub so completion output is under test control.
  const llamaFake = opts.llama ? makeLlamaFake() : undefined;
  if (llamaFake) jest.doMock('llama.rn', () => llamaFake.module);

  // Driveable whisper.rn: override the global stub so realtime/file transcription is under test control.
  const whisperFake = opts.whisper ? makeWhisperFake() : undefined;
  if (whisperFake) jest.doMock('whisper.rn', () => whisperFake.module);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RN = require('react-native');
  RN.NativeModules.LiteRTModule = litert.module;
  // Both platform names point at the same fake; localDreamGenerator's Platform.select picks one.
  RN.NativeModules.LocalDreamModule = diffusion.module;
  RN.NativeModules.CoreMLDiffusionModule = diffusion.module;
  if (downloadFake) RN.NativeModules.DownloadManagerModule = downloadFake.module;
  RN.NativeModules.DeviceMemoryModule = {
    getMemoryInfo: jest.fn().mockResolvedValue({
      processAvailableBytes: ram.availBytes,
      footprintBytes: ram.totalBytes - ram.availBytes,
    }),
  };
  Object.defineProperty(RN.Platform, 'OS', { value: ram.platform, configurable: true });

  // NativeEventEmitter is constructed over the fake module; route its listeners through our registry
  // so the test can drive native events. Use defineProperty (a plain assignment can silently no-op —
  // the react-native namespace export is read-only), the same override trick used for Platform.OS.
  Object.defineProperty(RN, 'NativeEventEmitter', {
    configurable: true,
    value: function FakeNativeEventEmitter() {
      return {
        addListener: (event: string, cb: Listener) => add(event, cb),
        removeAllListeners: () => {},
      };
    },
  });

  // react-native-device-info total-memory leaf (npm package, already jest.mock-ed in jest.setup).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const DeviceInfo = require('react-native-device-info');
  (DeviceInfo.getTotalMemory as jest.Mock).mockResolvedValue(ram.totalBytes);
  (DeviceInfo.getUsedMemory as jest.Mock).mockResolvedValue(ram.totalBytes - ram.availBytes);

  const setRam = (profile: RamProfile) => {
    (RN.NativeModules.DeviceMemoryModule.getMemoryInfo as jest.Mock).mockResolvedValue({
      processAvailableBytes: profile.availBytes,
      footprintBytes: profile.totalBytes - profile.availBytes,
    });
    (DeviceInfo.getTotalMemory as jest.Mock).mockResolvedValue(profile.totalBytes);
    Object.defineProperty(RN.Platform, 'OS', { value: profile.platform, configurable: true });
  };

  return { litert, litertEvents: handle, diffusion, fs: fsFake, llama: llamaFake, download: downloadFake, whisper: whisperFake, setRam };
}
