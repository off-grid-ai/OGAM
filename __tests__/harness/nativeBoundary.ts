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

import {
  createNativeFileSystemBoundary,
  type NativeFileSystemBoundary,
} from './nativeFileSystem';

// The hosted serial coverage gate loads more than 600 suites into one process. Near the end of that
// run, instrumentation and garbage collection can delay any real native-boundary journey beyond the
// normal ceiling even when it finishes in seconds alone. Keep every behavior wait strict, but give
// the CI process one shared outer budget instead of adding per-suite exceptions as random suites
// cross the default under load.
jest.setTimeout(process.env.CI === 'true' ? 90_000 : 30_000);

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
    const rtl = require('@testing-library/react-native');
    // Register THIS instance's cleanup on a global so jest.setup's afterEach can unmount the tree WITHOUT
    // requiring RTL fresh (requiring it fresh after a test's resetModules corrupts the module graph and
    // breaks the next test — a real regression). Only tests that render (call requireRTL) get cleaned up.
    (
      globalThis as unknown as { __RTL_CLEANUP__?: () => void }
    ).__RTL_CLEANUP__ = rtl.cleanup;
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
    listenerCount: event => listeners.get(event)?.size ?? 0,
  };
  return { add, handle };
}

/** One scripted native turn: optional tool calls the model "emits", then the final content/reasoning. */
export interface LiteRTTurn {
  /** Tool calls the native model emits (litert_tool_call). The REAL service runs them + respondToToolCall. */
  toolCalls?: Array<{
    id?: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Reasoning tokens emitted on the litert_thinking channel before completion. */
  reasoning?: string;
  /** Final content tokens emitted on litert_token before litert_complete. Empty ⇒ the model said nothing. */
  content?: string;
}

export interface LiteRTFake {
  module: Record<string, jest.Mock>;
  events: FakeEmitterHandle;
  /** Records of every generateRaw / sendMessage* call for arg assertions. */
  calls: {
    generateRaw: unknown[][];
    resetConversation: unknown[][];
    sendMessage: unknown[][];
    sendMessageWithMedia: unknown[][];
    sendMessageWithImages: unknown[][];
  };
  /**
   * Script the native side of the NEXT turn: when our code calls sendMessage*, emit the tool calls
   * (which the real service dispatches to the real tool loop, then calls respondToToolCall), then on the
   * last respondToToolCall (or immediately if no tools) emit reasoning + content tokens + litert_complete.
   * Honest: the fake only emits device-shaped events; OUR loop decides what the user sees.
   */
  scriptTurn(turn: LiteRTTurn): void;
  /** Make the next native reply depend on the sampler temperature that Mobile supplied. */
  scriptTurnFromTemperature(reply: (temperature: number) => LiteRTTurn): void;
  /**
   * Script a QUEUE of turns consumed one-per-generateRaw — for flows with more than one native round
   * trip (e.g. the LiteRT tool-router does a separate generateToolSelection pass, THEN the main turn).
   */
  scriptTurns(turns: LiteRTTurn[]): void;
  /**
   * Make the NEXT send/generate emit a device-shaped litert_error (the native runtime failing to invoke —
   * e.g. B23 "Status 13 Failed to invoke the compiled model" on a CPU backend), so the REAL error path runs
   * (litertService.onError → generation error surface). One-shot: cleared after it fires.
   */
  scriptError(message: string): void;
  /**
   * Make the NEXT send HANG (native accepted the prompt but never emits complete/error) so generation
   * stays in-flight — for asserting in-generation UI state (e.g. the mic must become a STOP button).
   * One-shot: cleared after it fires.
   */
  scriptHang(): void;
  /**
   * Emit a PARTIAL content token then HANG (never emit litert_complete) — the mid-stream state where a
   * partial answer is ALREADY on screen but generation is still in-flight, so a STOP lands on shown output.
   * Used to prove Stop keeps the partial (doesn't discard it). One-shot.
   */
  scriptPartialThenHang(content: string): void;
  /**
   * Emit a partial REASONING token (litert_thinking) then HANG — the model is mid-THINKING with reasoning on
   * screen but no content yet, still in-flight. Proves Stop keeps a reasoning-only partial. One-shot.
   */
  scriptThinkingThenHang(reasoning: string): void;
}

/** Run fn on a macrotask so it lands after the current async chain (native call → awaited resolve). */
const defer = (fn: () => void) => {
  setTimeout(fn, 0);
};

function makeLiteRTFake(handle: FakeEmitterHandle): LiteRTFake {
  const calls: LiteRTFake['calls'] = {
    generateRaw: [],
    resetConversation: [],
    sendMessage: [],
    sendMessageWithMedia: [],
    sendMessageWithImages: [],
  };

  // Scripted turn state — set by scriptTurn()/scriptTurns(), consumed by the send/respond methods below.
  let pending: LiteRTTurn | null = null;
  let pendingTemperatureReply: ((temperature: number) => LiteRTTurn) | null =
    null;
  let temperature = 0.7;
  let warmupPending = false;
  const queue: LiteRTTurn[] = [];
  let currentTurn: LiteRTTurn | null = null; // the turn onSend picked (for respondToToolCall completion)
  let toolCallsRemaining = 0;
  let pendingError: string | null = null; // one-shot: next send emits litert_error instead of completing
  let pendingHang = false; // one-shot: next send never completes (generation stays in-flight)
  let pendingPartialHang: { content?: string; reasoning?: string } | null =
    null; // one-shot: emit a partial token/reasoning then never complete

  const emitCompletion = (turn: LiteRTTurn) => {
    if (turn.reasoning) handle.emit('litert_thinking', turn.reasoning);
    if (turn.content) handle.emit('litert_token', turn.content);
    handle.emit('litert_complete', '{}');
  };

  const onSend = (text?: unknown) => {
    if (warmupPending && text === 'Hi') {
      warmupPending = false;
      defer(() => handle.emit('litert_complete', '{}'));
      return;
    }
    if (pendingPartialHang !== null) {
      const p = pendingPartialHang;
      pendingPartialHang = null;
      defer(() => {
        if (p.reasoning) handle.emit('litert_thinking', p.reasoning);
        if (p.content) handle.emit('litert_token', p.content);
      });
      return;
    } // partial (content and/or reasoning) shown, then in-flight
    if (pendingHang) {
      pendingHang = false;
      return;
    } // accepted, never completes → generation in-flight
    if (pendingError) {
      const m = pendingError;
      pendingError = null;
      defer(() => handle.emit('litert_error', m));
      return;
    }
    const turn = queue.length
      ? queue.shift()!
      : pendingTemperatureReply
      ? pendingTemperatureReply(temperature)
      : pending;
    pendingTemperatureReply = null;
    currentTurn = turn;
    if (!turn) {
      defer(() => handle.emit('litert_complete', '{}'));
      return;
    }
    const tcs = turn.toolCalls ?? [];
    toolCallsRemaining = tcs.length;
    if (tcs.length === 0) {
      defer(() => emitCompletion(turn));
      return;
    }
    // Emit each tool call; the REAL service dispatches it and calls respondToToolCall.
    defer(() =>
      tcs.forEach((tc, i) =>
        handle.emit(
          'litert_tool_call',
          JSON.stringify({
            id: tc.id ?? `tc-${i}`,
            name: tc.name,
            arguments: tc.arguments,
          }),
        ),
      ),
    );
  };

  const module: Record<string, jest.Mock> = {
    loadModel: jest.fn(async () => {
      warmupPending = true;
      return { backend: 'gpu', maxNumTokens: 4096 };
    }),
    resetConversation: jest.fn((...args: unknown[]) => {
      calls.resetConversation.push(args);
      temperature = Number(args[1] ?? 0.7);
      return Promise.resolve();
    }),
    sendMessage: jest.fn((...args: unknown[]) => {
      calls.sendMessage.push(args);
      onSend(args[0]);
      return Promise.resolve();
    }),
    sendMessageWithImages: jest.fn((...args: unknown[]) => {
      calls.sendMessageWithImages.push(args);
      onSend(args[0]);
      return Promise.resolve();
    }),
    sendMessageWithAudio: jest.fn((...args: unknown[]) => {
      onSend(args[0]);
      return Promise.resolve();
    }),
    sendMessageWithMedia: jest.fn((...args: unknown[]) => {
      calls.sendMessageWithMedia.push(args);
      onSend(args[0]);
      return Promise.resolve();
    }),
    respondToToolCall: jest.fn(() => {
      // After the LAST tool result is delivered, the native model continues and completes.
      if (currentTurn && --toolCallsRemaining <= 0) {
        const turn = currentTurn;
        defer(() => emitCompletion(turn));
      }
      return Promise.resolve();
    }),
    generateRaw: jest.fn((...args: unknown[]) => {
      calls.generateRaw.push(args);
      return Promise.resolve('');
    }),
    stopGeneration: jest.fn().mockResolvedValue(undefined),
    unloadModel: jest.fn().mockResolvedValue(undefined),
    getMemoryInfo: jest.fn().mockResolvedValue({
      totalRamMb: 12000,
      usedRamMb: 4000,
      availRamMb: 8000,
      gpuPrivateMb: 0,
      lowMemory: false,
    }),
    // RN's NativeEventEmitter constructor calls addListener/removeListeners on the module on iOS.
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };

  return {
    module,
    events: handle,
    calls,
    scriptTurn: (turn: LiteRTTurn) => {
      pending = turn;
    },
    scriptTurnFromTemperature: reply => {
      pendingTemperatureReply = reply;
    },
    scriptTurns: (turns: LiteRTTurn[]) => {
      queue.length = 0;
      queue.push(...turns);
    },
    scriptError: (message: string) => {
      pendingError = message;
    },
    scriptHang: () => {
      pendingHang = true;
    },
    scriptPartialThenHang: (content: string) => {
      pendingPartialHang = { content };
    },
    scriptThinkingThenHang: (reasoning: string) => {
      pendingPartialHang = { reasoning };
    },
  };
}

// ---------------------------------------------------------------------------
// Fake: llama.rn (the GGUF text engine, an npm native package globally jest.mock-ed in jest.setup).
// A scriptable llama context whose completion returns the exact model text (and/or structured
// tool_calls) the test wants, so the REAL llmService + generationToolLoop parse it. Tool-calling is
// enabled via a jinja caps stub so the loop keeps the tools.
// ---------------------------------------------------------------------------

/** Completion-result metadata a real llama.rn NativeCompletionResult carries (verified against
 *  llama.rn types). Lets a test script a TRUNCATED turn (hit the n_predict cap without EOS) so the
 *  cutoff is device-shaped, not hand-asserted. Defaults model a normal complete turn. */
export interface CompletionMeta {
  stopped_eos?: boolean; // false = did NOT stop on an end-of-sequence token
  stopped_limit?: number; // 1 = hit the n_predict cap (B15's condition)
  truncated?: boolean; // llama.rn's own truncation flag
  tokens_predicted?: number; // == n_predict at the cap (device saw 1024)
}

export interface LlamaCompletionScript {
  text?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  throwMessage?: string;
  throwAfter?: string;
  pauseAfter?: string;
  holdBeforeStream?: boolean;
  thinkingText?: string;
  reasoning?: string;
  completionMeta?: CompletionMeta;
}

export interface LlamaFake {
  /** Set the result the NEXT context.completion() resolves with (text drives the text tool-call parser).
   *  Pass { throwMessage } to make completion REJECT (e.g. a native context-overflow error).
   *  Pass { thinkingText } to model a reasoning-capable model: when the request carries
   *  enable_thinking===true the completion emits `thinkingText` (the model's reasoning-style output, as
   *  device B30 showed) instead of `text` — so a caller that fails to disable thinking gets the reasoning
   *  dump, EMERGENT from its own enable_thinking decision. With enable_thinking!==true it emits `text`. */
  scriptCompletion(result: LlamaCompletionScript): void;
  /** Queue one scripted result per native completion for a multi-round tool turn. */
  scriptCompletions(results: LlamaCompletionScript[]): void;
  /** Release a stream held via scriptCompletion({ pauseAfter }). No-op if not paused. */
  releaseStream(): void;
  /** Make every GPU/HTP context init (initLlama with n_gpu_layers > 0) REJECT, as a real hung/timed-out
   *  accelerator init does — so initContextWithFallback falls back to the CPU attempt (n_gpu_layers:0).
   *  Models B24 (GPU init timeout → CPU/partial fallback). Persistent until cleared. */
  scriptGpuInitFailure(fail?: boolean): void;
  /** Make EVERY init attempt fail (a model that can't load on any backend) — the real load path throws. */
  scriptInitFailure(fail?: boolean): void;
  /** Set the GGUF header facts returned by llama.rn's metadata-only file probe. */
  scriptModelInfo(metadata: Record<string, unknown>): void;
  /** HOLD the next post-init multimodal-support check (context.getMultimodalSupport) open until
   *  releaseMultimodalHold() — the device-shaped load window between context init and capability
   *  detection (the 2026-07-13 18:50 device log shows ~3.4s there for gemma-4-E2B: init succeeded
   *  18:50:26.905, capabilities logged 18:50:30.409, and a send raced in between). One-shot. */
  scriptMultimodalHold(): void;
  /** Release a load held via scriptMultimodalHold(). No-op if not held. */
  releaseMultimodalHold(): void;
  /** True while a held load is parked INSIDE the multimodal check (the window is open). */
  multimodalHoldActive(): boolean;
  /** Make context.release() AND releaseContext() REJECT, as a native unload that genuinely fails does
   *  (llama.rn surfaces the native error; the context stays resident and its memory is NOT reclaimed).
   *  Persistent until cleared. */
  scriptReleaseFailure(fail?: boolean): void;
  /** HOLD the next context.release() open until releaseUnload() — a native unload is not instant on a
   *  device (freeing a multi-GB context takes real time), so the in-flight unload window is observable.
   *  One-shot; the usual deferred free still runs once released. */
  holdNextUnload(): void;
  /** Release an unload held via holdNextUnload(). No-op if nothing is held. */
  releaseUnload(): void;
  /** True while an unload is parked INSIDE native context.release(). */
  unloadHeld(): boolean;
  /** react-native module object to inject for 'llama.rn'. */
  module: Record<string, jest.Mock>;
  calls: { completion: unknown[][]; clearCache: boolean[] };
}

function makeLlamaFake(
  onRelease?: () => void,
  chatTemplate?: string,
): LlamaFake {
  const calls: LlamaFake['calls'] = { completion: [], clearCache: [] };
  let modelInfo: Record<string, unknown> = {};
  type PreparedCompletion = Omit<LlamaCompletionScript, 'text'> & {
    text: string;
  };
  const prepareCompletion = (
    result: LlamaCompletionScript,
  ): PreparedCompletion => ({
    ...result,
    text: result.text ?? '',
  });
  let pending: PreparedCompletion = { text: '' };
  const completionQueue: PreparedCompletion[] = [];
  let releaseFn: (() => void) | null = null; // resolves a mid-stream pause
  // Faithful llama.rn stop semantics: stopCompletion() aborts the IN-FLIGHT completion — it stops
  // streaming further tokens, releases a held pause, and the completion RESOLVES with
  // `interrupted: true` (the exact device wire shape: predicted stops, stopped_eos=false). The flag
  // is per-completion (a fresh completion starts un-stopped), matching the native abort behavior.
  let stopRequested = false;
  let gpuInitFails = false; // when true, initLlama with n_gpu_layers>0 rejects (GPU/HTP init timeout → CPU fallback)
  let initFails = false; // when true, EVERY initLlama attempt rejects (a model that fails to load on any backend)
  // Multimodal-check hold: opens the post-init capability window a real slow device has.
  let mmHoldPending = false;
  let mmHoldEngaged = false;
  let mmHoldRelease: (() => void) | null = null;
  // Unload boundary: a native release can take real time (hold) and can genuinely fail (script).
  let releaseFails = false;
  let unloadHoldPending = false;
  let unloadHoldEngaged = false;
  let unloadHoldRelease: (() => void) | null = null;

  const context: Record<string, jest.Mock> = {
    // Faithful to llama.rn: completion(params, onToken) STREAMS token-by-token through the callback
    // (each call carries the delta `token` + the cumulative `content`, as the native lib does) BEFORE
    // resolving with the final result. This drives the REAL streaming render path (getStreamingDelta →
    // streamingMessage), not a single-shot final text. onToken stops being fed once isGenerating flips
    // false (a real stop), because the service's own callback guards on `data.token` + isGenerating.
    completion: jest.fn(
      async (
        params: unknown,
        onToken?: (data: {
          token: string;
          content?: string;
          reasoning_content?: string;
        }) => void,
      ) => {
        calls.completion.push([params]);
        const scripted = completionQueue.shift() ?? pending;
        const nativeToolCalls = scripted.toolCalls?.map((call, index) => ({
          id: `call-${index}`,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        }));
        if (completionQueue.length === 0) pending = { text: '' };
        stopRequested = false; // per-completion abort flag — a fresh completion starts un-stopped
        if (scripted.throwMessage) throw new Error(scripted.throwMessage);
        // holdBeforeStream models PREFILL-in-progress: the completion is in flight but has emitted ZERO
        // tokens. llama cannot honor a stop mid-prefill; on release-by-stop it resolves interrupted with
        // nothing streamed — the exact device state whose empty result the tool loop mistook for a
        // normal empty reply (firing the no-tools fallback zombie).
        if (scripted.holdBeforeStream) {
          await new Promise<void>(res => {
            releaseFn = res;
          });
        }
        const wantsThinking = !!(params as { enable_thinking?: boolean })
          ?.enable_thinking;
        // Device-faithful native reasoning (reasoning_format=auto): when the runtime reasons, it emits the
        // reasoning on the reasoning_content channel and the CLEAN answer on content — separated, exactly as
        // the on-device log showed (content:"Hello…", reasoning_content:"The user said…", text: raw <|channel>).
        // The final `text` carries the raw combined markers, which the app must NOT surface as the answer.
        if (
          wantsThinking &&
          scripted.reasoning != null &&
          typeof onToken === 'function'
        ) {
          let accR = '';
          for (const c of [...scripted.reasoning]) {
            if (stopRequested) break;
            accR += c;
            onToken({ token: c, reasoning_content: accR });
          }
          let accC = '';
          for (const c of [...scripted.text]) {
            if (stopRequested) break;
            accC += c;
            onToken({ token: c, content: accC, reasoning_content: accR });
          }
          if (!stopRequested) {
            const metaR = scripted.completionMeta ?? {};
            return {
              text: `<|channel>thought\n${scripted.reasoning}<channel|>${scripted.text}`,
              content: scripted.text,
              reasoning_content: scripted.reasoning,
              tool_calls: nativeToolCalls,
              tokens_predicted: metaR.tokens_predicted ?? 8,
              tokens_evaluated: 4,
              stopped_eos: metaR.stopped_eos ?? true,
              stopped_limit: metaR.stopped_limit ?? 0,
              truncated: metaR.truncated ?? false,
              timings: { predicted_per_token_ms: 50, predicted_per_second: 20 },
            };
          }
        }
        // Device-faithful: a reasoning model emits its reasoning-style output when thinking is on. If the
        // caller left enable_thinking on for a request that shouldn't reason (B30 enhancement), it gets the
        // reasoning dump; disabling thinking yields the clean text. Emergent from the caller's own decision.
        const outText =
          wantsThinking && scripted.thinkingText != null
            ? scripted.thinkingText
            : scripted.text;
        if (outText && typeof onToken === 'function') {
          // Char-by-char streaming so a pauseAfter lands EXACTLY (never spanning a delimiter like </think>).
          const chars = [...outText];
          let acc = '';
          let paused = false;
          for (const c of chars) {
            if (stopRequested) break; // native abort: no further tokens after stopCompletion()
            acc += c;
            onToken({ token: c, content: acc });
            if (
              scripted.pauseAfter &&
              !paused &&
              acc.endsWith(scripted.pauseAfter)
            ) {
              paused = true;
              await new Promise<void>(res => {
                releaseFn = res;
              }); // HOLD until releaseStream() or stopCompletion()
            }
          }
        }
        // Device-faithful mid/end-stream fatal decode failure: llama_decode fails AFTER some tokens
        // streamed (B13 wire: tokens flow, then `llama_decode: failed to decode, ret = -1` →
        // "Failed to evaluate chunks"). Distinct from throwMessage (fails at the very start): throwAfter
        // reproduces the case where the spinner is already up + streaming when the runtime dies.
        if (scripted.throwAfter) throw new Error(scripted.throwAfter);
        // Defaults model a NORMAL complete turn (stopped on EOS, under the cap); a scripted completionMeta
        // overrides them to model a truncated turn (B15: stopped_eos=false, stopped_limit=1 at n_predict).
        const meta = scripted.completionMeta ?? {};
        // An aborted completion carries the device wire shape: interrupted=true, no EOS, and only
        // what streamed before the stop (tool_calls are dropped — the turn never finished them).
        if (stopRequested) {
          return {
            text: '',
            content: '',
            tool_calls: undefined,
            interrupted: true,
            tokens_predicted: 0,
            tokens_evaluated: 4,
            stopped_eos: false,
            stopped_limit: 0,
            truncated: false,
            timings: { predicted_per_token_ms: 50, predicted_per_second: 20 },
          };
        }
        return {
          text: outText,
          content: outText,
          tool_calls: nativeToolCalls,
          tokens_predicted: meta.tokens_predicted ?? 8,
          tokens_evaluated: 4,
          stopped_eos: meta.stopped_eos ?? true,
          stopped_limit: meta.stopped_limit ?? 0,
          truncated: meta.truncated ?? false,
          timings: { predicted_per_token_ms: 50, predicted_per_second: 20 },
        };
      },
    ),
    stopCompletion: jest.fn(async () => {
      stopRequested = true;
      const f = releaseFn;
      releaseFn = null;
      f?.(); // release a held mid-stream pause so the abort lands
    }),
    clearCache: jest.fn(async (clearData: boolean = false) => {
      calls.clearCache.push(clearData);
    }),
    // Releasing the native context frees its memory — but the OS reclaims it SHORTLY AFTER release()
    // returns (device-faithful), not synchronously. Defer the free so the reclaim barrier captures the
    // still-high footprint as its baseline and then observes the drop on a later poll (as on device).
    release: jest.fn(async () => {
      if (unloadHoldPending) {
        unloadHoldPending = false;
        unloadHoldEngaged = true;
        await new Promise<void>(res => {
          unloadHoldRelease = res;
        });
        unloadHoldEngaged = false;
      }
      if (releaseFails) {
        throw new Error('Failed to release context');
      }
      setTimeout(() => onRelease?.(), 50);
    }),
    tokenize: jest.fn().mockResolvedValue({ tokens: [1, 2, 3] }),
    initMultimodal: jest.fn().mockResolvedValue(false),
    // The post-init multimodal probe. A scripted hold parks the caller here — the real device's
    // window between context init and capability detection — until releaseMultimodalHold().
    getMultimodalSupport: jest.fn(async () => {
      if (mmHoldPending) {
        mmHoldPending = false;
        mmHoldEngaged = true;
        await new Promise<void>(res => {
          mmHoldRelease = res;
        });
        mmHoldEngaged = false;
      }
      return { vision: false, audio: false };
    }),
    // Embedding boundary (embedding-model contexts, initLlama({embedding:true})): return a device-shaped
    // 384-dim vector derived from the text so RAG cosine ranking is real. Matches all-MiniLM-L6-v2 (384).
    embedding: jest.fn(async (text: string) => ({
      embedding: Array.from({ length: 384 }, (_v, i) =>
        Math.sin(i + String(text).length * 0.1),
      ),
    })),
  };
  // The service reads context.model.chatTemplates.jinja to decide tool-calling support.
  (context as Record<string, unknown>).model = {
    nParams: 1_000_000,
    chatTemplates: {
      jinja: {
        defaultCaps: { toolCalls: true },
        toolUse: true,
        toolUseCaps: { toolCalls: true },
      },
    },
    // Device-faithful: a real llama.rn context exposes the GGUF chat_template in model.metadata.
    // supportsNativeThinking derives the Thinking capability from the reasoning delimiters in THIS
    // template — NOT from Jinja support. Default carries a <think> marker (reasoning-capable, matching
    // the prior harness default); a test passes a plain template (e.g. Mistral's tool-use template,
    // no markers) to assert the Thinking toggle stays hidden.
    metadata: {
      'tokenizer.chat_template':
        chatTemplate ??
        '{% if enable_thinking %}<think>\n{{reasoning}}\n</think>{% endif %}{{content}}',
    },
  };

  const module: Record<string, jest.Mock> = {
    // Faithful to llama.rn/llama.cpp: the native loader reports gpu=true (+ the offload device
    // list) when it actually offloaded layers (n_gpu_layers > 0), and gpu=false for a pure-CPU
    // init. Echo that from the requested load params so the REAL captureGpuInfo → GenerationMeta
    // path surfaces the true backend — EMERGENT from the settings→load flow, never programmed.
    initLlama: jest.fn(async (params?: Record<string, unknown>) => {
      const n = Number((params?.n_gpu_layers as number) ?? 0);
      // A model that fails to load on EVERY backend (corrupt file / unsupported arch) — all 3 attempts reject.
      if (initFails)
        throw new Error('Failed to load model: unsupported architecture');
      // Device-faithful GPU/HTP init failure: a hung/timed-out accelerator init rejects, so the real
      // initContextWithFallback falls back to the CPU attempt (which requests n_gpu_layers:0 and succeeds).
      if (gpuInitFails && n > 0)
        throw new Error('GPU context init timed out after 8000ms');
      const devices = Array.isArray(params?.devices)
        ? (params!.devices as string[])
        : [];
      (context as Record<string, unknown>).gpu = n > 0;
      (context as Record<string, unknown>).devices = n > 0 ? devices : [];
      (context as Record<string, unknown>).reasonNoGPU =
        n > 0 ? '' : 'gpu layers not requested';
      return context;
    }),
    loadLlamaModelInfo: jest.fn(async () => modelInfo),
    releaseContext: jest.fn(async () => {
      if (releaseFails) {
        throw new Error('Failed to release context');
      }
    }),
    completion: jest.fn().mockResolvedValue({ text: '' }),
    stopCompletion: jest.fn().mockResolvedValue(undefined),
    tokenize: jest.fn().mockResolvedValue({ tokens: [1, 2, 3] }),
    detokenize: jest.fn().mockResolvedValue({ text: '' }),
  };

  return {
    module,
    calls,
    scriptCompletion: r => {
      completionQueue.length = 0;
      pending = prepareCompletion(r);
    },
    scriptCompletions: results => {
      completionQueue.length = 0;
      completionQueue.push(...results.map(prepareCompletion));
      pending = { text: '' };
    },
    releaseStream: () => {
      const f = releaseFn;
      releaseFn = null;
      f?.();
    },
    scriptGpuInitFailure: (fail = true) => {
      gpuInitFails = fail;
    },
    scriptInitFailure: (fail = true) => {
      initFails = fail;
    },
    scriptModelInfo: metadata => {
      modelInfo = metadata;
    },
    scriptMultimodalHold: () => {
      mmHoldPending = true;
    },
    releaseMultimodalHold: () => {
      const f = mmHoldRelease;
      mmHoldRelease = null;
      f?.();
    },
    multimodalHoldActive: () => mmHoldEngaged,
    scriptReleaseFailure: (fail = true) => {
      releaseFails = fail;
    },
    holdNextUnload: () => {
      unloadHoldPending = true;
    },
    releaseUnload: () => {
      const f = unloadHoldRelease;
      unloadHoldRelease = null;
      f?.();
    },
    unloadHeld: () => unloadHoldEngaged,
  };
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
  /** Hold the NEXT generateImage open (it stays in flight) until releaseGeneration(). Diffusion takes many
   *  seconds on a device, and everything the user can do DURING it — press STOP, watch progress, tap send
   *  again — is unreachable against a generate that resolves in the same tick. One-shot. */
  holdNextGeneration(): void;
  /** Release a generation held by holdNextGeneration(). No-op if nothing is held. */
  releaseGeneration(): void;
  /** True while a generation is parked inside native generateImage. */
  generationHeld(): boolean;
  /** How many times native cancelGeneration was asked for — the far side of the user's STOP. */
  cancelCount(): number;
  /** HOLD the next unloadModel open until releaseUnload() — freeing a diffusion model on a device takes
   *  real time, so the in-flight unload window is observable rather than closing in the same tick.
   *  One-shot. */
  holdNextUnload(): void;
  /** Release an unload held via holdNextUnload(). No-op if nothing is held. */
  releaseUnload(): void;
  /** True while an unload is parked inside native unloadModel. */
  unloadHeld(): boolean;
  /** Hold the next native generated-image byte deletion until releaseDelete(). One-shot. */
  holdNextDelete(): void;
  /** Release a deletion held via holdNextDelete(). No-op if nothing is held. */
  releaseDelete(): void;
  /** True while generated-image deletion is parked inside the native boundary. */
  deleteHeld(): boolean;
}

function makeDiffusionFake(
  fileSystem?: NativeFileSystemBoundary,
): DiffusionFake {
  const calls: DiffusionFake['calls'] = { generateImage: [] };
  let seedCounter = 0;
  let holdNext = false;
  let held: (() => void) | null = null;
  let cancels = 0;
  let unloadHoldPending = false;
  let unloadHoldEngaged = false;
  let unloadHoldRelease: (() => void) | null = null;
  let deleteHoldPending = false;
  let deleteHoldEngaged = false;
  let deleteHoldRelease: (() => void) | null = null;
  const module: Record<string, jest.Mock> = {
    isModelLoaded: jest.fn().mockResolvedValue(true),
    getLoadedModelPath: jest.fn().mockResolvedValue(null),
    loadModel: jest.fn().mockResolvedValue(true),
    // Freeing a diffusion model is not instant on a device. A scripted hold parks the caller inside
    // native unloadModel until releaseUnload(), so the in-flight unload is observable.
    unloadModel: jest.fn(async () => {
      if (unloadHoldPending) {
        unloadHoldPending = false;
        unloadHoldEngaged = true;
        await new Promise<void>(res => {
          unloadHoldRelease = res;
        });
        unloadHoldEngaged = false;
      }
      return true;
    }),
    // Faithful to native: cancel RELEASES an in-flight generation rather than rejecting it. The held
    // promise then settles, which is how the app's own cancel path unwinds on a device.
    cancelGeneration: jest.fn(() => {
      cancels++;
      held?.();
      held = null;
      return Promise.resolve(true);
    }),
    getGeneratedImages: jest.fn().mockResolvedValue([]),
    deleteGeneratedImage: jest.fn(async (path: string) => {
      if (deleteHoldPending) {
        deleteHoldPending = false;
        deleteHoldEngaged = true;
        await new Promise<void>(resolve => {
          deleteHoldRelease = resolve;
        });
        deleteHoldEngaged = false;
      }
      if (!fileSystem || !(await fileSystem.exists(path))) {
        return { status: 'already_missing' };
      }
      await fileSystem.module.unlink(path);
      return { status: 'deleted' };
    }),
    hasOpenCLCache: jest.fn().mockResolvedValue(true),
    clearOpenCLCache: jest.fn().mockResolvedValue(0),
    getConstants: jest.fn().mockReturnValue({
      DEFAULT_STEPS: 8,
      DEFAULT_GUIDANCE_SCALE: 7.5,
      DEFAULT_WIDTH: 512,
      DEFAULT_HEIGHT: 512,
      SUPPORTED_WIDTHS: [256, 512],
      SUPPORTED_HEIGHTS: [256, 512],
    }),
    generateImage: jest.fn(async (nativeParams: Record<string, unknown>) => {
      calls.generateImage.push(nativeParams);
      if (holdNext) {
        holdNext = false;
        await new Promise<void>(resolve => {
          held = resolve;
        });
      }
      seedCounter += 1;
      const imagePath = `/generated/img-${seedCounter}.png`;
      // The real native module writes the rendered PNG to disk — mirror that so the app's
      // downstream file reads (save-to-gallery, thumbnails) find a real file.
      fileSystem?.seedFile(imagePath, 1024);
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
  return {
    module,
    calls,
    holdNextGeneration: () => {
      holdNext = true;
    },
    releaseGeneration: () => {
      held?.();
      held = null;
    },
    generationHeld: () => held !== null,
    cancelCount: () => cancels,
    holdNextUnload: () => {
      unloadHoldPending = true;
    },
    releaseUnload: () => {
      const f = unloadHoldRelease;
      unloadHoldRelease = null;
      f?.();
    },
    unloadHeld: () => unloadHoldEngaged,
    holdNextDelete: () => {
      deleteHoldPending = true;
    },
    releaseDelete: () => {
      const release = deleteHoldRelease;
      deleteHoldRelease = null;
      release?.();
    },
    deleteHeld: () => deleteHoldEngaged,
  };
}

// ---------------------------------------------------------------------------
// Fake: background-download native (NativeModules.DownloadManagerModule). Destructured at import in
// backgroundDownloadService. A stateful active-download set + a driveable event emitter
// (DownloadProgress/Complete/Error). simulateRelaunch() drops the in-memory rows to model an app-kill
// (Android WorkManager survives some; iOS URLSession loses them) so hydrate/reconcile runs against reality.
// ---------------------------------------------------------------------------

export interface DownloadRow {
  downloadId: string;
  fileName?: string;
  modelId?: string;
  modelType?: string;
  status?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
  sha256?: string;
}

export interface DownloadFake {
  module: Record<string, jest.Mock>;
  events: FakeEmitterHandle;
  /** Put a row into the native active set (as if a download were in flight). */
  seedActive(row: DownloadRow): void;
  /** Emit measured native progress for one active transfer. */
  progress(
    downloadId: string,
    bytesDownloaded: number,
    totalBytes: number,
  ): void;
  /** Complete one active transfer through the native event channel. */
  complete(downloadId: string, facts?: { sha256?: string }): void;
  /** Fail one active transfer through the native event channel. */
  fail(downloadId: string, reason: string): void;
  /** Currently-active native rows. */
  active(): DownloadRow[];
  /** Model an app-kill: iOS URLSession loses its rows; pass {survive} for Android WorkManager rows. */
  simulateRelaunch(opts?: { survive?: string[] }): void;
}

function makeDownloadFake(
  handle: FakeEmitterHandle,
  seedCompletedFile?: (
    path: string,
    sizeBytes: number,
    sha256?: string,
  ) => void,
): DownloadFake {
  const rows = new Map<string, DownloadRow>();
  const events: FakeEmitterHandle = {
    emit(event, payload) {
      if (event === 'DownloadComplete' && payload && typeof payload === 'object') {
        const completion = payload as DownloadRow;
        const downloadId = String(completion.downloadId ?? '');
        const row = rows.get(downloadId);
        if (row) {
          rows.set(downloadId, {
            ...row,
            status: 'completed',
            bytesDownloaded: completion.bytesDownloaded ?? row.bytesDownloaded,
            totalBytes: completion.totalBytes ?? row.totalBytes,
            sha256: completion.sha256 ?? row.sha256,
          });
        }
      }
      handle.emit(event, payload);
    },
    listenerCount: event => handle.listenerCount(event),
  };
  const module: Record<string, jest.Mock> = {
    startDownload: jest.fn(async (params: DownloadRow) => {
      const row: DownloadRow = {
        status: 'running',
        bytesDownloaded: 0,
        totalBytes: 0,
        ...params,
        downloadId: params.downloadId ?? `dl-${rows.size + 1}`,
      };
      rows.set(row.downloadId, row);
      return row;
    }),
    stopDownload: jest.fn(async (id: string, _retainPartial: boolean) => {
      if (!rows.has(id)) return 'not-found';
      if (rows.get(id)?.status === 'completed') return 'completed';
      rows.delete(id);
      return 'stopped';
    }),
    retryDownload: jest.fn(async () => {}),
    getActiveDownloads: jest.fn(async () => [...rows.values()]),
    moveCompletedDownload: jest.fn(async (id: string, target: string) => {
      const row = rows.get(id);
      seedCompletedFile?.(
        target,
        row?.totalBytes ?? row?.bytesDownloaded ?? 0,
        row?.sha256,
      );
      return target;
    }),
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
    events,
    seedActive: row => rows.set(row.downloadId, { status: 'running', ...row }),
    progress: (downloadId, bytesDownloaded, totalBytes) => {
      const row = rows.get(downloadId);
      if (!row) throw new Error(`Native download is not active: ${downloadId}`);
      rows.set(downloadId, {
        ...row,
        status: 'running',
        bytesDownloaded,
        totalBytes,
      });
      events.emit('DownloadProgress', {
        downloadId,
        bytesDownloaded,
        totalBytes,
      });
    },
    complete: (downloadId, facts) => {
      const row = rows.get(downloadId);
      if (!row) throw new Error(`Native download is not active: ${downloadId}`);
      rows.set(downloadId, {
        ...row,
        status: 'completed',
        bytesDownloaded: row.totalBytes ?? row.bytesDownloaded ?? 0,
        ...facts,
      });
      events.emit('DownloadComplete', { downloadId });
    },
    fail: (downloadId, reason) => {
      const row = rows.get(downloadId);
      if (!row) throw new Error(`Native download is not active: ${downloadId}`);
      rows.set(downloadId, { ...row, status: 'failed' });
      events.emit('DownloadError', { downloadId, reason });
    },
    active: () => [...rows.values()],
    simulateRelaunch: opts => {
      const survive = new Set(opts?.survive ?? []);
      [...rows.keys()].forEach(k => {
        if (!survive.has(k)) rows.delete(k);
      });
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
  emitRealtime(opts: {
    text?: string;
    isCapturing: boolean;
    recordingTime?: number;
    noData?: boolean;
  }): void;
  /** Set what the NEXT transcribeFile resolves with (voice-mode path). */
  setFileTranscript(text: string): void;
  /** True once whisperService has started a realtime session (subscribe wired). */
  hasRealtimeSubscriber(): boolean;
  /** True while the native mic realtime session is CAPTURING — set on transcribeRealtime(), cleared on
   *  its stop() or on release(). Models the device mic: capture continues until explicitly stopped, so a
   *  leaked session (never stopped on navigate-away) reads true. The device-boundary residue for B11. */
  realtimeActive(): boolean;
  /** HOLD the next model load (initWhisper) open until releaseLoad() — the device-shaped load window a
   *  real ggml init has (seconds on device), so an in-flight tap-triggered load is observable. One-shot. */
  holdNextLoad(): void;
  /** Release a load held via holdNextLoad(). No-op if not held. */
  releaseLoad(): void;
}

function makeWhisperFake(): WhisperFake {
  let realtimeCb: ((evt: unknown) => void) | null = null;
  let fileTranscript = 'Transcribed text';
  let rtActive = false; // the native mic session is capturing until stop()/release()
  // Load hold: opens the in-flight model-load window a real (seconds-long) ggml init has.
  let loadHoldPending = false;
  let loadHoldRelease: (() => void) | null = null;
  const context: Record<string, jest.Mock> = {
    // Faithful to whisper.rn: transcribe(path, opts) returns { stop, promise }, the promise resolving to
    // { result, segments } — this is the method whisperService.transcribeFile (the voice-mode file path) drives.
    transcribe: jest.fn((_path: string) => ({
      stop: jest.fn(async () => {}),
      promise: Promise.resolve({
        result: fileTranscript,
        segments: [{ text: fileTranscript, t0: 0, t1: 100 }],
      }),
    })),
    transcribeFile: jest.fn(async () => ({
      result: fileTranscript,
      segments: [{ text: fileTranscript, t0: 0, t1: 100 }],
    })),
    transcribeRealtime: jest.fn(async () => {
      rtActive = true; // native mic session starts capturing
      return {
        stop: jest.fn(async () => {
          rtActive =
            false; /* native stop; test drives the final event explicitly */
        }),
        subscribe: (cb: (evt: unknown) => void) => {
          realtimeCb = cb;
        },
      };
    }),
    release: jest.fn(async () => {
      realtimeCb = null;
      rtActive = false;
    }),
    bench: jest.fn(async () => ''),
  };
  const module: Record<string, jest.Mock> = {
    initWhisper: jest.fn(async () => {
      // A scripted hold parks the caller INSIDE the native load — the real device's
      // in-flight window between the load intent and readiness — until releaseLoad().
      if (loadHoldPending) {
        loadHoldPending = false;
        await new Promise<void>(res => {
          loadHoldRelease = res;
        });
      }
      return context;
    }),
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
        data: noData
          ? undefined
          : {
              result: text ?? '',
              segments: text ? [{ text, t0: 0, t1: 100 }] : [],
            },
        processTime: 10,
        recordingTime: recordingTime ?? 500,
      });
    },
    setFileTranscript: t => {
      fileTranscript = t;
    },
    hasRealtimeSubscriber: () => realtimeCb != null,
    realtimeActive: () => rtActive,
    holdNextLoad: () => {
      loadHoldPending = true;
    },
    releaseLoad: () => {
      const f = loadHoldRelease;
      loadHoldRelease = null;
      f?.();
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

/** Seed only the native RAM leaf without replacing the current React module graph. */
export function seedNativeRamBoundary(profile: RamProfile): void {
  const RN = require('react-native');
  const DeviceInfo = require('react-native-device-info');
  RN.NativeModules.DeviceMemoryModule = {
    getMemoryInfo: jest.fn(async () => ({
      processAvailableBytes: profile.availBytes,
      footprintBytes: profile.totalBytes - profile.availBytes,
    })),
  };
  (DeviceInfo.getTotalMemory as jest.Mock).mockResolvedValue(
    profile.totalBytes,
  );
  (DeviceInfo.getUsedMemory as jest.Mock).mockResolvedValue(
    profile.totalBytes - profile.availBytes,
  );
  Object.defineProperty(RN.Platform, 'OS', {
    value: profile.platform,
    configurable: true,
  });
  Object.defineProperty(RN.Platform, 'Version', {
    value: profile.platform === 'android' ? 34 : '17.0',
    configurable: true,
  });
}

/** Seed one file on the Jest-native RNFS leaf without replacing the React module graph. */
export function seedNativeFileBoundary(
  path: string,
  sizeBytes: number,
): () => void {
  const RNFS = require('react-native-fs');
  const previousExists = RNFS.exists.getMockImplementation();
  const previousStat = RNFS.stat.getMockImplementation();
  RNFS.exists.mockImplementation(async (candidate: string) =>
    candidate === path ? true : (await previousExists?.(candidate)) ?? false,
  );
  RNFS.stat.mockImplementation(async (candidate: string) =>
    candidate === path
      ? { size: sizeBytes, isFile: () => true, isDirectory: () => false }
      : previousStat(candidate),
  );
  return () => {
    if (previousExists) RNFS.exists.mockImplementation(previousExists);
    if (previousStat) RNFS.stat.mockImplementation(previousStat);
  };
}

// ---------------------------------------------------------------------------
// Fake: react-native-fs — a stateful in-memory filesystem (the REAL device leaf we can't run in node).
// Replaces the dumb global jest.setup stub (exists→false / readDir→[]) so the real listing/scan/
// integrity/finalize logic runs against a true disk the test seeds. Opt-in (installNativeBoundary({fs}))
// so it never perturbs tests that don't touch the filesystem.
// ---------------------------------------------------------------------------

export type FsFake = NativeFileSystemBoundary;

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
  /** GGUF chat_template exposed on the llama context's model.metadata — drives the REAL
   *  supportsNativeThinking (reasoning-delimiter detection). Omit for the reasoning-capable default;
   *  pass a marker-free template (e.g. Mistral's) to model a non-thinking model. */
  llamaChatTemplate?: string;
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
  /** Fire the OS 'memoryWarning' AppState event the app's residency manager listens to (auto-eviction). */
  emitMemoryWarning(): void;
}

/**
 * Seed NativeModules + npm-package handles for the given profile, BEFORE requiring services.
 * Call at the very top of a test body (after jest.resetModules is safe — this calls it), then
 * `require()` the screen/services you need so they capture the fakes.
 */
export function installNativeBoundary(opts: InstallOpts = {}): NativeBoundary {
  const ram: RamProfile = opts.ram ?? {
    platform: 'android',
    totalBytes: 12 * GB,
    availBytes: 8 * GB,
  };

  jest.resetModules();

  // A single emitter registry shared by every NativeEventEmitter built over our fake modules.
  const { add, handle } = makeEmitterRegistry();

  // LIVE process-memory state the RAM sensor reports from. Faithful to the device: releasing a model
  // context FREES memory (footprint drops, available rises), so the post-unload reclaim barrier
  // (memoryBudget.awaitMemoryReclaim) observes the drop and resolves — instead of timing out on a
  // frozen snapshot. A released llama context frees roughly a heavy model's worth (~3GB).
  const memState = {
    availBytes: ram.availBytes,
    footprintBytes: ram.totalBytes - ram.availBytes,
  };
  const freeModelMemory = () => {
    const freed = Math.min(memState.footprintBytes, 3 * GB);
    memState.footprintBytes -= freed;
    memState.availBytes += freed;
  };

  // Stateful FS: override the dumb global react-native-fs stub BEFORE any service requires it.
  const fsFake = opts.fs ? createNativeFileSystemBoundary() : undefined;
  const litert = makeLiteRTFake(handle);
  const downloadFake = opts.download
    ? makeDownloadFake(handle, (path, sizeBytes, sha256) => {
        fsFake?.seedFile(path, sizeBytes);
        if (sha256) fsFake?.setReportedHash(path, 'sha256', sha256);
      })
    : undefined;
  if (fsFake) jest.doMock('react-native-fs', () => fsFake.module);

  // Diffusion writes its rendered PNG to the (memfs) disk when fs is present, like the native module.
  const diffusion = makeDiffusionFake(fsFake);

  // Scriptable llama.rn: override the global stub so completion output is under test control.
  const llamaFake = opts.llama
    ? makeLlamaFake(freeModelMemory, opts.llamaChatTemplate)
    : undefined;
  if (llamaFake) jest.doMock('llama.rn', () => llamaFake.module);

  // Driveable whisper.rn: override the global stub so realtime/file transcription is under test control.
  const whisperFake = opts.whisper ? makeWhisperFake() : undefined;
  if (whisperFake) jest.doMock('whisper.rn', () => whisperFake.module);

  const RN = require('react-native');
  // resetModules() creates a fresh React Native View class after jest.setup installed the
  // host-measurement boundary. Restore the native layout callback on this module graph so anchored
  // controls open through their real measureInWindow path.
  RN.View.prototype.measureInWindow = (
    callback: (...values: number[]) => void,
  ): void => callback(0, 0, 100, 40);
  RN.NativeModules.LiteRTModule = litert.module;
  // Both platform names point at the same fake; localDreamGenerator's Platform.select picks one.
  RN.NativeModules.LocalDreamModule = diffusion.module;
  RN.NativeModules.CoreMLDiffusionModule = diffusion.module;
  if (downloadFake)
    RN.NativeModules.DownloadManagerModule = downloadFake.module;
  // Mic permission is a device boundary: whisper STT refuses to start recording without RECORD_AUDIO
  // granted (whisperService.requestPermissions → PermissionsAndroid.request). Grant it when whisper is
  // installed so the real STT flow runs; the default jest PermissionsAndroid returns undefined (= denied).
  if (whisperFake && RN.PermissionsAndroid) {
    RN.PermissionsAndroid.request = jest
      .fn()
      .mockResolvedValue(RN.PermissionsAndroid.RESULTS?.GRANTED ?? 'granted');
    RN.PermissionsAndroid.check = jest.fn().mockResolvedValue(true);
  }
  RN.NativeModules.DeviceMemoryModule = {
    // Live read from memState so a context release (freeModelMemory) is reflected — the reclaim barrier
    // must be able to SEE the footprint drop, exactly as it does on device.
    getMemoryInfo: jest.fn(async () => ({
      processAvailableBytes: memState.availBytes,
      footprintBytes: memState.footprintBytes,
    })),
  };
  Object.defineProperty(RN.Platform, 'OS', {
    value: ram.platform,
    configurable: true,
  });
  // OS version leaf: a supported device (Android API 34 / iOS 17). Engines gate feature support on
  // Platform.Version (e.g. Kokoro TTS requires Android >= 26 / iOS >= 17); default undefined reads as
  // unsupported, so seed a real supported version.
  Object.defineProperty(RN.Platform, 'Version', {
    value: ram.platform === 'android' ? 34 : '17.0',
    configurable: true,
  });

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

  // AppState capture: modelResidencyManager's constructor registers a REAL
  // AppState.addEventListener('memoryWarning', …) to reclaim idle sidecars on OS memory pressure. The RN jest
  // mock swallows the callback, so replace AppState with a capturing emitter and expose emitMemoryWarning()
  // to fire the OS memory-warning faithfully (OS event → the app's real listener → real handleMemoryWarning).
  const appState = makeEmitterRegistry();
  Object.defineProperty(RN, 'AppState', {
    configurable: true,
    value: {
      addEventListener: (event: string, cb: Listener) =>
        appState.add(event, cb),
      removeEventListener: () => {},
      currentState: 'active',
    },
  });

  // react-native-device-info total-memory leaf (npm package, already jest.mock-ed in jest.setup).

  const DeviceInfo = require('react-native-device-info');
  (DeviceInfo.getTotalMemory as jest.Mock).mockResolvedValue(ram.totalBytes);
  (DeviceInfo.getUsedMemory as jest.Mock).mockResolvedValue(
    ram.totalBytes - ram.availBytes,
  );

  const setRam = (profile: RamProfile) => {
    memState.availBytes = profile.availBytes;
    memState.footprintBytes = profile.totalBytes - profile.availBytes;
    (DeviceInfo.getTotalMemory as jest.Mock).mockResolvedValue(
      profile.totalBytes,
    );
    Object.defineProperty(RN.Platform, 'OS', {
      value: profile.platform,
      configurable: true,
    });
    Object.defineProperty(RN.Platform, 'Version', {
      value: profile.platform === 'android' ? 34 : '17.0',
      configurable: true,
    });
  };

  return {
    litert,
    litertEvents: handle,
    diffusion,
    fs: fsFake,
    llama: llamaFake,
    download: downloadFake,
    whisper: whisperFake,
    setRam,
    emitMemoryWarning: () => appState.handle.emit('memoryWarning'),
  };
}
