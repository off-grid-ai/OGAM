import { LlamaContext, RNLlamaOAICompatibleMessage } from 'llama.rn';
import { recordLlamaTimings } from '../atlasTools/speedHooks';
import { Platform } from 'react-native';
import { vulkanEngine, describeVulkanStatus } from './vulkanEngine';
import { modelLayerTotal, effectiveOffloadedLayers } from './gpuOffload';
import { acceleratorCandidates, requireGpuLayers } from './acceleratorSelection';
import type { InferenceBackend } from '../types';
import RNFS from 'react-native-fs';
import { Message, INFERENCE_BACKENDS } from '../types';
import { APP_CONFIG } from '../constants';
import { useAppStore } from '../stores/appStore';
import {
  initContextWithFallback, captureGpuInfo, logContextMetadata, getModelMaxContext,
  initMultimodal, checkContextMultimodal, recordGenerationStats, getStreamingDelta, nextStreamedContent,
  hashString, ensureSessionCacheDir, getSessionPath, buildModelParams,
  buildCompletionParams, buildThinkingCompletionParams, supportsNativeThinking,
  getMaxContextForDevice, getGpuLayersForDevice, BYTES_PER_GB,
  validateModelFile, checkMemoryForModel, safeCompletion, resolveSafeContext,
  describeGpuFallback, isTruncatedResult, mtpParams,
} from './llmHelpers';
import { awaitMemoryReclaim, effectiveAvailableMB } from './memoryBudget';
import { modelResidencyManager } from './modelResidency';
import { isOverridableMemoryError } from '../utils/modelLoadErrors';
import { hardwareService } from './hardware';
import { formatLlamaMessages, buildOAIMessages } from './llmMessages';
import { generateWithToolsImpl } from './llmToolGeneration';
import { fitMessagesToContext } from './contextWindow';
import type { ToolCall } from './tools/types';
import type { MultimodalSupport, LLMPerformanceSettings, LLMPerformanceStats } from './llmTypes';
import logger from '../utils/logger';
import { isGemma4Path, knownVerdict, recordVerdict, runOutputCheck, logOutputReport, describeBadOutput, type OutputCheck } from './outputHealth';
;
import type { StreamToken } from './llmStreamTypes';
export type { StreamToken };
type StreamCallback = (data: StreamToken) => void;
/** parsedContent: llama.rn's final parsed answer (no reasoning or tool markup), when it reported one. */
type CompleteCallback = (result: { content: string; reasoningContent: string; parsedContent?: string }) => void;
function resolveGpuBackend(enabled: boolean, devices: string[]): string {
  if (!enabled) return 'CPU';
  return Platform.OS === 'ios' ? 'Metal' : (devices.length > 0 ? devices.join(', ') : 'OpenCL');
}
class LLMService {
  private context: LlamaContext | null = null;
  private vulkanLoaded = false;
  private vulkanFallbackReason: string | null = null;
  private selectedBackend: InferenceBackend = INFERENCE_BACKENDS.CPU;
  private requestedBackendAtLoad: InferenceBackend | null = null;
  private acceleratorAttempts: string[] = [];
  private cpuForFileType = false;
  /** True while the loaded context drafts with an attached MTP file. */
  private lastOutputCheck: OutputCheck | null = null;
  private mtpActive = false;
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
  /** Offloadable layers in the loaded model (block_count + 1); -1 when unknown. */
  private totalModelLayers: number = -1;
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
  private hashString(value: string): string { return hashString(value); }
  private ensureSessionCacheDir(): Promise<void> { return ensureSessionCacheDir(this.sessionCacheDir); }
  private getSessionPath(promptHash: string): string { return getSessionPath(this.sessionCacheDir, promptHash); }
  private async validateAndPrepareModel(modelPath: string, override: boolean = false, backendOverride?: InferenceBackend): Promise<{ fileSize: number; memCheck: Awaited<ReturnType<typeof checkMemoryForModel>>; params: ReturnType<typeof buildModelParams> }> {
    logger.log(`[LLM] validateAndPrepareModel: ${modelPath}`);
    if (!await RNFS.exists(modelPath)) throw new Error(`Model file not found at: ${modelPath}`);
    const validation = await validateModelFile(modelPath);
    if (!validation.valid) throw new Error(`Cannot load model: ${validation.reason}`);
    const rawSettings = useAppStore.getState().settings;
    const backend = backendOverride ?? rawSettings.inferenceBackend;
    // HTP only accelerates selected quants. OpenCL can also support Q4_K
    // (subject to the actual native runtime); let its load probe decide.
    const accelerated = backend === INFERENCE_BACKENDS.OPENCL || backend === INFERENCE_BACKENDS.HTP;
    const quant = modelPath.split('/').pop() ?? '';
    const htpEligible = /(?:^|[-_.])(q4_0|q8_0)(?:\.|-|_|$)/i.test(quant);
    const openclEligible = htpEligible || /(?:^|[-_.])q4_k(?:_[sml])?(?:\.|-|$)/i.test(quant);
    this.cpuForFileType = false;
    if (Platform.OS === 'android' && accelerated && backend === INFERENCE_BACKENDS.HTP && !htpEligible) {
      throw new Error('This quantization is not supported by the NPU. Choose Auto to try another accelerator or explicitly select CPU.');
    }
    // OpenCL supports more quants than the HTP list; let the actual native load decide.
    void openclEligible;
    const contextLength = rawSettings.contextMode === 'auto'
      ? getMaxContextForDevice((await hardwareService.getDeviceInfo()).totalMemory)
      : rawSettings.contextLength;
    const settings = { ...rawSettings, inferenceBackend: backend, contextLength };
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
    const toolCallingSupported = this.deriveToolCallingSupport(context);
    const thinkingSupported = supportsNativeThinking(context);
    this.context = context;
    this.currentModelPath = modelPath;
    if (actualLength !== this.currentSettings.contextLength) this.currentSettings.contextLength = actualLength;
    this.multimodalInitialized = multimodal.initialized;
    this.multimodalSupport = multimodal.support;
    this.toolCallingSupported = toolCallingSupported;
    this.thinkingSupported = thinkingSupported;
    this.requestedGpuLayers = requestedGpuLayers;
    Object.assign(this, captureGpuInfo(context, gpuAttemptFailed, nGpuLayers));
    this.totalModelLayers = modelLayerTotal((context as any).model?.metadata);
    this.activeGpuLayers = effectiveOffloadedLayers(this.activeGpuLayers, this.totalModelLayers);
    useAppStore.getState().setModelMaxContext(getModelMaxContext(context));
    logger.log(`[LLM] Model loaded, vision: ${this.supportsVision()}, tools: ${this.toolCallingSupported}, thinking: ${this.thinkingSupported}`);
  }
  async loadModel(modelPath: string, mmProjPath?: string, opts?: { override?: boolean; forceCpu?: boolean; draftPath?: string; embeddedMtp?: boolean }): Promise<void> {
    const mutex = this.acquireContextMutex();
    try {
      await mutex.ready;
      const requested: InferenceBackend = opts?.forceCpu
        ? INFERENCE_BACKENDS.CPU : useAppStore.getState().settings.inferenceBackend;
      if (mmProjPath && !await RNFS.exists(mmProjPath)) {
        logger.warn('[LLM] MMProj file not found, disabling vision support');
        mmProjPath = undefined;
      }
      if (this.currentModelPath === modelPath && this.requestedBackendAtLoad === requested &&
          (this.context || this.vulkanLoaded) && (!mmProjPath || this.multimodalInitialized)) return;
      if (this.context || this.vulkanLoaded) await this.doUnloadModel();
      this.vulkanFallbackReason = null;
      this.lastOutputCheck = null;
      this.acceleratorAttempts = [];
      this.selectedBackend = INFERENCE_BACKENDS.CPU;
      this.requestedBackendAtLoad = null;

      const auto = Platform.OS === 'android' && requested === INFERENCE_BACKENDS.AUTO;
      let candidates: InferenceBackend[] = [requested];
      if (auto) {
        const [acceleration, vulkanFound, slowGpu] = await Promise.all([
          hardwareService.getAccelerationCapability(),
          vulkanEngine.isAvailable(),
          vulkanEngine.isSlowTextGpu(),
        ]);
        // The Mali-G57 runs text slower than the CPU (see isSlowTextGpu): Automatic uses the CPU there.
        candidates = acceleratorCandidates(
          { npu: acceleration.hasNpu, opencl: acceleration.hasGpu, vulkan: vulkanFound && !slowGpu },
          modelPath, !!mmProjPath,
        );
        candidates.push(INFERENCE_BACKENDS.CPU);
      }
      // Only Auto may try a different engine. Explicit NPU, GPU, and Vulkan
      // selections fail visibly rather than silently running on CPU.
      const failures: string[] = [];
      for (const backend of candidates) {
        try {
          const { fileSize, memCheck, params } = await this.validateAndPrepareModel(
            modelPath, opts?.override, backend,
          );
          const { baseParams, nThreads, nBatch, ctxLen, nGpuLayers } = params;
          this.currentSettings = { nThreads, nBatch, contextLength: ctxLen };
          logger.log(`[LLM] Trying ${backend}: ctx=${ctxLen}, file=${(fileSize / (1024 * 1024)).toFixed(0)}MB, RAM=${memCheck.availableMB.toFixed(0)}MB`);
          if (backend === INFERENCE_BACKENDS.VULKAN) {
            const runtime = await vulkanEngine.runtimeStatus();
            if (runtime.status !== 'ok') throw new Error(describeVulkanStatus(runtime));
            // Same device-RAM cap as OpenCL; 99 means "all layers that are safe here".
            const deviceInfo = await hardwareService.getDeviceInfo();
            const requestedLayers = getGpuLayersForDevice(deviceInfo.totalMemory,
              useAppStore.getState().settings.gpuLayers || 99,
              { modelBytes: fileSize, availableBytes: deviceInfo.availableMemory });
            requireGpuLayers('vulkan', requestedLayers);
            const contextLength = Math.min(ctxLen, 32768);
            // nThreads already counts only the fast cores on a big.LITTLE chip (see getRecommendedThreadCount).
            const loaded = await vulkanEngine.loadModel(modelPath, requestedLayers, contextLength, nThreads);
            if (!/vulkan/i.test(loaded.backend)) throw new Error(
              `Native model reported ${loaded.backend}, not Vulkan`,
            );
            if (loaded.offloadedGpuLayers === 0) throw new Error('Vulkan loaded the model with no GPU layers');
            this.vulkanLoaded = true;
            this.currentModelPath = modelPath;
            this.gpuEnabled = true;
            this.gpuDevices = [loaded.backend];
            this.totalModelLayers = loaded.totalLayers;
            this.requestedGpuLayers = requestedLayers;
            this.activeGpuLayers = loaded.offloadedGpuLayers > 0 ? loaded.offloadedGpuLayers : requestedLayers;
            this.gpuReason = loaded.offloadedGpuLayers > 0 ? ''
              : 'Model header unreadable; showing the requested Vulkan layer count';
            // The Vulkan engine (llama.kt) is text only: a model's picture file is not loaded.
            if (mmProjPath) {
              this.gpuReason = 'Pictures are off on the Vulkan GPU engine (text only). Choose CPU for pictures.';
              logger.log('[LLM] Vulkan: loaded text only; the picture file is not used on this engine');
            }
            this.currentSettings.contextLength = contextLength;
            this.toolCallingSupported = false;
            this.thinkingSupported = false;
            this.multimodalInitialized = false;
            this.multimodalSupport = null;
          } else {
            // An explicitly selected GPU/NPU must not silently initialize on CPU.
            // Auto may try other candidate engines, including CPU, and report the choice.
            const requireAcceleration = Platform.OS === 'android' &&
              backend !== INFERENCE_BACKENDS.CPU;
            // An attached MTP file speeds replies up; if the engine cannot start with it, load without it.
            const wantsMtp = useAppStore.getState().settings.useMtp !== false;
            const draftFile = opts?.draftPath && wantsMtp && await RNFS.exists(opts.draftPath) ? opts.draftPath : undefined;
            const draftOn = !!draftFile || (!!opts?.embeddedMtp && wantsMtp);
            const checkOutput = isGemma4Path(modelPath);
            const verdictKey = { model: modelPath, size: fileSize, backend, gpuLayers: nGpuLayers, variant: `batch ${nBatch}${useAppStore.getState().settings.cpuRepack === false ? ', CPU kernels off' : ''}` };
            if (checkOutput) {
              const known = await knownVerdict(verdictKey);
              if (known && !known.ok) throw new Error(describeBadOutput(backend, `${known.reason}; found by an earlier test on this phone`, !auto));
            }
            let init;
            try {
              init = await this.initWithAutoContext(
                { baseParams: { ...baseParams, ...mtpParams(draftFile, draftOn, !!opts?.embeddedMtp) }, ctxLen, nGpuLayers, fileSize },
                backend, requireAcceleration,
              );
              this.mtpActive = draftOn;
            } catch (mtpError) {
              if (!draftOn || isOverridableMemoryError(mtpError)) throw mtpError;
              logger.warn('[LLM] MTP file could not be used, loading without it:', mtpError);
              init = await this.initWithAutoContext({ baseParams, ctxLen, nGpuLayers, fileSize }, backend, requireAcceleration);
              this.mtpActive = false;
            }
            const { context, gpuAttemptFailed, actualLength, attemptedGpuLayers } = init;
            // Gemma 4 has produced noise ("<unused19><unused10>...", "<pad><pad>...") on a phone from a file that decodes correctly elsewhere.
            // Look at one short reply before anything else (pictures included) is set up on top of it; a bad one is a failed load.
            if (checkOutput) {
              const check = await runOutputCheck(context, { isGemma4: true });
              this.lastOutputCheck = check;
              logOutputReport(check, { model: modelPath.split('/').pop(), backend, gpuLayers: attemptedGpuLayers, context: actualLength, kvCache: 'f16', devices: String((context as any).devices ?? '') });
              await recordVerdict(verdictKey, check);
              if (!check.ok) {
                try { await context.release(); } catch { /* load failed */ }
                throw new Error(describeBadOutput(backend, check.reason, !auto));
              }
            }
            try {
              await this.applyLoadedContext({
                context, actualLength, gpuAttemptFailed,
                nGpuLayers: attemptedGpuLayers, requestedGpuLayers: nGpuLayers,
                modelPath, mmProjPath,
              });
            } catch (error) {
              try { await context.release(); } catch { /* load failed */ }
              throw error;
            }
          }
          this.selectedBackend = backend;
          this.requestedBackendAtLoad = requested;
          this.acceleratorAttempts = failures;
          return;
        } catch (error: any) {
          const message = String(error?.message || error || 'Native load failed');
          // A memory refusal is about the model, not the backend: keep its type so the UI
          // can offer "Load Anyway" (wrapping it in a plain Error lost that button).
          if (backend === INFERENCE_BACKENDS.VULKAN) {
            try { await vulkanEngine.unload(); } catch { /* bridge may be unavailable */ }
            this.vulkanFallbackReason = message;
          }
          this.context = null; this.vulkanLoaded = false; this.currentModelPath = null;
          this.multimodalSupport = null; this.multimodalInitialized = false;
          this.toolCallingSupported = false; this.thinkingSupported = false;
          Object.assign(this, {
            gpuEnabled: false, gpuReason: '', activeGpuLayers: 0, totalModelLayers: -1,
            gpuDevices: [], requestedGpuLayers: 0, gpuAttemptFailed: false,
          });
          failures.push(`${backend}: ${message.slice(0, 180)}`);
          // Preserve typed memory refusals through the backend loader. Wrapping
          // them in a generic Error removed the Load Anyway action in chat.
          if (isOverridableMemoryError(error)) throw error;
          if (!auto) {
            if (backend === INFERENCE_BACKENDS.VULKAN)
              throw new Error(`Vulkan GPU unavailable: ${message}. To keep going, set the backend to Automatic or CPU in the chat's generation settings.`);
            throw new Error(message);
          }
          // A timed-out native context may still be initializing; do not race a
          // second native backend against that unresolved work.
          if (/timed out after/i.test(message)) break;
        }
      }
      this.acceleratorAttempts = failures;
      throw new Error(`No compatible backend could load this model (including CPU). ${failures.join(' | ')}`);
    } finally {
      mutex.release();
    }
  }
  private async initWithAutoContext(params: { baseParams: object; ctxLen: number; nGpuLayers: number; fileSize: number }, selectedBackend?: InferenceBackend, strictAcceleration: boolean = false): Promise<{ context: LlamaContext; gpuAttemptFailed: boolean; actualLength: number; attemptedGpuLayers: number }> {
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
      const backend = selectedBackend ?? (settings?.inferenceBackend ?? INFERENCE_BACKENDS.CPU);
      if (backend === INFERENCE_BACKENDS.HTP) {
        // HTP routes to the Hexagon NPU, so the Adreno GPU layer caps do not apply; only
        // the ≤4GB floor does (the caps used to zero the NPU on 6GB phones too).
        if (!(await hardwareService.getSoCInfo()).hasNPU && strictAcceleration)
          throw new Error('HTP/NPU not supported by this device');
        safeGpuLayers = deviceInfo.totalMemory / BYTES_PER_GB > 4 ? (settings?.gpuLayers || 99) : 0;
        resolvedBaseParams = { ...params.baseParams, devices: ['HTP0'] };
        const socInfo = await hardwareService.getSoCInfo();
        logger.log(`[LLM] HTP backend — offloading ${safeGpuLayers} layers to NPU (${socInfo.qnnVariant ?? 'unknown'})`);
      } else if (backend === INFERENCE_BACKENDS.OPENCL) {
        const capability = await hardwareService.getOpenCLCapability();
        if (!capability.supported) {
          if (strictAcceleration) throw new Error(`OpenCL GPU unavailable: ${capability.reason}`);
          logger.warn(`[LLM] OpenCL unavailable: ${capability.reason}; CPU selected by legacy policy`);
          safeGpuLayers = 0;
        } else {
          // Respect the Adreno-specific RAM cap — safeGpuLayers already has it applied.
          // Name the OpenCL device: the default list can also include the Hexagon NPU.
          if (capability.devices?.length) resolvedBaseParams = { ...params.baseParams, devices: capability.devices };
          logger.log(`[LLM] OpenCL backend — offloading ${safeGpuLayers} layers to GPU${capability.devices?.length ? ` (${capability.devices.join(', ')})` : ''}`);
        }
      } else {
        safeGpuLayers = 0;
        logger.log('[LLM] CPU backend selected');
      }
    }
    if (strictAcceleration) requireGpuLayers(
      selectedBackend === INFERENCE_BACKENDS.HTP ? 'htp' : 'opencl', safeGpuLayers);
    // Cap the INITIAL context by device RAM. The KV cache + compute buffers scale
    // with n_ctx, so loading at the full 4096 on a 4GB phone spikes even a tiny
    // model past the ~2GB per-process limit → jetsam kill (confirmed: 2098MB on a
    // 4GB iPhone 12 mid-generation). The scale-down logic below never fired because
    // it only ever RAISES context; do the floor here so the first load is safe.
    const deviceCtxCap = getMaxContextForDevice(deviceInfo.totalMemory);
    const safeCtx = Math.min(params.ctxLen, deviceCtxCap);
    if (safeCtx !== params.ctxLen) logger.log(`[LLM] context capped for ${(deviceInfo.totalMemory / BYTES_PER_GB).toFixed(1)}GB RAM: ${params.ctxLen} → ${safeCtx}`);
    const initial = { ...await initContextWithFallback(resolvedBaseParams, safeCtx, safeGpuLayers, !strictAcceleration), attemptedGpuLayers: safeGpuLayers };
    const modelMax = getModelMaxContext(initial.context);
    const userIsOnDefault = this.currentSettings.contextLength === APP_CONFIG.maxContextLength;
    if (!modelMax || !userIsOnDefault || modelMax <= initial.actualLength) return initial;
    const deviceMaxCtx = getMaxContextForDevice(deviceInfo.totalMemory);
    const targetCtx = Math.min(modelMax, 4096, deviceMaxCtx);
    if (targetCtx <= initial.actualLength) return initial;
    logger.log(`[LLM] Model supports ${modelMax} ctx, RAM cap ${deviceMaxCtx}, scaling ${initial.actualLength} → ${targetCtx}`);
    try { await initial.context.release(); } catch (e) { logger.warn('[LLM] Error releasing initial context:', e); }
    return { ...await initContextWithFallback(resolvedBaseParams, targetCtx, safeGpuLayers, !strictAcceleration), attemptedGpuLayers: safeGpuLayers };
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
  /** Android OpenCL/HTP shifting can crash in KV-cache ggml ops. Backend selection
   * is more reliable than reported layer count, which some drivers omit. */
  private shouldDisableCtxShift(): boolean {
    return Platform.OS === 'android' && (
      this.selectedBackend === INFERENCE_BACKENDS.OPENCL ||
      this.selectedBackend === INFERENCE_BACKENDS.HTP ||
      this.activeGpuLayers > 0
    );
  }
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
    if (this.vulkanLoaded) {
      await vulkanEngine.interrupt().catch(() => {});
      await vulkanEngine.unload();
      this.vulkanLoaded = false;
      this.currentModelPath = null;
      this.selectedBackend = INFERENCE_BACKENDS.CPU;
      this.requestedBackendAtLoad = null;
      this.isGenerating = false;
      this.activeCompletionPromise = null;
      this.gpuEnabled = false;
      this.gpuDevices = [];
      this.gpuReason = '';
      this.activeGpuLayers = 0;
      this.requestedGpuLayers = 0;
      useAppStore.getState().setModelMaxContext(null);
      return;
    }
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
    Object.assign(this, { context: null, currentModelPath: null, multimodalSupport: null, multimodalInitialized: false, toolCallingSupported: false, thinkingSupported: false, gpuEnabled: false, gpuReason: '', gpuDevices: [], activeGpuLayers: 0, requestedGpuLayers: 0, gpuAttemptFailed: false });
    this.selectedBackend = INFERENCE_BACKENDS.CPU;
    this.requestedBackendAtLoad = null;
  }
  async unloadModel(): Promise<void> {
    const mutex = this.acquireContextMutex();
    try { await mutex.ready; await this.doUnloadModel(); } finally { mutex.release(); }
  }
  isModelLoaded(): boolean { return this.context !== null || this.vulkanLoaded; }
  getLoadedModelPath(): string | null { return this.currentModelPath; }
  async generateResponse(messages: Message[], options?: { onStream?: StreamCallback; onComplete?: CompleteCallback; disableThinking?: boolean }): Promise<string> {
    const { onStream, onComplete, ...opts } = options ?? {};
    if (this.vulkanLoaded) {
      if (this.isGenerating) throw new Error('Generation already in progress');
      this.isGenerating = true;
      const started = Date.now();
      let output = '';
      let firstTokenMs = 0;
      let tokenCount = 0;
      const task = (async () => {
        const { settings } = useAppStore.getState();
        const maxTokens = Math.max(1, Math.min(settings.maxTokens || 512, 4096,
          Math.floor(this.currentSettings.contextLength * 0.4)));
        const managed = await this.manageContextWindow(messages, maxTokens);
        const prompt = await vulkanEngine.formatChat(managed.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })));
        await vulkanEngine.generate(prompt, maxTokens, token => {
          if (!this.isGenerating || !token) return;
          if (!firstTokenMs) firstTokenMs = Date.now() - started;
          tokenCount++;
          output += token;
          onStream?.({ content: token, reasoningContent: '' });
        }, { temperature: settings.temperature, topP: settings.topP,
          repeatPenalty: settings.repeatPenalty });
        this.performanceStats = recordGenerationStats(started, firstTokenMs, tokenCount);
        onComplete?.({ content: output, reasoningContent: '' });
        return output;
      })();
      this.activeCompletionPromise = task.then(() => {}, () => {});
      try { return await task; } finally { this.isGenerating = false; this.activeCompletionPromise = null; }
    }
    if (!this.context) throw new Error('No model loaded');
    if (this.isGenerating) throw new Error('Generation already in progress');
    this.isGenerating = true;
    const ctx = this.context;
    const completionWork = (async () => {
      const managed = await this.dropMissingImageAttachments(await this.manageContextWindow(messages));
      const hasImages = managed.some(m => m.attachments?.some(a => a.type === 'image'));
      if (hasImages && !this.multimodalInitialized) logger.warn('[LLM] Images attached but multimodal not initialized - falling back to text-only');
      logger.log('[LLM] Generation mode:', this.hasVisionInputs(managed) ? 'VISION' : 'TEXT-ONLY');
      const oaiMessages = this.convertToOAIMessages(managed);
      const { settings } = useAppStore.getState();
      const startTime = Date.now();
      let firstTokenMs = 0, tokenCount = 0, firstReceived = false;
      let fullContent = '', fullReasoningContent = '', streamedContentSoFar = '', streamedReasoningSoFar = '';
      // A caller may force thinking OFF (e.g. the image-prompt enhancement utility call),
      // regardless of the global thinkingEnabled — a rewrite is not a reasoning task, and
      // letting it think leaked "Thinking Process:..." into the enhanced prompt (B30).
      const thinkingOn = this.isThinkingEnabled() && !opts?.disableThinking;
      const completionParams = { messages: oaiMessages, ...buildCompletionParams(settings, { disableCtxShift: this.shouldDisableCtxShift() }), ...buildThinkingCompletionParams(thinkingOn, this.isGemma4Model()) };
      logger.log(`[LLM][THINKING] thinkingSupported=${this.thinkingSupported}, thinkingEnabled=${useAppStore.getState().settings.thinkingEnabled}, isThinkingEnabled=${this.isThinkingEnabled()}, enable_thinking=${(completionParams as any).enable_thinking}, reasoning_format=${(completionParams as any).reasoning_format}`);
      // Never log chat prompts, streamed text, reasoning, or model file paths: even
      // development logcat output may outlive private/PIN-protected conversations.
      logger.log(`[LLM] Native completion settings: thinking=${thinkingOn}, contextShiftDisabled=${this.shouldDisableCtxShift()}`);
      const completionResult = await safeCompletion(ctx, () => ctx.completion(completionParams, (data: any) => {
        if (!this.isGenerating || !data.token) return;
        if (!firstReceived) { firstReceived = true; firstTokenMs = Date.now() - startTime; logger.log('[LLM] First token received'); }
        tokenCount++;
        const content = getStreamingDelta(nextStreamedContent(data, streamedContentSoFar), streamedContentSoFar);
        const reasoningContent = getStreamingDelta(data.reasoning_content || undefined, streamedReasoningSoFar);
        // Track what was displayed, not the parser's latest value (see getStreamingDelta).
        if (content) streamedContentSoFar += content;
        if (reasoningContent) streamedReasoningSoFar += reasoningContent;
        if (content) fullContent += content;
        if (reasoningContent) fullReasoningContent += reasoningContent;
        onStream?.({ reasoningContent, content });
      }), 'generateResponse');
      const cr = completionResult as any;
      logger.log(`[LLM] Native completion finished: content=${!!(cr?.content || cr?.text)}, reasoning=${!!cr?.reasoning_content}, toolCalls=${Array.isArray(cr?.tool_calls) ? cr.tool_calls.length : 0}`);
      this.performanceStats = recordGenerationStats(startTime, firstTokenMs, tokenCount);
      // Capture truncation (hit n_predict cap without EOS) so the UI can flag a cut-off
      // reply instead of it looking finished (B15).
      this.performanceStats.lastTruncated = isTruncatedResult(cr);
      recordLlamaTimings(cr, this.performanceStats.lastDecodeTokensPerSecond);
      if (completionResult?.context_full) { logger.log('[LLM] Context full detected — signalling for compaction'); throw new Error('Context is full'); }
      const result = { content: cr?.content || cr?.text || fullContent, reasoningContent: cr?.reasoning_content || fullReasoningContent, parsedContent: typeof cr?.content === 'string' ? cr.content : undefined };
      logger.log(`[LLM][THINKING] Final result — hasContent=${!!result.content}, hasReasoningContent=${!!result.reasoningContent}, reasoningLength=${result.reasoningContent?.length ?? 0}, fullReasoningFromStream=${fullReasoningContent.length}`);
      onComplete?.(result);
      return result.content;
    })();
    this.activeCompletionPromise = completionWork.then(() => { }, () => { });
    try { return await completionWork; } finally { this.isGenerating = false; this.activeCompletionPromise = null; }
  }
  async generateResponseWithTools(messages: Message[], options: { tools: any[]; onStream?: StreamCallback; onComplete?: CompleteCallback }): Promise<{ fullResponse: string; toolCalls: ToolCall[]; interrupted?: boolean }> {
    if (this.vulkanLoaded) {
      // Do not silently unload a GPU-only model and reload it on CPU for tools.
      // A caller must explicitly select CPU (or an auto-fallback policy) first.
      throw new Error('Tools are not available on the Vulkan GPU engine (llama.kt has no tool calling). Switch the text backend setting to OpenCL, Automatic or CPU to use tools. Atlas does not change your choice by itself.');
    }
    const work = generateWithToolsImpl({
      context: this.context, isGenerating: this.isGenerating,
      isThinkingEnabled: this.isThinkingEnabled(),
      isGemma4Model: this.isGemma4Model(),
      disableCtxShift: this.shouldDisableCtxShift(),
      manageContextWindow: (msgs, extra?) => this.manageContextWindow(msgs, extra),
      convertToOAIMessages: (msgs) => this.convertToOAIMessages(msgs),
      setPerformanceStats: (s) => { this.performanceStats = s; },
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
  /** Bound the active prompt for every local backend. Saved chat history is untouched. */
  private async manageContextWindow(messages: Message[], extraReserve = 0): Promise<Message[]> {
    if (!this.context && !this.vulkanLoaded) return messages;
    const { settings } = useAppStore.getState();
    const managed = await fitMessagesToContext({
      messages,
      contextTokens: this.currentSettings.contextLength || APP_CONFIG.maxContextLength,
      outputTokens: Math.max(settings.maxTokens || 512, extraReserve),
      format: (items) => this.vulkanLoaded
        ? vulkanEngine.formatChat(items.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })))
        : this.formatMessages(items),
      countTokens: (text) => this.getTokenCount(text),
    });
    if (managed.droppedMessages || managed.latestTruncated) {
      logger.log(`[LLM] Active context window: ${managed.promptTokens}/${managed.budgetTokens} prompt tokens; ${managed.droppedMessages} older messages omitted, latestTruncated=${managed.latestTruncated}`);
    }
    return managed.messages;
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
        else logger.warn('[LLM] Dropping unavailable image attachment');
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
    if (this.vulkanLoaded) {
      if (this.isGenerating) throw new Error('Generation already in progress');
      this.isGenerating = true;
      let response = '';
      const task = (async () => {
        const managed = await this.manageContextWindow(messages, maxTokens);
        const prompt = await vulkanEngine.formatChat(managed.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })));
        await vulkanEngine.generate(prompt, Math.max(1, Math.min(maxTokens, 4096)), token => { if (this.isGenerating) response += token; });
        return response.trim();
      })();
      this.activeCompletionPromise = task.then(() => {}, () => {});
      try { return await task; } finally { this.isGenerating = false; this.activeCompletionPromise = null; }
    }
    if (!this.context) throw new Error('No model loaded');
    if (this.isGenerating) throw new Error('Generation already in progress');
    this.isGenerating = true;
    const managed = await this.manageContextWindow(messages, maxTokens);
    const oaiMessages = this.convertToOAIMessages(managed);
    const { settings } = useAppStore.getState();
    let fullResponse = '';
    const ctx = this.context;
    const completionWork = safeCompletion(ctx, () => ctx.completion(
      { messages: oaiMessages, ...buildCompletionParams(settings, { disableCtxShift: this.shouldDisableCtxShift() }), n_predict: maxTokens },
      (data) => { if (this.isGenerating && data.token) fullResponse += data.token; },
    ), 'generateWithMaxTokens');
    this.activeCompletionPromise = completionWork.then(() => { }, () => { });
    try {
      const result = await completionWork;
      // Preserve the native prefill/decode timings for the existing model tester.
      // Wall-clock prompt time includes generation and must not be labeled prefill.
      recordLlamaTimings(result);
      return fullResponse.trim();
    } finally { this.isGenerating = false; this.activeCompletionPromise = null; }
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
    if (this.vulkanLoaded) {
      await vulkanEngine.interrupt();
      if (this.activeCompletionPromise) await this.activeCompletionPromise;
      this.activeCompletionPromise = null;
      this.isGenerating = false;
      return;
    }
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
  getSelectedBackend(): InferenceBackend { return this.selectedBackend; }
  getAcceleratorAttempts(): string[] { return [...this.acceleratorAttempts]; }
  getGpuInfo(): { gpu: boolean; gpuBackend: string; gpuLayers: number; totalLayers?: number; requestedLayers?: number; reasonNoGPU: string } {
    if (this.vulkanLoaded) return { gpu: true, gpuBackend: 'Vulkan', gpuLayers: this.activeGpuLayers, totalLayers: this.totalModelLayers, requestedLayers: this.requestedGpuLayers, reasonNoGPU: this.gpuReason };
    const name = this.gpuEnabled && this.selectedBackend === INFERENCE_BACKENDS.HTP
      ? 'HTP / Hexagon NPU' : resolveGpuBackend(this.gpuEnabled, this.gpuDevices);
    return { gpu: this.gpuEnabled, gpuBackend: name, gpuLayers: this.activeGpuLayers, totalLayers: this.totalModelLayers, requestedLayers: this.requestedGpuLayers, reasonNoGPU: this.vulkanFallbackReason ?? this.gpuReason };
  }
  /** The user-facing notice for a load that silently downgraded to CPU (GPU requested, 0 layers
   *  offloaded — init failure/timeout, capability refusal, or a RAM cap). Null when nothing to report. */
  /** True when this model runs on the CPU on purpose (file type the GPU/NPU can't speed up). */
  isCpuForFileType(): boolean { return this.cpuForFileType; }
  /** True when the loaded model is drafting with its attached MTP file. */
  isMtpActive(): boolean { return this.mtpActive; }
  /** One short deterministic reply from the loaded model, judged for noise (see outputHealth.ts); null when nothing is loaded. */
  getLastOutputCheck(): OutputCheck | null { return this.lastOutputCheck; }
  async runOutputCheck(): Promise<OutputCheck | null> {
    if (!this.context) return null;
    return runOutputCheck(this.context, { isGemma4: this.isGemma4Model() });
  }
  getBackendFallbackNotice(): string | null {
    if (this.acceleratorAttempts.length && (this.context || this.vulkanLoaded)) {
      const verb = this.requestedBackendAtLoad === INFERENCE_BACKENDS.AUTO ? 'Auto selected' : 'Running on';
      return `${verb} ${this.selectedBackend.toUpperCase()} after: ${this.acceleratorAttempts.join(' | ')}`;
    }
    if (this.vulkanFallbackReason) return `Vulkan unavailable: ${this.vulkanFallbackReason}${this.context ? '. Auto chose another accelerator.' : '. GPU-only mode did not fall back to CPU.'}`;
    if (!this.context) return null;
    if (this.cpuForFileType) return null;
    return describeGpuFallback({ requestedGpuLayers: this.requestedGpuLayers, activeGpuLayers: this.activeGpuLayers, gpuAttemptFailed: this.gpuAttemptFailed });
  }
  isCurrentlyGenerating(): boolean { return this.isGenerating; }
  private formatMessages(messages: Message[]): string { return formatLlamaMessages(messages, this.supportsVision(), this.multimodalSupport?.audio ?? false); }
  private convertToOAIMessages(messages: Message[]): RNLlamaOAICompatibleMessage[] { return buildOAIMessages(messages, this.multimodalSupport?.audio ?? false); }
  async getModelInfo() { return (this.vulkanLoaded || this.context) ? { contextLength: this.currentSettings.contextLength, vocabSize: 0 } : null; }
  async tokenize(text: string) {
    if (this.vulkanLoaded) return vulkanEngine.tokenize(text);
    if (!this.context) throw new Error('No model loaded');
    return (await this.context.tokenize(text)).tokens || [];
  }
  async getTokenCount(text: string) {
    if (this.vulkanLoaded) return (await vulkanEngine.tokenize(text)).length;
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
