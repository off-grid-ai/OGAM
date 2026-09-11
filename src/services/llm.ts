import { LlamaContext, RNLlamaOAICompatibleMessage } from 'llama.rn';
import {
  mobileNativeRuntimeDefaults,
  nativeToolCallingSupported,
  normalizeGenerationDelta,
  reasoningWireFragment,
  resolveReasoningPlan,
  planTextAccelerator,
  type ReasoningWireFragment,
} from '@offgrid/models';
import { textLoadAdmission } from './composition/text-load';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { statFile } from '../utils/fileStat';
import { Message, INFERENCE_BACKENDS } from '../types';
import { APP_CONFIG } from '../constants';
import { useAppStore } from '../stores/appStore';
import {
  initContextWithFallback, captureGpuInfo, logContextMetadata, getModelMaxContext,
  initMultimodal, checkContextMultimodal, recordGenerationStats,
  ensureSessionCacheDir, getSessionPath, buildModelParams,
  buildCompletionParams, supportsNativeThinking,
  BYTES_PER_GB,
  safeCompletion,
  describeGpuFallback, isTruncatedResult, llamaReasoningMetadata,
} from './llmHelpers';
import { awaitMemoryReclaim } from './memoryBudget';
import { notReleased, RELEASED, type NativeRelease } from './nativeRelease';
import { applicationFacade } from './applicationFacade';
import { hardwareService } from './hardware';
import { formatLlamaMessages, buildOAIMessages } from './llmMessages';
import { dropMissingImageAttachments, modelImageAttachments } from './llmImageInput';
import type { MultimodalSupport, LLMPerformanceSettings, LLMPerformanceStats } from './llmTypes';
import logger from '../utils/logger';
import { resolveSpeculative } from './mtpDetection';
import type { CompleteCallback, StreamCallback } from './llmStreamTypes';
const resolveGpuBackend = (enabled: boolean, devices: string[]): string =>
  !enabled ? 'CPU' : (Platform.OS === 'ios' ? 'Metal' : (devices.join(', ') || 'OpenCL'));

const canonicalNativeSettings = () => {
  const settings = applicationFacade().models.snapshot().settings;
  const read = <T extends number | boolean | string>(key: string, kind: 'number' | 'boolean' | 'string'): T | undefined => {
    const value = settings[key];
    return typeof value === kind ? value as T : undefined;
  };

  return {
    nThreads: read<number>('nThreads', 'number'), nBatch: read<number>('nBatch', 'number'),
    contextLength: read<number>('contextLength', 'number'), gpuLayers: read<number>('gpuLayers', 'number'),
    maxTokens: read<number>('maxTokens', 'number'), temperature: read<number>('temperature', 'number'),
    topP: read<number>('topP', 'number'), repeatPenalty: read<number>('repeatPenalty', 'number'),
    reasoningBudget: read<number>('reasoningBudget', 'number'),
    flashAttn: read<boolean>('flashAttn', 'boolean'), enableGpu: read<boolean>('enableGpu', 'boolean'),
    speculativeDecoding: read<boolean>('speculativeDecoding', 'boolean'), thinkingEnabled: read<boolean>('thinkingEnabled', 'boolean'),
    cacheType: read<string>('cacheType', 'string'), inferenceBackend: read<string>('inferenceBackend', 'string'),
  };
};

