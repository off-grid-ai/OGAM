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
    return require('@testing-library/react-native');
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
  calls: { generateRaw: unknown[][]; resetConversation: unknown[][]; sendMessageWithMedia: unknown[][] };
  /**
   * Script the native side of the NEXT turn: when our code calls sendMessage*, emit the tool calls
   * (which the real service dispatches to the real tool loop, then calls respondToToolCall), then on the
   * last respondToToolCall (or immediately if no tools) emit reasoning + content tokens + litert_complete.
   * Honest: the fake only emits device-shaped events; OUR loop decides what the user sees.
   */
  scriptTurn(turn: LiteRTTurn): void;
}

/** Run fn on a macrotask so it lands after the current async chain (native call → awaited resolve). */
const defer = (fn: () => void) => { setTimeout(fn, 0); };

function makeLiteRTFake(handle: FakeEmitterHandle): LiteRTFake {
  const calls: LiteRTFake['calls'] = { generateRaw: [], resetConversation: [], sendMessageWithMedia: [] };

  // Scripted turn state — set by scriptTurn(), consumed by the send/respond methods below.
  let pending: LiteRTTurn | null = null;
  let toolCallsRemaining = 0;

  const emitCompletion = (turn: LiteRTTurn) => {
    if (turn.reasoning) handle.emit('litert_thinking', turn.reasoning);
    if (turn.content) handle.emit('litert_token', turn.content);
    handle.emit('litert_complete', '{}');
  };

  const onSend = () => {
    const turn = pending;
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
    sendMessageWithImages: jest.fn(() => { onSend(); return Promise.resolve(); }),
    sendMessageWithAudio: jest.fn(() => { onSend(); return Promise.resolve(); }),
    sendMessageWithMedia: jest.fn((...args: unknown[]) => { calls.sendMessageWithMedia.push(args); onSend(); return Promise.resolve(); }),
    respondToToolCall: jest.fn(() => {
      // After the LAST tool result is delivered, the native model continues and completes.
      if (pending && --toolCallsRemaining <= 0) { const turn = pending; defer(() => emitCompletion(turn)); }
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
  };
}

// ---------------------------------------------------------------------------
// Fake: llama.rn (the GGUF text engine, an npm native package globally jest.mock-ed in jest.setup).
// A scriptable llama context whose completion returns the exact model text (and/or structured
// tool_calls) the test wants, so the REAL llmService + generationToolLoop parse it. Tool-calling is
// enabled via a jinja caps stub so the loop keeps the tools.
// ---------------------------------------------------------------------------

export interface LlamaFake {
  /** Set the result the NEXT context.completion() resolves with (text drives the text tool-call parser). */
  scriptCompletion(result: { text?: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> }): void;
  /** react-native module object to inject for 'llama.rn'. */
  module: Record<string, jest.Mock>;
  calls: { completion: unknown[][] };
}

function makeLlamaFake(): LlamaFake {
  const calls: LlamaFake['calls'] = { completion: [] };
  let pending: { text: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> } = { text: '' };

  const context: Record<string, jest.Mock> = {
    completion: jest.fn(async (params: unknown) => {
      calls.completion.push([params]);
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

  return { module, calls, scriptCompletion: (r) => { pending = { text: r.text ?? '', toolCalls: r.toolCalls }; } };
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

function makeDiffusionFake(): DiffusionFake {
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
      // Native renders at exactly the requested size — echo it back so the meta reflects reality.
      return Promise.resolve({
        id: `img-${seedCounter}`,
        imagePath: `/generated/img-${seedCounter}.png`,
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
  // path → { size, isDir }. Directories are entries with isDir=true.
  const tree = new Map<string, { size: number; isDir: boolean }>();
  tree.set(DocumentDirectoryPath, { size: 0, isDir: true });

  const norm = (p: string) => p.replace(/\/+$/, '');
  const parent = (p: string) => norm(p).slice(0, norm(p).lastIndexOf('/')) || '/';
  const base = (p: string) => norm(p).slice(norm(p).lastIndexOf('/') + 1);
  const ensureDir = (p: string) => { if (p && p !== '/' && !tree.has(norm(p))) { tree.set(norm(p), { size: 0, isDir: true }); ensureDir(parent(p)); } };

  const seedFile = (path: string, sizeBytes: number) => { ensureDir(parent(path)); tree.set(norm(path), { size: sizeBytes, isDir: false }); };
  const seedDir = (path: string) => ensureDir(path);

  const statEntry = (p: string) => tree.get(norm(p));
  const mkStat = (p: string, e: { size: number; isDir: boolean }) => ({
    path: norm(p), name: base(p), size: e.size,
    isFile: () => !e.isDir, isDirectory: () => e.isDir, mtime: new Date(0),
  });

  const module: Record<string, unknown> = {
    DocumentDirectoryPath,
    CachesDirectoryPath: '/caches',
    exists: jest.fn(async (p: string) => tree.has(norm(p))),
    mkdir: jest.fn(async (p: string) => { ensureDir(p); }),
    readDir: jest.fn(async (p: string) => {
      const dir = norm(p);
      return [...tree.entries()]
        .filter(([k]) => k !== dir && parent(k) === dir)
        .map(([k, e]) => mkStat(k, e));
    }),
    stat: jest.fn(async (p: string) => { const e = statEntry(p); if (!e) throw new Error(`ENOENT: ${p}`); return mkStat(p, e); }),
    writeFile: jest.fn(async (p: string, contents: string) => { seedFile(p, Buffer.byteLength(String(contents ?? ''))); }),
    readFile: jest.fn(async (p: string) => { if (!tree.has(norm(p))) throw new Error(`ENOENT: ${p}`); return ''; }),
    read: jest.fn(async () => 'GGUF'),
    unlink: jest.fn(async (p: string) => {
      const d = norm(p);
      [...tree.keys()].filter(k => k === d || k.startsWith(d + '/')).forEach(k => tree.delete(k));
    }),
    moveFile: jest.fn(async (from: string, to: string) => { const e = statEntry(from); if (e) { seedFile(to, e.size); tree.delete(norm(from)); } }),
    copyFile: jest.fn(async (from: string, to: string) => { const e = statEntry(from); if (e) seedFile(to, e.size); }),
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
  const diffusion = makeDiffusionFake();
  const downloadFake = opts.download ? makeDownloadFake(handle) : undefined;

  // Stateful FS: override the dumb global react-native-fs stub BEFORE any service requires it.
  const fsFake = opts.fs ? makeFsFake() : undefined;
  if (fsFake) jest.doMock('react-native-fs', () => fsFake.module);

  // Scriptable llama.rn: override the global stub so completion output is under test control.
  const llamaFake = opts.llama ? makeLlamaFake() : undefined;
  if (llamaFake) jest.doMock('llama.rn', () => llamaFake.module);

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

  return { litert, litertEvents: handle, diffusion, fs: fsFake, llama: llamaFake, download: downloadFake, setRam };
}
