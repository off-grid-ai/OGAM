import { LlamaContext, RNLlamaOAICompatibleMessage } from 'llama.rn';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { statFile } from '../utils/fileStat';
import { Message, INFERENCE_BACKENDS } from '../types';
import { APP_CONFIG } from '../constants';
import { useAppStore } from '../stores/appStore';
import {
  initContextWithFallback, captureGpuInfo, logContextMetadata, getModelMaxContext,
  initMultimodal, checkContextMultimodal, recordGenerationStats, getStreamingDelta,
  hashString, ensureSessionCacheDir, getSessionPath, buildModelParams,
  buildCompletionParams, buildThinkingCompletionParams, supportsNativeThinking,
  getGpuLayersForDevice, BYTES_PER_GB,
  validateModelFile, checkMemoryForModel, safeCompletion, resolveSafeContext,
  describeGpuFallback, completionEnd, type CompletionEndFields, HTP_DEVICES,
} from './llmHelpers';
import { awaitMemoryReclaim, effectiveAvailableMB } from './memoryBudget';
import { modelResidencyManager } from './modelResidency';
import { hardwareService } from './hardware';
import { formatLlamaMessages, buildOAIMessages } from './llmMessages';
import { dropMissingImageAttachments, modelImageAttachments } from './llmImageInput';
import { generateWithToolsImpl } from './llmToolGeneration';
import type { ToolCall } from './tools/types';
import type { MultimodalSupport, LLMPerformanceSettings, LLMPerformanceStats } from './llmTypes';
import logger from '../utils/logger';
import { stateCacheBudgetMb, MOBILE_BACKEND_ROWS, splitGgufPartNames, type MobileBackend } from '@offgrid/models';
import { saveKvSession, loadKvSession } from './kvSessionStore';
import { readModelFileType } from './modelHeader';
import { installedMtpHeadPath } from './mtpHeads';
import { resolveSpeculative } from './mtpDetection';
import { copiedLoadEnded, copiedLoadStarted, startsInLowMemory } from './lowMemoryLoads';
import type { StreamToken } from './llmStreamTypes';
export type { StreamToken };
type StreamCallback = (data: StreamToken) => void;
type CompleteCallback = (result: { content: string; reasoningContent: string }) => void;
const resolveGpuBackend = (enabled: boolean, devices: string[]): string =>
  !enabled ? 'CPU' : (Platform.OS === 'ios' ? 'Metal' : (devices.join(', ') || 'OpenCL'));
/** A model's bytes on disk: every part of a split model, which llama.cpp loads from the first part's path. */
async function modelBytesOnDisk(modelPath: string): Promise<number> {
  const sizes = await Promise.all(splitGgufPartNames(modelPath).map(async part => (await statFile(part))?.size ?? 0));
  return sizes.reduce((total, size) => total + size, 0);
}

/** What Android frees by closing background apps before it kills the app in front. 7 GB phones
 *  loaded K2 Horizon 3.7B as a copy (about 4.4 GB with its KV cache) with a median 3.0 GB free,
 *  and crashed with 1.9 GB free (0.0.122, in-app analytics). */
const COPY_RECLAIM_BYTES = 1024 * 1024 * 1024;

