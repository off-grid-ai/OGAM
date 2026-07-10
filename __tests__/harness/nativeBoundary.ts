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
// installNativeBoundary — seed the set, then freshly require services/stores on top.
// ---------------------------------------------------------------------------

export interface InstallOpts {
  /** RAM profile seeded at the DeviceMemoryModule + device-info leaf. */
  ram?: RamProfile;
}

export interface NativeBoundary {
  litert: LiteRTFake;
  /** Drive LiteRT native events (litert_token, litert_tool_call, litert_complete, …). */
  litertEvents: FakeEmitterHandle;
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

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RN = require('react-native');
  RN.NativeModules.LiteRTModule = litert.module;
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

  return { litert, litertEvents: handle, setRam };
}