class LLMService {
  private context: LlamaContext | null = null;
  private currentModelPath: string | null = null;
  private nativeConversationId: string | null = null; // owns native KV/recurrent state
  private isGenerating: boolean = false;
  private activeCompletionPromise: Promise<void> | null = null;
  private multimodalSupport: MultimodalSupport | null = null;
  private multimodalInitialized: boolean = false;
  private performanceStats: LLMPerformanceStats = { lastTokensPerSecond: 0, lastDecodeTokensPerSecond: 0, lastTimeToFirstToken: 0, lastGenerationTime: 0, lastTokenCount: 0 };
  private currentSettings: LLMPerformanceSettings = mobileNativeRuntimeDefaults(
    Platform.OS === 'android' ? 'android' : 'ios',
  );
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
  private contextMutexPromise: Promise<void> = Promise.resolve();
  private acquireContextMutex(): { release: () => void; ready: Promise<void> } {
    let release: () => void = () => {};
    const prev = this.contextMutexPromise;
    this.contextMutexPromise = new Promise<void>(resolve => { release = resolve; });
    return { release, ready: prev.catch(() => {}) };
  }
  private ensureSessionCacheDir(): Promise<void> { return ensureSessionCacheDir(this.sessionCacheDir); }
  private getSessionPath(promptHash: string): string { return getSessionPath(this.sessionCacheDir, promptHash); }
  private async validateAndPrepareModel(modelPath: string, override: boolean = false): Promise<{ fileSize: number; memCheck: { safe: boolean; estimatedMB: number; availableMB: number }; params: ReturnType<typeof buildModelParams> }> {
    logger.log(`[LLM] validateAndPrepareModel: ${modelPath}`);
    const settings = canonicalNativeSettings();
    logger.log(`[LLM] User settings: threads=${settings.nThreads}, batch=${settings.nBatch}, ctx=${settings.contextLength}, gpu=${settings.enableGpu}, flashAttn=${settings.flashAttn}, cache=${settings.cacheType}`);
    const recommendedThreads = await hardwareService.getRecommendedThreadCount();
    const effectiveNThreads = settings.nThreads === 0 ? recommendedThreads : settings.nThreads;
    const speculativeDecoding = await resolveSpeculative(modelPath, settings.speculativeDecoding);
    const params = buildModelParams(modelPath, { ...settings, nThreads: effectiveNThreads, speculativeDecoding });
    logger.log(`[LLM] Resolved params: threads=${params.nThreads}, batch=${params.nBatch}, ctx=${params.ctxLen}, gpuLayers=${params.nGpuLayers}`);
    const admission = await textLoadAdmission().admit({
      modelPath,
      requestedContextLength: params.ctxLen,
      quantizedCache: !params.usesF16Cache,
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      loadPolicy: applicationFacade().models.snapshot().loadPolicy,
      override,
    });
    const { fileSize, memory: memCheck } = admission;
    params.ctxLen = admission.contextLength;
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
      if (this.context && this.currentModelPath === modelPath) return;
      if (this.context && this.currentModelPath !== modelPath) {
        logger.log('[LLM] Releasing previous context before loading new model');
        await this.doUnloadModel();
      }
      const { fileSize, memCheck, params } = await this.validateAndPrepareModel(modelPath, opts?.override);
      if (mmProjPath && !await RNFS.exists(mmProjPath)) { logger.warn('[LLM] MMProj file not found, disabling vision support'); mmProjPath = undefined; }
      const { baseParams, nThreads, nBatch, ctxLen, nGpuLayers } = params;
      this.currentSettings = { nThreads, nBatch, contextLength: ctxLen };
      logger.log(`[LLM] Loading model: ctx=${ctxLen}, threads=${nThreads}, batch=${nBatch}, fileSize=${(fileSize / (1024 * 1024)).toFixed(0)}MB, availRAM=${memCheck.availableMB.toFixed(0)}MB`);
      try {
        const { context, gpuAttemptFailed, actualLength, attemptedGpuLayers } = await this.initConfiguredContext({ baseParams, ctxLen, nGpuLayers, fileSize });
        // attemptedGpuLayers (post device-cap/backend resolution) is what the init actually offered the
        // GPU — the truthful layer count for the meta; nGpuLayers is the raw settings request.
        await this.applyLoadedContext({ context, actualLength, gpuAttemptFailed, nGpuLayers: attemptedGpuLayers, requestedGpuLayers: nGpuLayers, modelPath, mmProjPath });
      } catch (error: any) {
        this.context = null; this.currentModelPath = null; this.nativeConversationId = null; this.multimodalSupport = null;
        this.toolCallingSupported = false; this.thinkingSupported = false;
        Object.assign(this, { gpuEnabled: false, gpuReason: '', activeGpuLayers: 0, gpuDevices: [], requestedGpuLayers: 0, gpuAttemptFailed: false });
        throw new Error(error?.message || 'Unknown error loading model');
      }
    } finally {
      mutex.release();
    }
  }
  private async initConfiguredContext(params: { baseParams: object; ctxLen: number; nGpuLayers: number; fileSize: number }): Promise<{ context: LlamaContext; gpuAttemptFailed: boolean; actualLength: number; attemptedGpuLayers: number }> {
    const deviceInfo = await hardwareService.getDeviceInfo();
    const settings = canonicalNativeSettings();
    const selected = settings?.inferenceBackend ??
      (Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU);
    const openClCapability = Platform.OS === 'android' && selected === INFERENCE_BACKENDS.OPENCL
      ? await hardwareService.getOpenCLCapability()
      : undefined;
    const accelerator = planTextAccelerator({
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      inferenceBackend: selected === INFERENCE_BACKENDS.HTP
        ? 'htp'
        : selected === INFERENCE_BACKENDS.OPENCL ? 'opencl' : 'cpu',
      totalMemoryBytes: deviceInfo.totalMemory,
      availableMemoryBytes: deviceInfo.availableMemory,
      modelBytes: params.fileSize,
      requestedLayers: params.nGpuLayers,
      openClSupported: openClCapability?.supported,
    });
    if (accelerator.gpuLayers !== params.nGpuLayers) {
      logger.log(`[LLM] Accelerator layers resolved (${(deviceInfo.totalMemory / BYTES_PER_GB).toFixed(1)}GB RAM, ${Platform.OS}): ${params.nGpuLayers} → ${accelerator.gpuLayers} (${accelerator.reason})`);
    }
    if (openClCapability && !openClCapability.supported) {
      logger.warn(`[LLM] OpenCL unavailable (${openClCapability.reason}); Shared selected CPU`);
    }
    if (accelerator.backend === 'htp') {
      const socInfo = await hardwareService.getSoCInfo();
      logger.log(`[LLM] HTP backend — offloading ${accelerator.gpuLayers} layers (${socInfo.qnnVariant ?? 'unknown'})`);
    }
    const resolvedBaseParams = accelerator.devices
      ? { ...params.baseParams, devices: accelerator.devices }
      : params.baseParams;
    return {
      ...await initContextWithFallback(resolvedBaseParams, params.ctxLen, accelerator.gpuLayers),
      attemptedGpuLayers: accelerator.gpuLayers,
    };
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
  getReasoningMetadata() { return llamaReasoningMetadata(this.context); }
  isThinkingEnabled(): boolean { return this.thinkingSupported && canonicalNativeSettings().thinkingEnabled === true; }
  isGemma4Model(): boolean {
    return this.getReasoningMetadata()?.reasoningFormat === 'auto';
  }
  /** Disable ctx_shift on Android when GPU layers are active — the OpenCL backend SIGSEGVs on the ggml set op used by KV cache shifting. */
  private shouldDisableCtxShift(): boolean { return Platform.OS === 'android' && this.activeGpuLayers > 0; }
  private deriveToolCallingSupport(context: LlamaContext): boolean {
    try {
      const jinja = (context as any)?.model?.chatTemplates?.jinja;
      logger.log('[LLM][TOOLS] Full jinja caps:', JSON.stringify(jinja));
      logger.log(`[WIRE-CAPS] ${JSON.stringify({ jinja })}`); // [WIRE] real chat-template tool caps
      const supported = nativeToolCallingSupported(jinja);
      logger.log('[LLM][TOOLS] toolCallingSupported =', supported);
      return supported;
    } catch (e) { logger.warn('[LLM] Error detecting tool calling support:', e); return false; }
  }
  /** Internal unload without acquiring the mutex (used by loadModel which already holds it). */
  private async doUnloadModel(): Promise<NativeRelease> {
    if (!this.context) return RELEASED;
    let release: NativeRelease = RELEASED;
    if (this.isGenerating) {
      try { await this.context.stopCompletion(); } catch (e) { logger.log('[LLM] Stop during unload:', e); }
      this.isGenerating = false;
    }
    if (this.activeCompletionPromise !== null) { await this.activeCompletionPromise; this.activeCompletionPromise = null; }
    try {
      await this.context.release();
    } catch (e) {
      logger.warn('[LLM] Error releasing context (bridge may be torn down):', e);
      // The context is still held by the engine. Residency must NOT admit the next model into
      // this memory, so the refusal is carried out rather than logged and forgotten.
      release = notReleased(e);
    }
    // The unload is not DONE until the native memory (weights + GPU/HTP buffers) is actually reclaimed.
    // context.release() returns before the OS frees those pages, so a reload that immediately loaded the
    // new context stacked BOTH models' memory at once → OOM/crash under pressure (device 2026-07-14: a
    // reload with ~2GB free ground to 0 tok/s then died). Wait (bounded) for the process footprint to drop.
    await awaitMemoryReclaim(() => hardwareService.getProcessMemory());
    useAppStore.getState().setModelMaxContext(null);
    Object.assign(this, { context: null, currentModelPath: null, nativeConversationId: null, multimodalSupport: null, multimodalInitialized: false, toolCallingSupported: false, thinkingSupported: false, gpuEnabled: false, gpuReason: '', gpuDevices: [], activeGpuLayers: 0, requestedGpuLayers: 0, gpuAttemptFailed: false });
    return release;
  }
  /** Answers whether the engine let go - see `nativeRelease`. */
  async unloadModel(): Promise<NativeRelease> {
    const mutex = this.acquireContextMutex();
    try { await mutex.ready; return await this.doUnloadModel(); } finally { mutex.release(); }
  }
  isModelLoaded(): boolean { return this.context !== null; }
  getLoadedModelPath(): string | null { return this.currentModelPath; }
  async runNativeCompletion(messages: Message[], options?: { onStream?: StreamCallback; onComplete?: CompleteCallback; disableThinking?: boolean; reasoningWire?: ReasoningWireFragment; tools?: unknown[] }): Promise<string> {
    const { onStream, onComplete, ...opts } = options ?? {};
    if (!this.context) throw new Error('No model loaded');
    if (this.isGenerating) throw new Error('Generation already in progress');
    this.isGenerating = true;
    const ctx = this.context;
    const completionWork = (async () => {
      const managed = await this.manageContextWindow(messages);
      const usable = await this.dropMissingImageAttachments(managed);
      const hasImages = usable.some(m => modelImageAttachments(m.attachments).length > 0);
      if (hasImages && !this.multimodalInitialized) logger.warn('[LLM] Images attached but multimodal not initialized - falling back to text-only');
      logger.log('[LLM] Generation mode:', this.hasVisionInputs(usable) ? 'VISION' : 'TEXT-ONLY');
      const oaiMessages = this.convertToOAIMessages(usable);
      const settings = canonicalNativeSettings();
      const startTime = Date.now();
      let firstTokenMs = 0, tokenCount = 0, firstReceived = false;
      let fullContent = '', fullReasoningContent = '', streamedContentSoFar = '', streamedReasoningSoFar = '';
      const __wire: Array<Record<string, unknown>> = []; // [WIRE] capture raw per-token shape from-device
      // Utility callers can still force thinking off; shared chat callers supply reasoningWire.
      const thinkingEnabled = this.thinkingSupported && settings.thinkingEnabled === true;
      const thinkingOn = thinkingEnabled && !opts?.disableThinking;
      const fallbackWire = reasoningWireFragment(resolveReasoningPlan(
        { enabled: thinkingOn, budgetTokens: settings.reasoningBudget }, this.getReasoningMetadata()));
      const completionParams = {
        messages: oaiMessages,
        ...buildCompletionParams(settings, { disableCtxShift: this.shouldDisableCtxShift() }),
        ...(opts.reasoningWire ?? fallbackWire),
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
      };
      logger.log(`[LLM][THINKING] thinkingSupported=${this.thinkingSupported}, thinkingEnabled=${settings.thinkingEnabled === true}, isThinkingEnabled=${thinkingEnabled}, enable_thinking=${(completionParams as any).enable_thinking}, reasoning_format=${(completionParams as any).reasoning_format}`);
      logger.log(`[WIRE-LLAMA-PARAMS] ${JSON.stringify({ model: this.currentModelPath, params: { ...completionParams, messages: undefined } })}`); // [WIRE] settings→native params (temp/thinking/etc), messages elided
      const completionResult = await safeCompletion(ctx, () => ctx.completion(completionParams, (data: any) => {
        if (__wire.length < 500) __wire.push({ token: data.token, content: data.content, reasoning_content: data.reasoning_content, tool_calls: data.tool_calls }); // [WIRE]
        if (!this.isGenerating || !data.token) return;
        if (!firstReceived) { firstReceived = true; firstTokenMs = Date.now() - startTime; logger.log(`[LLM][THINKING] First token raw data — token: ${JSON.stringify(data.token)}, content: ${JSON.stringify(data.content)}, reasoning_content: ${JSON.stringify(data.reasoning_content)}`); }
        tokenCount++;
        const normalized = normalizeGenerationDelta(
          data, { content: streamedContentSoFar, reasoning: streamedReasoningSoFar });
        const content = normalized.content;
        const reasoningContent = normalized.reasoning;
        if (data.content) streamedContentSoFar = data.content;
        else if (!data.reasoning_content && data.token) streamedContentSoFar += data.token;
        if (data.reasoning_content) streamedReasoningSoFar = data.reasoning_content;
        if (content) fullContent += content;
        if (reasoningContent) fullReasoningContent += reasoningContent;
        onStream?.({ reasoningContent, content });
      }), 'runNativeCompletion');
      const cr = completionResult as any;
      // [WIRE] Full raw stream + final result, so we can build fixtures from real Gemma/Qwen wire format.
      logger.log(`[WIRE-LLAMA] ${JSON.stringify({ model: this.currentModelPath, stream: __wire, final: { content: cr?.content, text: cr?.text, reasoning_content: cr?.reasoning_content, tool_calls: cr?.tool_calls } })}`);
      this.performanceStats = recordGenerationStats(startTime, firstTokenMs, tokenCount);
      // Capture truncation (hit n_predict cap without EOS) so the UI can flag a cut-off
      // reply instead of it looking finished (B15).
      this.performanceStats.lastTruncated = isTruncatedResult(cr);
      if (completionResult?.context_full) { logger.log('[LLM] Context full detected — signalling for compaction'); throw new Error('Context is full'); }
      const toolCalls = Array.isArray(cr?.tool_calls)
        ? cr.tool_calls.flatMap((call: any) => {
            const fn = call?.function;
            if (!fn?.name) return [];
            return [{
              id: call.id,
              name: fn.name,
              arguments:
                typeof fn.arguments === 'string'
                  ? fn.arguments
                  : JSON.stringify(fn.arguments ?? {}),
            }];
          })
        : undefined;
      const result = {
        content: cr?.content || cr?.text || fullContent,
        reasoningContent: cr?.reasoning_content || fullReasoningContent,
        toolCalls,
      };
      logger.log(`[LLM][THINKING] Final result — hasContent=${!!result.content}, hasReasoningContent=${!!result.reasoningContent}, reasoningLength=${result.reasoningContent?.length ?? 0}, fullReasoningFromStream=${fullReasoningContent.length}`);
      onComplete?.(result);
      return result.content;
    })();
    this.activeCompletionPromise = completionWork.then(() => { }, () => { });
    try { return await completionWork; } finally { this.isGenerating = false; this.activeCompletionPromise = null; }
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
  async runNativeCappedCompletion(messages: Message[], maxTokens: number): Promise<string> {
    if (!this.context) throw new Error('No model loaded');
    if (this.isGenerating) throw new Error('Generation already in progress');
    this.isGenerating = true;
    const oaiMessages = this.convertToOAIMessages(
      await this.dropMissingImageAttachments(messages),
    );
    const settings = canonicalNativeSettings();
    let fullResponse = '';
    const ctx = this.context;
    const completionWork = safeCompletion(ctx, () => ctx.completion(
      { messages: oaiMessages, ...buildCompletionParams(settings, { disableCtxShift: this.shouldDisableCtxShift() }), n_predict: maxTokens },
      (data) => { if (this.isGenerating && data.token) fullResponse += data.token; },
    ), 'runNativeCappedCompletion');
    this.activeCompletionPromise = completionWork.then(() => { }, () => { });
    try { await completionWork; return fullResponse.trim(); } finally { this.isGenerating = false; this.activeCompletionPromise = null; }
  }
  async stopGeneration(): Promise<void> {
    let stopFailure: unknown;
    if (this.context) {
      try { await this.context.stopCompletion(); }
      catch (error) { stopFailure = error; }
    }
    // Declare idle only AFTER the in-flight completion actually unwinds — llama cannot honor a
    // stop during prefill (a 2.6k-token KB prefill unwound ~9s on-device), so clearing the flag
    // early made the readiness check say "free" while the native context was still busy, racing
    // the user's next send straight into 'LLM service busy' / a stale-stop-killed empty turn.
    if (this.activeCompletionPromise !== null) { await this.activeCompletionPromise; this.activeCompletionPromise = null; }
    this.isGenerating = false;
    if (stopFailure) throw stopFailure;
  }
  async clearKVCache(clearData: boolean = false): Promise<void> {
    if (!this.context || this.isGenerating) return;
    try { await (this.context as any).clearCache(clearData); } catch (e) { logger.log('[LLM] Clear cache error:', e); }
  }
  /** Awaited generation boundary: a new chat never inherits native KV/recurrent state. */
  async prepareConversationBoundary(conversationId: string): Promise<void> {
    if (this.nativeConversationId === conversationId) return;
    if (!this.context) throw new Error('No model loaded');
    if (this.isGenerating) throw new Error('Model is still finishing the previous reply');
    await (this.context as any).clearCache(true);
    this.nativeConversationId = conversationId;
    logger.log(`[LLM] Native context reset for conversation ${conversationId}`);
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