class LLMService {
  private context: LlamaContext | null = null;
  private currentModelPath: string | null = null;
  private nativeConversationId: string | null = null; // owns native KV/recurrent state
  private loadedWithMtp: boolean = false;
  /** The model is loaded mapped because a copy would not fit in free RAM: slower, but loaded. */
  private loadedInLowMemory: boolean = false;
  private isGenerating: boolean = false;
  private activeCompletionPromise: Promise<void> | null = null;
  /** A Stop asked for during the current turn. llama.rn drops a stop sent before its completion starts
   *  (the turn may still be preparing its messages), so the turn checks this when the completion begins. */
  private stopRequested = false;
  /**
   * Every native call on the context that is running or about to start. Release waits for all of
   * them: freeing the context under a completion that was still being set up crashed the app inside
   * llama.rn's completion task (SIGSEGV in rnllama_jsi $_11, and a null Metal library mid-decode).
   */
  private readonly nativeWork = new Set<Promise<unknown>>();
  /** True from the moment a release begins; no new native work may start on the old context. */
  private releasingContext: boolean = false;
  /**
   * The context stopped answering: a completion ended with no EOS, stop word, cap, Stop or full window.
   * On iOS that is a Metal command buffer refused in background, and its error sticks to the context, so
   * every later completion on it is empty. It stays resident (Eject and memory accounting still see it),
   * but it is not ready: the next load through the residency lock replaces it.
   */
  private contextUnusable: boolean = false;
  private multimodalSupport: MultimodalSupport | null = null;
  private multimodalInitialized: boolean = false;
  private performanceStats: LLMPerformanceStats = { lastTokensPerSecond: 0, lastDecodeTokensPerSecond: 0, lastTimeToFirstToken: 0, lastGenerationTime: 0, lastTokenCount: 0 };
  private currentSettings: LLMPerformanceSettings = { nThreads: Platform.OS === 'android' ? 6 : 4, nBatch: 512, contextLength: 2048 };
  private gpuEnabled: boolean = false;
  private gpuReason: string = '';
  private gpuDevices: string[] = [];
  private activeGpuLayers: number = 0;
  private gpuAttemptFailed: boolean = false;
  private toolCallingSupported: boolean = false;
  private thinkingSupported: boolean = false;
  /** GPU layers the user's settings asked for at load time (pre device-cap/backend resolution).
   *  >0 with activeGpuLayers 0 means the load silently downgraded to CPU — the fallback-notice verdict. */
  private requestedGpuLayers: number = 0;
  private sessionCacheDir: string = `${RNFS.CachesDirectoryPath}/llm-sessions`;
  /** Serializes loadModel / unloadModel / reloadWithSettings to prevent concurrent native context init. */
  private contextMutexPromise: Promise<void> = Promise.resolve();
  private acquireContextMutex(): { release: () => void; ready: Promise<void> } {
    let release: () => void = () => {};
    const prev = this.contextMutexPromise;
    this.contextMutexPromise = new Promise<void>(resolve => { release = resolve; });
    return { release, ready: prev.catch(() => {}) };
  }
  /** Register native work synchronously, before its first await, so a release can wait for it. */
  private trackNativeWork<T>(work: Promise<T>): Promise<T> {
    const settled = work.then(() => { }, () => { });
    this.nativeWork.add(settled);
    // eslint-disable-next-line no-void
    void settled.then(() => { this.nativeWork.delete(settled); });
    return work;
  }
  /** The loaded context, or an error when there is none or it is being released. */
  /** The context with a completion that honours a Stop asked for before it started, or as it starts. */
  private stopAware(ctx: LlamaContext): LlamaContext {
    const complete = (params: unknown, onToken?: (data: any) => void) => {
      if (this.stopRequested) {
        logger.log('[LLM] Stop arrived before the completion started; not starting it');
        return Promise.resolve({ text: '', content: '', interrupted: true, tokens_predicted: 0 });
      }
      let resent = false;
      return ctx.completion(params as any, (data: any) => {
        // A Stop that landed while the native completion was starting was cleared by it: send it again.
        if (this.stopRequested && !resent) {
          resent = true;
          // llama.rn types stopCompletion() as a Promise, but its JSI sets the interrupt flag and
          // returns undefined: await it, never chain on what it returns.
          // eslint-disable-next-line no-void
          void (async () => {
            try { await ctx.stopCompletion(); } catch { /* the context is already gone: nothing to stop */ }
          })();
        }
        onToken?.(data);
      });
    };
    return new Proxy(ctx, {
      get: (target, key) => {
        if (key === 'completion') return complete;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  private usableContext(): LlamaContext {
    if (!this.context || this.releasingContext) throw new Error('No model loaded');
    return this.context;
  }
  private hashString(value: string): string { return hashString(value); }
  private ensureSessionCacheDir(): Promise<void> { return ensureSessionCacheDir(this.sessionCacheDir); }
  private getSessionPath(promptHash: string): string { return getSessionPath(this.sessionCacheDir, promptHash); }
  private async validateAndPrepareModel(modelPath: string, override: boolean = false, reclaimBytes: number = 0, mmProjPath?: string): Promise<{ fileSize: number; memCheck: Awaited<ReturnType<typeof checkMemoryForModel>>; params: ReturnType<typeof buildModelParams> }> {
    logger.log(`[LLM] validateAndPrepareModel: ${modelPath}`);
    if (!await RNFS.exists(modelPath)) throw new Error(`Model file not found at: ${modelPath}`);
    const validation = await validateModelFile(modelPath);
    if (!validation.valid) throw new Error(`Cannot load model: ${validation.reason}`);
    const settings = useAppStore.getState().settings;
    logger.log(`[LLM] User settings: threads=${settings.nThreads}, batch=${settings.nBatch}, ctx=${settings.contextLength}, gpu=${settings.enableGpu}, flashAttn=${settings.flashAttn}, cache=${settings.cacheType}`);
    const recommendedThreads = await hardwareService.getRecommendedThreadCount();
    // nThreads === 0 is the "auto" sentinel — substitute the hardware-recommended count.
    // Any explicit user choice (1–12) is respected as-is.
    const effectiveNThreads = settings.nThreads === 0 ? recommendedThreads : settings.nThreads;
    const speculativeDecoding = await resolveSpeculative(modelPath, settings.speculativeDecoding);
    const fileType = await readModelFileType(modelPath);
    const memory = await hardwareService.getAppMemoryUsage();
    const freeRamMb = memory.available / (1024 * 1024);
    const mtpHeadPath = speculativeDecoding ? await installedMtpHeadPath(modelPath) : undefined;
    const paramsFor = (lowMemory: boolean) => buildModelParams(
      modelPath,
      { ...settings, nThreads: effectiveNThreads, speculativeDecoding },
      { fileType, totalRamGb: memory.total / 1024 ** 3, stateCacheBudgetMb: stateCacheBudgetMb(freeRamMb), mtpHeadPath, lowMemory },
    );
    // A model that died loading as a copy before starts mapped (lowMemoryLoads).
    let params = paramsFor(await startsInLowMemory(modelPath));
    logger.log(`[LLM] Resolved params: threads=${params.nThreads}, batch=${params.nBatch}, ctx=${params.ctxLen}, gpuLayers=${params.nGpuLayers}, fileType=${fileType}, copies=${params.copiesWeights}`);
    const fileSize = await modelBytesOnDisk(modelPath);
    // The vision projector loads beside the model (initMultimodal), copied into memory, not mapped.
    const projectorFileSize = mmProjPath && await RNFS.exists(mmProjPath) ? (await statFile(mmProjPath))?.size ?? 0 : 0;
    // A model about to be released for this one gives its memory back.
    const getReleasedMem = async (): Promise<{ available: number; total: number; used: number }> => {
      const raw = await hardwareService.getAppMemoryUsage();
      return { ...raw, available: raw.available + reclaimBytes };
    };
    // A copy also gets what Android frees by closing background apps.
    const getFreeMem = async (): Promise<{ available: number; total: number; used: number }> => {
      const raw = await getReleasedMem();
      return { ...raw, available: raw.available + COPY_RECLAIM_BYTES };
    };
    // Mapped weights may count pages the OS can reclaim (Android: up to the physical budget).
    // Policy comes from the residency manager (the authoritative owner).
    const getMappedMem = async (): Promise<{ available: number; total: number; used: number }> => {
      const raw = await getReleasedMem();
      const availableMB = effectiveAvailableMB(raw.available / (1024 * 1024), raw.total / (1024 * 1024), {
        platform: Platform.OS,
        policy: modelResidencyManager.getLoadPolicy(),
      });
      return { ...raw, available: availableMB * 1024 * 1024 };
    };
    const systemAvailableBytes = Platform.OS === 'ios' ? await hardwareService.getSystemAvailableBytes() : null;
    // Copied weights are charged in full against what is free right now: no reclaim credit, since
    // the OS kills the app before it reclaims enough (7 GB Android, 0.0.122). Mapped weights are
    // bounded by the fit rule, and only the KV cache must fit in what is free.
    const check = (p: typeof params) => checkMemoryForModel({
      modelFileSize: fileSize, contextLength: p.ctxLen, getAvailableMemory: p.copiesWeights ? getFreeMem : getMappedMem,
      quantizedCache: !p.usesF16Cache, weightsMapped: !p.copiesWeights, projectorFileSize, systemAvailableBytes,
    });
    let memCheck = await check(params);
    if (!memCheck.safe && params.copiesWeights) {
      // Too big to copy into what is free: load it mapped (slower) instead of refusing or crashing.
      const mapped = paramsFor(true);
      const mappedCheck = await check(mapped);
      if (mappedCheck.safe || override) {
        logger.log(`[LLM] Low-memory mode: a copy needs ${memCheck.requiredMB.toFixed(0)}MB, ${memCheck.availableMB.toFixed(0)}MB free`);
        params = mapped;
        memCheck = mappedCheck;
      }
    }
    if (!memCheck.safe) {
      // Keep the selected context. A failed estimate asks for Load Anyway; an explicit
      // override passes the selected value to native init even when memory is tight.
      const decision = await resolveSafeContext({
        fileSize, requestedCtx: params.ctxLen, quantizedCache: !params.usesF16Cache, weightsMapped: !params.copiesWeights,
        projectorFileSize, override, getAvailableMemory: params.copiesWeights ? getFreeMem : getMappedMem, memCheck,
      });
      memCheck = decision.memCheck;
    }
    logger.log(`[LLM] Memory check: estimatedMB=${memCheck.estimatedMB.toFixed(0)}, availableMB=${memCheck.availableMB.toFixed(0)}, safe=${memCheck.safe}, ctx=${params.ctxLen}`);
    return { fileSize, memCheck, params };
  }
  private async applyLoadedContext(opts: { context: LlamaContext; actualLength: number; gpuAttemptFailed: boolean; nGpuLayers: number; requestedGpuLayers: number; modelPath: string; mmProjPath?: string }): Promise<void> {
    const { context, actualLength, gpuAttemptFailed, nGpuLayers, requestedGpuLayers, modelPath, mmProjPath } = opts;
    logContextMetadata(context, actualLength);
    logger.log(`[LLM] Native lib: ${(context as any).androidLib || 'N/A'}`);
    // Derive EVERYTHING on the local context first; publish in one synchronous block at the end.
    // isModelLoaded() (context !== null) is the readiness signal ensureModelReady trusts — publishing
    // it before the (seconds-long on device) multimodal probe + capability detection let a racing send
    // generate with stale thinkingSupported/toolCallingSupported (device log 2026-07-13 18:50: send at
    // :27.7 saw thinkingSupported=false; detection logged thinking:true at :30.4).
    const multimodal = mmProjPath
      ? await this.deriveMultimodalFromProjector(context, modelPath, mmProjPath)
      : { initialized: false, support: await checkContextMultimodal(context) };
    const toolCallingSupported = this.deriveToolCallingSupport(context);
    const thinkingSupported = supportsNativeThinking(context);
    this.context = context;
    this.contextUnusable = false;
    this.currentModelPath = modelPath;
    this.nativeConversationId = null;
    if (actualLength !== this.currentSettings.contextLength) this.currentSettings.contextLength = actualLength;
    this.multimodalInitialized = multimodal.initialized;
    this.multimodalSupport = multimodal.support;
    this.toolCallingSupported = toolCallingSupported;
    this.thinkingSupported = thinkingSupported;
    this.requestedGpuLayers = requestedGpuLayers;
    Object.assign(this, captureGpuInfo(context, gpuAttemptFailed, nGpuLayers));
    useAppStore.getState().setModelMaxContext(getModelMaxContext(context));
    logger.log(`[LLM] Model loaded, vision: ${this.supportsVision()}, tools: ${this.toolCallingSupported}, thinking: ${this.thinkingSupported}`);
  }
  async loadModel(modelPath: string, mmProjPath?: string, opts?: { override?: boolean }): Promise<void> {
    const mutex = this.acquireContextMutex();
    try {
      await mutex.ready;
      // Re-check after acquiring mutex — another call may have loaded the same model
      if (this.context && this.currentModelPath === modelPath && !this.contextUnusable) return;
      // Check the new model fits BEFORE releasing the current one: a refused switch must leave the
      // chat on the model it had, not on nothing. The current model's memory is counted as coming
      // back, since a switch that goes ahead releases it first. A context that stopped answering is
      // replaced the same way, even for the same file.
      const switching = !!this.context && (this.currentModelPath !== modelPath || this.contextUnusable);
      // A model in low-memory mode holds its weights as file pages, which already count as free.
      const reclaimBytes = switching && this.currentModelPath && !this.loadedInLowMemory ? await modelBytesOnDisk(this.currentModelPath) : 0;
      const { fileSize, memCheck, params } = await this.validateAndPrepareModel(modelPath, opts?.override, reclaimBytes, mmProjPath);
      if (switching) {
        logger.log('[LLM] Releasing previous context before loading new model');
        await this.doUnloadModel();
      }
      if (mmProjPath && !await RNFS.exists(mmProjPath)) { logger.warn('[LLM] MMProj file not found, disabling vision support'); mmProjPath = undefined; }
      const { baseParams, nThreads, nBatch, ctxLen, nGpuLayers } = params;
      this.currentSettings = { nThreads, nBatch, contextLength: ctxLen };
      this.loadedWithMtp = Boolean((baseParams as { speculative?: unknown }).speculative);
      logger.log(`[LLM] Loading model: ctx=${ctxLen}, threads=${nThreads}, batch=${nBatch}, fileSize=${(fileSize / (1024 * 1024)).toFixed(0)}MB, availRAM=${memCheck.availableMB.toFixed(0)}MB`);
      try {
        // A copy that kills the app leaves this marker; that model then starts mapped (lowMemoryLoads).
        if (params.copiesWeights) await copiedLoadStarted(modelPath);
        const { context, gpuAttemptFailed, actualLength, attemptedGpuLayers } = await this.initConfiguredContext({ baseParams, ctxLen, nGpuLayers, fileSize })
          .finally(() => params.copiesWeights ? copiedLoadEnded() : undefined);
        this.loadedInLowMemory = params.lowMemory;
        // attemptedGpuLayers (post device-cap/backend resolution) is what the init actually offered the
        // GPU — the truthful layer count for the meta; nGpuLayers is the raw settings request.
        await this.applyLoadedContext({ context, actualLength, gpuAttemptFailed, nGpuLayers: attemptedGpuLayers, requestedGpuLayers: nGpuLayers, modelPath, mmProjPath });
      } catch (error: any) {
        this.context = null; this.currentModelPath = null; this.nativeConversationId = null; this.multimodalSupport = null;
        this.toolCallingSupported = false; this.thinkingSupported = false;
        Object.assign(this, { gpuEnabled: false, gpuReason: '', activeGpuLayers: 0, gpuDevices: [], requestedGpuLayers: 0, gpuAttemptFailed: false });
        // Keep the original error: it carries why the load failed (llmHelpers' loadFailure).
        throw error instanceof Error ? error : new Error(error?.message || 'Unknown error loading model');
      }
    } finally {
      mutex.release();
    }
  }
  private async initConfiguredContext(params: { baseParams: object; ctxLen: number; nGpuLayers: number; fileSize: number }): Promise<{ context: LlamaContext; gpuAttemptFailed: boolean; actualLength: number; attemptedGpuLayers: number }> {
    const deviceInfo = await hardwareService.getDeviceInfo();
    // Pass model size + free RAM so iOS Metal offload is capped to what fits (the
    // uncapped 99-layer offload was overflowing Metal → SIGSEGV on memory-tight devices).
    let safeGpuLayers = getGpuLayersForDevice(deviceInfo.totalMemory, params.nGpuLayers, {
      modelBytes: params.fileSize,
      availableBytes: deviceInfo.availableMemory,
    });
    if (safeGpuLayers !== params.nGpuLayers) logger.log(`[LLM] GPU layers capped (${(deviceInfo.totalMemory / BYTES_PER_GB).toFixed(1)}GB RAM, ${Platform.OS}): ${params.nGpuLayers} → ${safeGpuLayers}`);
    let fallbackGpuLayers = 0;
    let resolvedBaseParams: object = params.baseParams;
    if (Platform.OS === 'android') {
      const settings = useAppStore.getState().settings;
      const backend = settings?.inferenceBackend ?? INFERENCE_BACKENDS.CPU;
      if (backend === INFERENCE_BACKENDS.HTP) {
        const gpuCapability = await hardwareService.getOpenCLCapability();
        fallbackGpuLayers = gpuCapability.supported ? safeGpuLayers : 0;
        // HTP routes to the Hexagon NPU — not subject to Adreno GPU layer caps,
        // but we still respect the RAM-based safeGpuLayers floor (0 on ≤4GB devices).
        safeGpuLayers = safeGpuLayers > 0 ? (settings?.gpuLayers ?? 99) : 0;
        resolvedBaseParams = { ...params.baseParams, devices: [...HTP_DEVICES] };
        const socInfo = await hardwareService.getSoCInfo();
        logger.log(`[LLM] HTP backend — offloading ${safeGpuLayers} layers to NPU (${socInfo.qnnVariant ?? 'unknown'})`);
      } else if (backend === INFERENCE_BACKENDS.OPENCL) {
        const capability = await hardwareService.getOpenCLCapability();
        if (!capability.supported) {
          logger.warn(`[LLM] OpenCL requested but not supported (${capability.reason}), falling back to CPU`);
          safeGpuLayers = 0;
        } else {
          // Respect the Adreno-specific RAM cap — safeGpuLayers already has it applied.
          logger.log(`[LLM] OpenCL backend — offloading ${safeGpuLayers} layers to GPU`);
        }
      } else {
        safeGpuLayers = 0;
        logger.log('[LLM] CPU backend selected');
      }
    }
    // The model metadata and the user's setting own context length. Do not impose a
    // second RAM-tier ceiling here. validateAndPrepareModel checks this exact
    // model + cache + selected context against live memory without changing it.
    return initContextWithFallback(resolvedBaseParams, params.ctxLen, safeGpuLayers, fallbackGpuLayers);
  }
  /** Multimodal init on a NOT-YET-PUBLISHED context (the load pipeline) — no instance-state writes. */
  private async deriveMultimodalFromProjector(context: LlamaContext, modelPath: string, mmProjPath: string): Promise<{ initialized: boolean; support: MultimodalSupport }> {
    try {
      const facts = await statFile(mmProjPath);
      if (!facts) throw new Error('Projector file metadata is unavailable');
      const sizeMB = facts.size / (1024 * 1024);
      logger.log(`[LLM] mmproj file size: ${sizeMB.toFixed(1)} MB`);
      if (sizeMB < 100) console.warn(`[LLM] WARNING: mmproj file seems too small (${sizeMB.toFixed(1)} MB)`);
    } catch (statErr) { console.error('[LLM] Failed to stat mmproj file:', statErr); }
    const devInfo = useAppStore.getState().deviceInfo;
    const useGpuForClip = Platform.OS === 'ios' && !devInfo?.isEmulator && (devInfo?.totalMemory ?? 0) > 4 * BYTES_PER_GB;
    const { initialized, support } = await initMultimodal(context, mmProjPath, useGpuForClip);
    logger.log(`[WIRE-VISION] ${JSON.stringify({ model: modelPath, mmProjPath, useGpuForClip, initialized, support })}`); // [WIRE] real multimodal init result
    return { initialized, support };
  }
  async initializeMultimodal(mmProjPath: string): Promise<boolean> {
    if (!this.context) { logger.warn('[LLM] initializeMultimodal: no context'); return false; }
    const { initialized, support } = await this.deriveMultimodalFromProjector(this.context, this.currentModelPath ?? '', mmProjPath);
    this.multimodalInitialized = initialized;
    this.multimodalSupport = support;
    return initialized;
  }
  async checkMultimodalSupport(): Promise<MultimodalSupport> {
    if (!this.context) { this.multimodalSupport = { vision: false, audio: false }; return this.multimodalSupport; }
    this.multimodalSupport = await checkContextMultimodal(this.context); return this.multimodalSupport;
  }
  getMultimodalSupport(): MultimodalSupport | null { return this.multimodalSupport; }
  supportsVision(): boolean { return this.multimodalSupport?.vision || false; }
  supportsToolCalling(): boolean { return this.toolCallingSupported; }
  supportsThinking(): boolean { return this.thinkingSupported; }
  isThinkingEnabled(): boolean { return this.thinkingSupported && useAppStore.getState().settings.thinkingEnabled; }
  isGemma4Model(): boolean {
    const path = this.currentModelPath?.toLowerCase() ?? '';
    return path.includes('gemma-4') || path.includes('gemma4');
  }
  /** Disable ctx_shift on Android when GPU layers are active — the OpenCL backend SIGSEGVs on the ggml set op used by KV cache shifting. */
  private shouldDisableCtxShift(): boolean { return Platform.OS === 'android' && this.activeGpuLayers > 0; }
  private deriveToolCallingSupport(context: LlamaContext): boolean {
    try {
      const jinja = (context as any)?.model?.chatTemplates?.jinja;
      logger.log('[LLM][TOOLS] Full jinja caps:', JSON.stringify(jinja));
      logger.log(`[WIRE-CAPS] ${JSON.stringify({ jinja })}`); // [WIRE] real chat-template tool caps
      const supported = !!(jinja?.defaultCaps?.toolCalls || jinja?.toolUse || jinja?.toolUseCaps?.toolCalls);
      logger.log('[LLM][TOOLS] toolCallingSupported =', supported);
      return supported;
    } catch (e) { logger.warn('[LLM] Error detecting tool calling support:', e); return false; }
  }
  /** Internal unload without acquiring the mutex (used by loadModel which already holds it). */
  private async doUnloadModel(): Promise<void> {
    if (!this.context) return;
    const context = this.context;
    this.releasingContext = true;
    try {
      if (this.isGenerating) {
        try { await context.stopCompletion(); } catch (e) { logger.log('[LLM] Stop during unload:', e); }
      }
      // Wait for every native call on this context, including one that had not reached the engine yet.
      // Re-checked after each wait: a call can start while the previous batch settles.
      while (this.nativeWork.size > 0) await Promise.all(this.nativeWork); // NOSONAR
      this.isGenerating = false;
      this.activeCompletionPromise = null;
      try { await context.release(); } catch (e) { logger.warn('[LLM] Error releasing context (bridge may be torn down):', e); }
      // The unload is not DONE until the native memory (weights + GPU/HTP buffers) is actually reclaimed.
      // context.release() returns before the OS frees those pages, so a reload that immediately loaded the
      // new context stacked BOTH models' memory at once → OOM/crash under pressure (device 2026-07-14: a
      // reload with ~2GB free ground to 0 tok/s then died). Wait (bounded) for the process footprint to drop.
      await awaitMemoryReclaim(() => hardwareService.getProcessMemory());
      useAppStore.getState().setModelMaxContext(null);
      Object.assign(this, { context: null, contextUnusable: false, currentModelPath: null, nativeConversationId: null, multimodalSupport: null, multimodalInitialized: false, toolCallingSupported: false, thinkingSupported: false, gpuEnabled: false, gpuReason: '', gpuDevices: [], activeGpuLayers: 0, requestedGpuLayers: 0, gpuAttemptFailed: false });
    } finally {
      // Only now: until the context is cleared, a caller must not get the released one.
      this.releasingContext = false;
    }
  }
  async unloadModel(): Promise<void> {
    const mutex = this.acquireContextMutex();
    try { await mutex.ready; await this.doUnloadModel(); } finally { mutex.release(); }
  }
  isModelLoaded(): boolean { return this.context !== null; }
  /** The loaded model runs in low-memory mode (mapped, no repack): slower until memory frees up. */
  isLowMemoryMode(): boolean { return this.context !== null && this.loadedInLowMemory; }
  /** A loaded context that still answers. False after a backend fault; the next load replaces it. */
  isContextUsable(): boolean { return this.context !== null && !this.contextUnusable; }
  /**
   * Read WHY a completion stopped — the ONE place every llama path records it. A reply that ended
   * early marks the context unusable, so the next send reloads the model instead of getting nothing.
   */
  private recordCompletionEnd(cr: CompletionEndFields | null | undefined): Pick<LLMPerformanceStats, 'lastTruncated' | 'lastEndedEarly'> {
    const end = completionEnd(cr, this.currentSettings.contextLength);
    if (end === 'ended-early') {
      logger.warn(`[LLM] Completion ended early (no EOS/stop/cap/interrupt): ${JSON.stringify({ model: this.currentModelPath, predicted: cr?.tokens_predicted, evaluated: cr?.tokens_evaluated })} — context marked for reload`);
      this.contextUnusable = true;
    }
    return { lastTruncated: end === 'token-limit', lastEndedEarly: end === 'ended-early' };
  }
  getLoadedModelPath(): string | null { return this.currentModelPath; }
  async generateResponse(messages: Message[], options?: { onStream?: StreamCallback; onComplete?: CompleteCallback; disableThinking?: boolean; maxTokens?: number }): Promise<string> {
    const { onStream, onComplete, ...opts } = options ?? {};
    const ctx = this.stopAware(this.usableContext());
    if (this.isGenerating) throw new Error('Generation already in progress');
    this.isGenerating = true;
    this.stopRequested = false;
    const completionWork = this.trackNativeWork((async () => {
      const managed = await this.manageContextWindow(messages);
      const usable = await this.dropMissingImageAttachments(managed);
      const hasImages = usable.some(m => modelImageAttachments(m.attachments).length > 0);
      if (hasImages && !this.multimodalInitialized) logger.warn('[LLM] Images attached but multimodal not initialized - falling back to text-only');
      logger.log('[LLM] Generation mode:', this.hasVisionInputs(usable) ? 'VISION' : 'TEXT-ONLY');
      const oaiMessages = this.convertToOAIMessages(usable);
      const { settings } = useAppStore.getState();
      const startTime = Date.now();
      let firstTokenMs = 0, tokenCount = 0, firstReceived = false;
      let fullContent = '', fullReasoningContent = '', streamedContentSoFar = '', streamedReasoningSoFar = '';
      const __wire: Array<Record<string, unknown>> = []; // [WIRE] capture raw per-token shape from-device
      // A caller may force thinking OFF (e.g. the image-prompt enhancement utility call),
      // regardless of the global thinkingEnabled — a rewrite is not a reasoning task, and
      // letting it think leaked "Thinking Process:..." into the enhanced prompt (B30).
      const thinkingOn = this.isThinkingEnabled() && !opts?.disableThinking;
      // A utility caller may need more room than the chat setting (a model that thinks before a rewrite).
      const completionSettings = opts?.maxTokens ? { ...settings, maxTokens: opts.maxTokens } : settings;
      const completionParams = { messages: oaiMessages, ...buildCompletionParams(completionSettings, { disableCtxShift: this.shouldDisableCtxShift() }), ...buildThinkingCompletionParams(thinkingOn, this.isGemma4Model(), settings.reasoningBudget) };
      logger.log(`[LLM][THINKING] thinkingSupported=${this.thinkingSupported}, thinkingEnabled=${useAppStore.getState().settings.thinkingEnabled}, isThinkingEnabled=${this.isThinkingEnabled()}, enable_thinking=${(completionParams as any).enable_thinking}, reasoning_format=${(completionParams as any).reasoning_format}`);
      logger.log(`[WIRE-LLAMA-PARAMS] ${JSON.stringify({ model: this.currentModelPath, params: { ...completionParams, messages: undefined } })}`); // [WIRE] settings→native params (temp/thinking/etc), messages elided
      const completionResult = await safeCompletion(ctx, () => ctx.completion(completionParams, (data: any) => {
        if (__wire.length < 500) __wire.push({ token: data.token, content: data.content, reasoning_content: data.reasoning_content, tool_calls: data.tool_calls }); // [WIRE]
        if (!this.isGenerating || !data.token) return;
        if (!firstReceived) { firstReceived = true; firstTokenMs = Date.now() - startTime; logger.log(`[LLM][THINKING] First token — hasContent=${!!data.content}, hasReasoning=${!!data.reasoning_content}`); }
        tokenCount++;
        const content = getStreamingDelta(data.content ?? (!data.reasoning_content ? data.token : undefined), streamedContentSoFar);
        const reasoningContent = getStreamingDelta(data.reasoning_content || undefined, streamedReasoningSoFar);
        if (data.content) streamedContentSoFar = data.content;
        else if (!data.reasoning_content && data.token) streamedContentSoFar += data.token;
        if (data.reasoning_content) streamedReasoningSoFar = data.reasoning_content;
        if (content) fullContent += content;
        if (reasoningContent) fullReasoningContent += reasoningContent;
        onStream?.({ reasoningContent, content });
      }), 'generateResponse');
      const cr = completionResult as any;
      // [WIRE] Full raw stream + final result, so we can build fixtures from real Gemma/Qwen wire format.
      // Shape only: the reply, reasoning and tool arguments never go in the log.
      logger.log(`[WIRE-LLAMA] ${JSON.stringify({ model: this.currentModelPath, events: __wire.length, final: { contentLength: cr?.content?.length ?? 0, textLength: cr?.text?.length ?? 0, reasoningLength: cr?.reasoning_content?.length ?? 0, toolCalls: cr?.tool_calls?.length ?? 0 } })}`);
      // Capture how the reply ended so the UI can flag a cut-off one (B15 cap, or a backend fault).
      this.performanceStats = {
        ...recordGenerationStats(startTime, firstTokenMs, tokenCount),
        lastPromptTokenCount: cr?.tokens_evaluated,
        ...this.recordCompletionEnd(cr),
      };
      if (completionResult?.context_full) { logger.log('[LLM] Context full detected — signalling for compaction'); throw new Error('Context is full'); }
      const result = { content: cr?.content || cr?.text || fullContent, reasoningContent: cr?.reasoning_content || fullReasoningContent };
      logger.log(`[LLM][THINKING] Final result — hasContent=${!!result.content}, hasReasoningContent=${!!result.reasoningContent}, reasoningLength=${result.reasoningContent?.length ?? 0}, fullReasoningFromStream=${fullReasoningContent.length}`);
      onComplete?.(result);
      return result.content;
    })());
    this.activeCompletionPromise = completionWork.then(() => { }, () => { });
    try { return await completionWork; } finally { this.isGenerating = false; this.activeCompletionPromise = null; }
  }
  async generateResponseWithTools(messages: Message[], options: { tools: any[]; onStream?: StreamCallback; onComplete?: CompleteCallback }): Promise<{ fullResponse: string; toolCalls: ToolCall[]; interrupted?: boolean }> {
    if (this.releasingContext) throw new Error('No model loaded');
    if (!this.isGenerating) this.stopRequested = false;
    const work = this.trackNativeWork(generateWithToolsImpl({
      context: this.context ? this.stopAware(this.context) : null, isGenerating: this.isGenerating,
      isThinkingEnabled: this.isThinkingEnabled(),
      isGemma4Model: this.isGemma4Model(),
      disableCtxShift: this.shouldDisableCtxShift(),
      manageContextWindow: (msgs, extra?) => this.manageContextWindow(msgs, extra),
      convertToOAIMessages: async msgs =>
        this.convertToOAIMessages(await this.dropMissingImageAttachments(msgs)),
      setPerformanceStats: (s) => { this.performanceStats = s; },
      recordCompletionEnd: (cr) => this.recordCompletionEnd(cr),
      setIsGenerating: (v) => { this.isGenerating = v; },
    }, messages, {
      tools: options.tools,
      onStream: options.onStream,
      onComplete: options.onComplete
        ? ((onComplete) => (fullResponse: string, reasoningContent: string) => onComplete({ content: fullResponse, reasoningContent }))(options.onComplete) : undefined,
    }));
    this.activeCompletionPromise = work.then(() => { }, () => { });
    try { return await work; } finally { this.activeCompletionPromise = null; }
  }
  /** No-op pass-through — lets llama.rn's native ctx_shift handle overflow for KV cache reuse. */
  private async manageContextWindow(messages: Message[], _extraReserve = 0): Promise<Message[]> {
    return messages;
  }
  /**
   * Drop image attachments whose files no longer exist before they reach the native
   * layer. A generated image's uri is a temp/cache path that gets cleaned up, so once
   * it's in the conversation history EVERY later turn (even a voice note) flips to
   * VISION mode and the native completion throws "File does not exist or cannot be
   * opened", killing the whole turn (silent empty bubble). Validating file inputs at
   * this boundary is the generation layer's own responsibility — a missing image is
   * simply not sent, so the turn runs (TEXT-ONLY if none remain) instead of crashing.
   */
  /**
   * Whether this turn should run in VISION mode: at least one message carries an
   * (already-existence-validated by {@link dropMissingImageAttachments}) image
   * attachment AND the multimodal projector is initialized. If images are present
   * but multimodal isn't initialized, we fall back to TEXT-ONLY.
   *
   * Note: this intentionally scans the WHOLE managed history, not just the latest
   * user turn — multi-turn vision legitimately references images sent earlier in the
   * conversation. TODO: if a future change requires scoping vision to the latest turn
   * only, revisit here (and the corresponding native context handling).
   */
  private hasVisionInputs(messages: Message[]): boolean {
    if (!this.multimodalInitialized) return false;
    return messages.some(m => modelImageAttachments(m.attachments).length > 0);
  }
  /** Generate a completion with a hard token cap (used for summarization, not user-facing). */
  async generateWithMaxTokens(messages: Message[], maxTokens: number): Promise<string> {
    const ctx = this.stopAware(this.usableContext());
    if (this.isGenerating) throw new Error('Generation already in progress');
    this.isGenerating = true;
    this.stopRequested = false;
    let fullResponse = '';
    // Registered before the attachment check awaits, so an unload in that gap waits for this call.
    const completionWork = this.trackNativeWork((async () => {
      const oaiMessages = this.convertToOAIMessages(
        await this.dropMissingImageAttachments(messages),
      );
      const { settings } = useAppStore.getState();
      const cr = await safeCompletion(ctx, () => ctx.completion(
        { messages: oaiMessages, ...buildCompletionParams(settings, { disableCtxShift: this.shouldDisableCtxShift() }), n_predict: maxTokens },
        (data) => { if (this.isGenerating && data.token) fullResponse += data.token; },
      ), 'generateWithMaxTokens');
      this.recordCompletionEnd(cr);
    })());
    this.activeCompletionPromise = completionWork.then(() => { }, () => { });
    try { await completionWork; return fullResponse.trim(); } finally { this.isGenerating = false; this.activeCompletionPromise = null; }
  }
  /** Ephemeral, tools-free routing pass for two-pass tool selection (not user-facing). */
  async generateToolSelection(systemPrompt: string, userText: string): Promise<string> {
    const messages: Message[] = [
      { id: 'tool-select-sys', role: 'system', content: systemPrompt, timestamp: 0 },
      { id: 'tool-select-user', role: 'user', content: userText, timestamp: 0 },
    ];
    try {
      return await this.generateWithMaxTokens(messages, 64);
    } finally {
      // The router is not part of the chat. Remove its prompt and recurrent state.
      await this.clearKVCache(true);
    }
  }
  async stopGeneration(): Promise<void> {
    if (this.isGenerating || this.activeCompletionPromise !== null) this.stopRequested = true;
    if (this.context) { try { await this.context.stopCompletion(); } catch (e) { logger.log('[LLM] Stop error:', e); } }
    // Declare idle only AFTER the in-flight completion actually unwinds — llama cannot honor a
    // stop during prefill (a 2.6k-token KB prefill unwound ~9s on-device), so clearing the flag
    // early made the readiness check say "free" while the native context was still busy, racing
    // the user's next send straight into 'LLM service busy' / a stale-stop-killed empty turn.
    if (this.activeCompletionPromise !== null) { await this.activeCompletionPromise; this.activeCompletionPromise = null; }
    this.isGenerating = false;
  }
  /** Wait (bounded) until no completion is in flight. Returns true when idle. */
  async waitForIdle(timeoutMs: number = 15000): Promise<boolean> {
    if (!this.isGenerating) return true;
    const active = this.activeCompletionPromise; // already swallow-wrapped, never rejects
    if (active !== null) await Promise.race([active, new Promise((r) => setTimeout(r, timeoutMs))]);
    return !this.isGenerating;
  }
  async clearKVCache(clearData: boolean = false): Promise<void> {
    if (!this.context || this.releasingContext || this.isGenerating) return;
    const context = this.context;
    try { await this.trackNativeWork((context as any).clearCache(clearData)); } catch (e) { logger.log('[LLM] Clear cache error:', e); }
  }
  /** Awaited generation boundary: a new chat never inherits native KV/recurrent state. */
  async prepareConversationBoundary(conversationId: string): Promise<void> {
    if (this.nativeConversationId === conversationId) return;
    const context = this.usableContext();
    if (this.isGenerating) throw new Error('Model is still finishing the previous reply');
    await this.trackNativeWork((async () => {
      // Keep the chat we are leaving, so coming back to it skips re-reading its history.
      await this.saveConversationState();
      await (context as any).clearCache(true);
      this.nativeConversationId = conversationId;
      logger.log(`[LLM] Native context reset for conversation ${conversationId}`);
      if (this.canSaveSessions() && this.currentModelPath) {
        await loadKvSession(context, this.sessionCacheDir, this.currentModelPath, conversationId);
      }
    })());
  }
  /** Saved KV state needs a backend llama.rn can save from (not OpenCL without kv_unified), and no
   *  MTP: the draft shares the KV cache and is reprocessed each turn anyway. */
  private canSaveSessions(): boolean {
    const configured = (useAppStore.getState().settings.inferenceBackend ?? 'cpu') as MobileBackend;
    const backend: MobileBackend = this.activeGpuLayers > 0 ? configured : 'cpu';
    return (MOBILE_BACKEND_ROWS[backend] ?? MOBILE_BACKEND_ROWS.cpu).sessionSave && !this.loadedWithMtp;
  }
  /** Save the active conversation's KV state (chat switch, app to background). A no-op mid-reply. */
  async saveConversationState(): Promise<void> {
    if (!this.context || this.releasingContext || this.isGenerating || !this.nativeConversationId || !this.currentModelPath) return;
    if (!this.canSaveSessions()) return;
    await this.trackNativeWork(saveKvSession(this.context, this.sessionCacheDir, this.currentModelPath, this.nativeConversationId));
  }
  getEstimatedMemoryUsage() {
    const contextMemoryMB = this.context ? (this.currentSettings.contextLength || 2048) * 0.5 : 0;
    return { contextMemoryMB, totalEstimatedMB: contextMemoryMB };
  }
  getGpuInfo() {
    return { gpu: this.gpuEnabled, gpuBackend: resolveGpuBackend(this.gpuEnabled, this.gpuDevices), gpuLayers: this.activeGpuLayers, reasonNoGPU: this.gpuReason };
  }
  /** The user-facing notice for a load that silently downgraded to CPU (GPU requested, 0 layers
   *  offloaded — init failure/timeout, capability refusal, or a RAM cap). Null when nothing to report. */
  getBackendFallbackNotice(): string | null {
    if (!this.context) return null;
    return describeGpuFallback({ requestedGpuLayers: this.requestedGpuLayers, activeGpuLayers: this.activeGpuLayers, gpuAttemptFailed: this.gpuAttemptFailed });
  }
  isCurrentlyGenerating(): boolean { return this.isGenerating; }
  private formatMessages(messages: Message[]): string { return formatLlamaMessages(messages, this.supportsVision(), this.multimodalSupport?.audio ?? false); }
  /** Native file checks stay at this service boundary; conversion stays pure. */
  private dropMissingImageAttachments(messages: Message[]): Promise<Message[]> {
    return dropMissingImageAttachments(messages);
  }
  private convertToOAIMessages(messages: Message[]): RNLlamaOAICompatibleMessage[] {
    return buildOAIMessages(messages, this.multimodalSupport?.audio ?? false);
  }
  async getModelInfo() { return this.context ? { contextLength: this.currentSettings.contextLength, vocabSize: 0 } : null; }
  async tokenize(text: string) {
    if (!this.context) throw new Error('No model loaded');
    return (await this.context.tokenize(text)).tokens || [];
  }
  async getTokenCount(text: string) {
    if (!this.context) throw new Error('No model loaded');
    return (await this.context.tokenize(text)).tokens?.length || 0;
  }
  async estimateContextUsage(messages: Message[]) {
    const tokenCount = await this.getTokenCount(this.formatMessages(messages));
    const ctxLen = this.currentSettings.contextLength || APP_CONFIG.maxContextLength;
    return { tokenCount, percentUsed: (tokenCount / ctxLen) * 100, willFit: tokenCount < ctxLen * 0.9 };
  }
  getFormattedPrompt(messages: Message[]): string { return this.formatMessages(messages); }
  async getContextDebugInfo(messages: Message[]) {
    const managed = await this.manageContextWindow(messages);
    const fmt = this.formatMessages(managed);
    let tokens = 0;
    try { if (this.context) tokens = (await this.context.tokenize(fmt)).tokens?.length || 0; }
    catch { tokens = Math.ceil(fmt.length / 4); }
    const sys = (m: Message[]) => m.filter(x => x.role === 'system').length;
    const ctx = this.currentSettings.contextLength || APP_CONFIG.maxContextLength;
    return {
      originalMessageCount: messages.length, managedMessageCount: managed.length,
      truncatedCount: (messages.length - sys(messages)) - (managed.length - sys(managed)),
      formattedPrompt: fmt, estimatedTokens: tokens, maxContextLength: ctx, contextUsagePercent: (tokens / ctx) * 100
    };
  }
  updatePerformanceSettings(settings: Partial<LLMPerformanceSettings>): void {
    this.currentSettings = { ...this.currentSettings, ...settings };
    logger.log('[LLM] Performance settings updated:', this.currentSettings);
  }
  getPerformanceSettings(): LLMPerformanceSettings { return { ...this.currentSettings }; }
  getPerformanceStats(): LLMPerformanceStats { return { ...this.performanceStats }; }
}
export const llmService = new LLMService();
