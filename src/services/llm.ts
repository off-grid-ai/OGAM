import { LlamaContext, RNLlamaOAICompatibleMessage } from 'llama.rn';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { Message, INFERENCE_BACKENDS } from '../types';
import { APP_CONFIG } from '../constants';
import { useAppStore } from '../stores/appStore';
import {
  initContextWithFallback, captureGpuInfo, logContextMetadata, getModelMaxContext,
  initMultimodal, checkContextMultimodal, recordGenerationStats, getStreamingDelta,
  hashString, ensureSessionCacheDir, getSessionPath, buildModelParams,
  buildCompletionParams, buildThinkingCompletionParams, supportsNativeThinking,
  getMaxContextForDevice, getGpuLayersForDevice, BYTES_PER_GB,
  validateModelFile, checkMemoryForModel, resolveSafeContext,
  describeGpuFallback, isTruncatedResult,
} from './llmHelpers';
import { awaitMemoryReclaim, effectiveAvailableMB } from './memoryBudget';
import { modelResidencyManager } from './modelResidency';
import { hardwareService } from './hardware';
import { formatLlamaMessages, buildOAIMessages } from './llmMessages';
import { generateWithToolsImpl } from './llmToolGeneration';
import { MtpSession } from './llmMtp';
import { deriveToolCallingSupport, resolveGpuBackend } from './llmCapabilities';
import type { ToolCall } from './tools/types';
import type { MultimodalSupport, LLMPerformanceSettings, LLMPerformanceStats } from './llmTypes';
import logger from '../utils/logger';
;
import type { StreamToken } from './llmStreamTypes';
export type { StreamToken };
type StreamCallback = (data: StreamToken) => void;
type CompleteCallback = (result: { content: string; reasoningContent: string }) => void;
class LLMService {
  private context: LlamaContext | null = null;
  private currentModelPath: string | null = null;
  private isGenerating: boolean = false;
  private activeCompletionPromise: Promise<void> | null = null;
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
  private mtp = new MtpSession();
  /** GPU layers the user's settings asked for at load time (pre device-cap/backend resolution).
   *  >0 with activeGpuLayers 0 means the load silently downgraded to CPU — the fallback-notice verdict. */
  private requestedGpuLayers: number = 0;
  private backendFallbackNoticeConsumed: boolean = false;
  private sessionCacheDir: string = `${RNFS.CachesDirectoryPath}/llm-sessions`;
  /** Serializes loadModel / unloadModel / reloadWithSettings to prevent concurrent native context init. */
  private contextMutexPromise: Promise<void> = Promise.resolve();
  private acquireContextMutex(): { release: () => void; ready: Promise<void> } {
    let release: () => void = () => {};
    const prev = this.contextMutexPromise;
    this.contextMutexPromise = new Promise<void>(resolve => { release = resolve; });
    return { release, ready: prev.catch(() => {}) };
  }
  private hashString(value: string): string { return hashString(value); }
  private ensureSessionCacheDir(): Promise<void> { return ensureSessionCacheDir(this.sessionCacheDir); }
  private getSessionPath(promptHash: string): string { return getSessionPath(this.sessionCacheDir, promptHash); }
  private async validateAndPrepareModel(modelPath: string, override: boolean = false): Promise<{ fileSize: number; memCheck: Awaited<ReturnType<typeof checkMemoryForModel>>; params: ReturnType<typeof buildModelParams> }> {
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
    const params = buildModelParams(modelPath, { ...settings, nThreads: effectiveNThreads });
    logger.log(`[LLM] Resolved params: threads=${params.nThreads}, batch=${params.nBatch}, ctx=${params.ctxLen}, gpuLayers=${params.nGpuLayers}`);
    const fileStat = await RNFS.stat(modelPath);
    const fileSize = typeof fileStat.size === 'string' ? Number.parseInt(fileStat.size, 10) : fileStat.size;
    // Use the EFFECTIVE cache type, not the raw setting: OpenCL/HTP coerce the KV cache
    // to f16 (see buildModelParams), so keying off settings.cacheType alone would let the
    // guard use the cheaper quantized estimate and approve a context that then OOMs.
    const quantizedCache = !params.usesF16Cache;
    // Feed the pre-load gate the SAME reclaim-aware available RAM the residency gate uses (the single owner,
    // effectiveAvailableMB) so the two can never disagree. On Android the raw os_proc snapshot under-counts a
    // foreground load (the LMK hands background apps' physical pages to us), so a raw gate REFUSED a model
    // residency ADMITTED — 12GB Android Aggressive, device qwythos. iOS returns raw unchanged (no reclaim —
    // jetsam kills us), so iOS is untouched. Policy comes from the residency manager (the authoritative owner).
    const getMem = async (): Promise<{ available: number; total: number; used: number }> => {
      const raw = await hardwareService.getAppMemoryUsage();
      const availableMB = effectiveAvailableMB(raw.available / (1024 * 1024), raw.total / (1024 * 1024), {
        platform: Platform.OS,
        policy: modelResidencyManager.getLoadPolicy(),
      });
      return { ...raw, available: availableMB * 1024 * 1024 };
    };
    let memCheck = await checkMemoryForModel({ modelFileSize: fileSize, contextLength: params.ctxLen, getAvailableMemory: getMem, quantizedCache });
    if (!memCheck.safe) {
      // Don't just warn and load into a near-certain native allocator crash (the iOS
      // metal_buffer_type_alloc_buffer / Android litert OOM clusters). Reduce context
      // to the largest size that fits; only block when the weights alone can't fit.
      const downgrade = await resolveSafeContext({ fileSize, requestedCtx: params.ctxLen, quantizedCache, override, getAvailableMemory: getMem });
      params.ctxLen = downgrade.ctxLen;
      memCheck = downgrade.memCheck;
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
    const toolCallingSupported = deriveToolCallingSupport(context);
    const thinkingSupported = supportsNativeThinking(context);
    this.context = context;
    this.currentModelPath = modelPath;
    if (actualLength !== this.currentSettings.contextLength) this.currentSettings.contextLength = actualLength;
    this.multimodalInitialized = multimodal.initialized;
    this.multimodalSupport = multimodal.support;
    this.toolCallingSupported = toolCallingSupported;
    this.thinkingSupported = thinkingSupported;
    this.requestedGpuLayers = requestedGpuLayers;
    this.backendFallbackNoticeConsumed = false;
    Object.assign(this, captureGpuInfo(context, gpuAttemptFailed, nGpuLayers));
    useAppStore.getState().setModelMaxContext(getModelMaxContext(context));
    logger.log(`[LLM] Model loaded, vision: ${this.supportsVision()}, tools: ${this.toolCallingSupported}, thinking: ${this.thinkingSupported}, mtp: ${this.mtp.description()}`);
  }
  async loadModel(modelPath: string, mmProjPath?: string, opts?: { override?: boolean }): Promise<void> {
    const mutex = this.acquireContextMutex();
    try {
      await mutex.ready;
      // Re-check after acquiring mutex — another call may have loaded the same model
      if (this.context && this.currentModelPath === modelPath) return;
      if (this.context && this.currentModelPath !== modelPath) {
        logger.log('[LLM] Releasing previous context before loading new model');
        await this.doUnloadModel();
      }
      const { fileSize, memCheck, params } = await this.validateAndPrepareModel(modelPath, opts?.override);
      if (mmProjPath && !await RNFS.exists(mmProjPath)) { logger.warn('[LLM] MMProj file not found, disabling vision support'); mmProjPath = undefined; }
      const { baseParams, nThreads, nBatch, ctxLen, nGpuLayers } = params;
      await this.mtp.prepare(modelPath, useAppStore.getState().settings.experimentalMtp === true);
      this.currentSettings = { nThreads, nBatch, contextLength: ctxLen };
      logger.log(`[LLM] Loading model: ctx=${ctxLen}, threads=${nThreads}, batch=${nBatch}, fileSize=${(fileSize / (1024 * 1024)).toFixed(0)}MB, availRAM=${memCheck.availableMB.toFixed(0)}MB`);
      try {
        const { context, gpuAttemptFailed, actualLength, attemptedGpuLayers } = await this.mtp.initialize(baseParams, resolved => this.initWithAutoContext({ baseParams: resolved, ctxLen, nGpuLayers, fileSize }));
        // attemptedGpuLayers (post device-cap/backend resolution) is what the init actually offered the
        // GPU — the truthful layer count for the meta; nGpuLayers is the raw settings request.
        await this.applyLoadedContext({ context, actualLength, gpuAttemptFailed, nGpuLayers: attemptedGpuLayers, requestedGpuLayers: nGpuLayers, modelPath, mmProjPath });
      } catch (error: any) {
        this.context = null; this.currentModelPath = null; this.multimodalSupport = null;
        this.toolCallingSupported = false; this.thinkingSupported = false; this.mtp.reset();
        Object.assign(this, { gpuEnabled: false, gpuReason: '', activeGpuLayers: 0, gpuDevices: [], requestedGpuLayers: 0, gpuAttemptFailed: false });
        throw new Error(error?.message || 'Unknown error loading model');
      }
    } finally {
      mutex.release();
    }
  }
  private async initWithAutoContext(params: { baseParams: object; ctxLen: number; nGpuLayers: number; fileSize: number }): Promise<{ context: LlamaContext; gpuAttemptFailed: boolean; actualLength: number; attemptedGpuLayers: number }> {
    const deviceInfo = await hardwareService.getDeviceInfo();
    // Pass model size + free RAM so iOS Metal offload is capped to what fits (the
    // uncapped 99-layer offload was overflowing Metal → SIGSEGV on memory-tight devices).
    let safeGpuLayers = getGpuLayersForDevice(deviceInfo.totalMemory, params.nGpuLayers, {
      modelBytes: params.fileSize,
      availableBytes: deviceInfo.availableMemory,
    });
    if (safeGpuLayers !== params.nGpuLayers) logger.log(`[LLM] GPU layers capped (${(deviceInfo.totalMemory / BYTES_PER_GB).toFixed(1)}GB RAM, ${Platform.OS}): ${params.nGpuLayers} → ${safeGpuLayers}`);
    let resolvedBaseParams: object = params.baseParams;
    if (Platform.OS === 'android') {
      const settings = useAppStore.getState().settings;
      const backend = settings?.inferenceBackend ?? INFERENCE_BACKENDS.CPU;
      if (backend === INFERENCE_BACKENDS.HTP) {
        // HTP routes to the Hexagon NPU — not subject to Adreno GPU layer caps,
        // but we still respect the RAM-based safeGpuLayers floor (0 on ≤4GB devices).
        safeGpuLayers = safeGpuLayers > 0 ? (settings?.gpuLayers ?? 99) : 0;
        resolvedBaseParams = { ...params.baseParams, devices: ['HTP0'] };
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
    // Cap the INITIAL context by device RAM. The KV cache + compute buffers scale
    // with n_ctx, so loading at the full 4096 on a 4GB phone spikes even a tiny
    // model past the ~2GB per-process limit → jetsam kill (confirmed: 2098MB on a
    // 4GB iPhone 12 mid-generation). The scale-down logic below never fired because
    // it only ever RAISES context; do the floor here so the first load is safe.
    const deviceCtxCap = getMaxContextForDevice(deviceInfo.totalMemory);
    const safeCtx = Math.min(params.ctxLen, deviceCtxCap);
    if (safeCtx !== params.ctxLen) logger.log(`[LLM] context capped for ${(deviceInfo.totalMemory / BYTES_PER_GB).toFixed(1)}GB RAM: ${params.ctxLen} → ${safeCtx}`);
    const initial = { ...await initContextWithFallback(resolvedBaseParams, safeCtx, safeGpuLayers), attemptedGpuLayers: safeGpuLayers };
    const modelMax = getModelMaxContext(initial.context);
    const userIsOnDefault = this.currentSettings.contextLength === APP_CONFIG.maxContextLength;
    if (!modelMax || !userIsOnDefault || modelMax <= initial.actualLength) return initial;
    const deviceMaxCtx = getMaxContextForDevice(deviceInfo.totalMemory);
    const targetCtx = Math.min(modelMax, 4096, deviceMaxCtx);
    if (targetCtx <= initial.actualLength) return initial;
    logger.log(`[LLM] Model supports ${modelMax} ctx, RAM cap ${deviceMaxCtx}, scaling ${initial.actualLength} → ${targetCtx}`);
    try { await initial.context.release(); } catch (e) { logger.warn('[LLM] Error releasing initial context:', e); }
    return { ...await initContextWithFallback(resolvedBaseParams, targetCtx, safeGpuLayers), attemptedGpuLayers: safeGpuLayers };
  }
  /** Multimodal init on a NOT-YET-PUBLISHED context (the load pipeline) — no instance-state writes. */
  private async deriveMultimodalFromProjector(context: LlamaContext, modelPath: string, mmProjPath: string): Promise<{ initialized: boolean; support: MultimodalSupport }> {
    try {
      const sizeMB = Number((await RNFS.stat(mmProjPath)).size) / (1024 * 1024);
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
  /** Internal unload without acquiring the mutex (used by loadModel which already holds it). */
  private async doUnloadModel(): Promise<void> {
    if (!this.context) return;
    if (this.isGenerating) {
      try { await this.context.stopCompletion(); } catch (e) { logger.log('[LLM] Stop during unload:', e); }
      this.isGenerating = false;
    }
    if (this.activeCompletionPromise !== null) { await this.activeCompletionPromise; this.activeCompletionPromise = null; }
    try { await this.context.release(); } catch (e) { logger.warn('[LLM] Error releasing context (bridge may be torn down):', e); }
    // The unload is not DONE until the native memory (weights + GPU/HTP buffers) is actually reclaimed.
    // context.release() returns before the OS frees those pages, so a reload that immediately loaded the
    // new context stacked BOTH models' memory at once → OOM/crash under pressure (device 2026-07-14: a
    // reload with ~2GB free ground to 0 tok/s then died). Wait (bounded) for the process footprint to drop.
    await awaitMemoryReclaim(() => hardwareService.getProcessMemory());
    useAppStore.getState().setModelMaxContext(null);
    this.mtp.reset();
    Object.assign(this, { context: null, currentModelPath: null, multimodalSupport: null, multimodalInitialized: false, toolCallingSupported: false, thinkingSupported: false, gpuEnabled: false, gpuReason: '', gpuDevices: [], activeGpuLayers: 0, requestedGpuLayers: 0, gpuAttemptFailed: false });
  }
  async unloadModel(): Promise<void> {
    const mutex = this.acquireContextMutex();
    try { await mutex.ready; await this.doUnloadModel(); } finally { mutex.release(); }
  }
  isModelLoaded(): boolean { return this.context !== null; }
  getLoadedModelPath(): string | null { return this.currentModelPath; }
  async generateResponse(messages: Message[], options?: { onStream?: StreamCallback; onComplete?: CompleteCallback; disableThinking?: boolean }): Promise<string> {
    const { onStream, onComplete, ...opts } = options ?? {};
    if (!this.context) throw new Error('No model loaded');
    if (this.isGenerating) throw new Error('Generation already in progress');
    this.isGenerating = true;
    const ctx = this.context;
    const completionWork = (async () => {
      const managed = await this.dropMissingImageAttachments(await this.manageContextWindow(messages));
      const hasImages = managed.some(m => m.attachments?.some(a => a.type === 'image'));
      if (hasImages && !this.multimodalInitialized) logger.warn('[LLM] Images attached but multimodal not initialized - falling back to text-only');
      const hasVisionInputs = this.hasVisionInputs(managed);
      logger.log('[LLM] Generation mode:', hasVisionInputs ? 'VISION' : 'TEXT-ONLY');
      const oaiMessages = this.convertToOAIMessages(managed);
      const { settings } = useAppStore.getState();
      const startTime = Date.now();
      let firstTokenMs = 0, tokenCount = 0, firstReceived = false;
      let fullContent = '', fullReasoningContent = '', streamedContentSoFar = '', streamedReasoningSoFar = '';
      const __wire: Array<Record<string, unknown>> = []; // [WIRE] capture raw per-token shape from-device
      // A caller may force thinking OFF (e.g. the image-prompt enhancement utility call),
      // regardless of the global thinkingEnabled — a rewrite is not a reasoning task, and
      // letting it think leaked "Thinking Process:..." into the enhanced prompt (B30).
      const thinkingOn = this.isThinkingEnabled() && !opts?.disableThinking;
      const completionParams = { messages: oaiMessages, ...buildCompletionParams(settings, { disableCtxShift: this.shouldDisableCtxShift() }), ...buildThinkingCompletionParams(thinkingOn, this.isGemma4Model()) };
      logger.log(`[LLM][THINKING] thinkingSupported=${this.thinkingSupported}, thinkingEnabled=${useAppStore.getState().settings.thinkingEnabled}, isThinkingEnabled=${this.isThinkingEnabled()}, enable_thinking=${(completionParams as any).enable_thinking}, reasoning_format=${(completionParams as any).reasoning_format}`);
      logger.log(`[WIRE-LLAMA-PARAMS] ${JSON.stringify({ model: this.currentModelPath, params: { ...completionParams, messages: undefined } })}`); // [WIRE] settings→native params (temp/thinking/etc), messages elided
      const completionResult = await this.mtp.complete(ctx, { params: completionParams, allowed: !hasVisionInputs, label: 'generateResponse', onToken: (data: any) => {
        if (__wire.length < 500) __wire.push({ token: data.token, content: data.content, reasoning_content: data.reasoning_content, tool_calls: data.tool_calls }); // [WIRE]
        if (!this.isGenerating || !data.token) return;
        if (!firstReceived) { firstReceived = true; firstTokenMs = Date.now() - startTime; logger.log(`[LLM][THINKING] First token raw data — token: ${JSON.stringify(data.token)}, content: ${JSON.stringify(data.content)}, reasoning_content: ${JSON.stringify(data.reasoning_content)}`); }
        tokenCount++;
        const content = getStreamingDelta(data.content ?? (!data.reasoning_content ? data.token : undefined), streamedContentSoFar);
        const reasoningContent = getStreamingDelta(data.reasoning_content || undefined, streamedReasoningSoFar);
        if (data.content) streamedContentSoFar = data.content;
        else if (!data.reasoning_content && data.token) streamedContentSoFar += data.token;
        if (data.reasoning_content) streamedReasoningSoFar = data.reasoning_content;
        if (content) fullContent += content;
        if (reasoningContent) fullReasoningContent += reasoningContent;
        onStream?.({ reasoningContent, content });
      } });
      const cr = completionResult as any;
      // [WIRE] Full raw stream + final result, so we can build fixtures from real Gemma/Qwen wire format.
      logger.log(`[WIRE-LLAMA] ${JSON.stringify({ model: this.currentModelPath, stream: __wire, final: { content: cr?.content, text: cr?.text, reasoning_content: cr?.reasoning_content, tool_calls: cr?.tool_calls } })}`);
      this.performanceStats = recordGenerationStats(startTime, firstTokenMs, tokenCount);
      Object.assign(this.performanceStats, this.mtp.performanceStats(cr));
      // Capture truncation (hit n_predict cap without EOS) so the UI can flag a cut-off
      // reply instead of it looking finished (B15).
      this.performanceStats.lastTruncated = isTruncatedResult(cr);
      if (completionResult?.context_full) { logger.log('[LLM] Context full detected — signalling for compaction'); throw new Error('Context is full'); }
      const result = { content: cr?.content || cr?.text || fullContent, reasoningContent: cr?.reasoning_content || fullReasoningContent };
      logger.log(`[LLM][THINKING] Final result — hasContent=${!!result.content}, hasReasoningContent=${!!result.reasoningContent}, reasoningLength=${result.reasoningContent?.length ?? 0}, fullReasoningFromStream=${fullReasoningContent.length}`);
      onComplete?.(result);
      return result.content;
    })();
    this.activeCompletionPromise = completionWork.then(() => { }, () => { });
    try { return await completionWork; } finally { this.isGenerating = false; this.activeCompletionPromise = null; }
  }
  async generateResponseWithTools(messages: Message[], options: { tools: any[]; onStream?: StreamCallback; onComplete?: CompleteCallback }): Promise<{ fullResponse: string; toolCalls: ToolCall[]; interrupted?: boolean }> {
    const work = generateWithToolsImpl({
      context: this.context, isGenerating: this.isGenerating,
      isThinkingEnabled: this.isThinkingEnabled(),
      isGemma4Model: this.isGemma4Model(),
      disableCtxShift: this.shouldDisableCtxShift(),
      manageContextWindow: (msgs, extra?) => this.manageContextWindow(msgs, extra),
      convertToOAIMessages: (msgs) => this.convertToOAIMessages(msgs),
      complete: (params, onToken, label) => this.mtp.complete(this.context!, { params, onToken, label, allowed: !messages.some(m => m.attachments?.some(a => a.type === 'image')) }),
      setPerformanceStats: (s, result) => { this.performanceStats = { ...s, ...this.mtp.performanceStats(result) }; },
      setIsGenerating: (v) => { this.isGenerating = v; },
    }, messages, {
      tools: options.tools,
      onStream: options.onStream,
      onComplete: options.onComplete
        ? ((onComplete) => (fullResponse: string, reasoningContent: string) => onComplete({ content: fullResponse, reasoningContent }))(options.onComplete) : undefined,
    });
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
  private async dropMissingImageAttachments(messages: Message[]): Promise<Message[]> {
    const out: Message[] = [];
    for (const m of messages) {
      const attachments = m.attachments;
      if (!attachments?.some(a => a.type === 'image')) { out.push(m); continue; }
      const kept: typeof attachments = [];
      for (const a of attachments) {
        if (a.type !== 'image') { kept.push(a); continue; }
        const path = (a.uri || '').replace(/^file:\/\//, '');
        const exists = path.length > 0 && await RNFS.exists(path).catch(() => false);
        if (exists) kept.push(a);
        else logger.warn(`[LLM] dropping missing image attachment (file gone): ${a.uri}`);
      }
      out.push(kept.length === attachments.length ? m : { ...m, attachments: kept });
    }
    return out;
  }
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
    return messages.some(m => m.attachments?.some(a => a.type === 'image'));
  }
  /** Generate a completion with a hard token cap (used for summarization, not user-facing). */
  async generateWithMaxTokens(messages: Message[], maxTokens: number): Promise<string> {
    if (!this.context) throw new Error('No model loaded');
    if (this.isGenerating) throw new Error('Generation already in progress');
    this.isGenerating = true;
    const oaiMessages = this.convertToOAIMessages(messages);
    const { settings } = useAppStore.getState();
    let fullResponse = '';
    const ctx = this.context;
    const completionWork = this.mtp.complete(ctx, { params: { messages: oaiMessages, ...buildCompletionParams(settings, { disableCtxShift: this.shouldDisableCtxShift() }), n_predict: maxTokens }, onToken: (data) => { if (this.isGenerating && data.token) fullResponse += data.token; }, label: 'generateWithMaxTokens' });
    this.activeCompletionPromise = completionWork.then(() => { }, () => { });
    try { await completionWork; return fullResponse.trim(); } finally { this.isGenerating = false; this.activeCompletionPromise = null; }
  }

  /** Ephemeral, tools-free routing pass for two-pass tool selection (not user-facing). */
  async generateToolSelection(systemPrompt: string, userText: string): Promise<string> {
    const messages: Message[] = [
      { id: 'tool-select-sys', role: 'system', content: systemPrompt, timestamp: 0 },
      { id: 'tool-select-user', role: 'user', content: userText, timestamp: 0 },
    ];
    return this.generateWithMaxTokens(messages, 64);
  }
  async stopGeneration(): Promise<void> {
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
    if (!this.context || this.isGenerating) return;
    try { await (this.context as any).clearCache(clearData); } catch (e) { logger.log('[LLM] Clear cache error:', e); }
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
  /** Consume this native load's downgrade once; UI callers choose where to render it. */
  consumeBackendFallbackNotice(): string | null {
    if (this.backendFallbackNoticeConsumed) return null;
    const notice = this.getBackendFallbackNotice();
    if (notice) this.backendFallbackNoticeConsumed = true;
    return notice;
  }
  isCurrentlyGenerating(): boolean { return this.isGenerating; }
  private formatMessages(messages: Message[]): string { return formatLlamaMessages(messages, this.supportsVision(), this.multimodalSupport?.audio ?? false); }
  private convertToOAIMessages(messages: Message[]): RNLlamaOAICompatibleMessage[] { return buildOAIMessages(messages, this.multimodalSupport?.audio ?? false); }
  async getModelInfo() { return this.context ? { contextLength: APP_CONFIG.maxContextLength, vocabSize: 0 } : null; }
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
