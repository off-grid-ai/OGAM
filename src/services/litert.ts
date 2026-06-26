/* eslint-disable max-lines -- cohesive native-bridge service; splitting it would scatter tightly-coupled session state. */
/**
 * LiteRTService — JS bridge to the native LiteRTModule (Android).
 *
 * Architecture notes:
 * - The native Conversation object holds turn history internally.
 *   JS sends only the current user message via sendMessage().
 * - Call resetConversation() before each generation (MVP approach).
 *   This is safe and correct for all flows including retry/edit/switch.
 * - onComplete receives fully accumulated content, not an empty string.
 */

import { NativeModules, NativeEventEmitter, EmitterSubscription } from 'react-native';
import logger from '../utils/logger';
import { summarizeSession, runCompaction } from './liteRTCompaction';

const TAG = '[LiteRTService]';

const { LiteRTModule } = NativeModules;

// Events emitted by the native module
const EVENT_TOKEN     = 'litert_token';
const EVENT_THINKING  = 'litert_thinking';
const EVENT_COMPLETE  = 'litert_complete';
const EVENT_ERROR     = 'litert_error';
const EVENT_TOOL_CALL = 'litert_tool_call';

export type LiteRTBackend = 'cpu' | 'gpu' | 'npu';

export interface GenerateRawHandlers {
  onToken?: (token: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<string>;
  onReasoning?: (token: string) => void;
}

export interface LiteRTBenchmarkStats {
  ttft: number;
  decodeTokensPerSecond: number;
  prefillTokensPerSecond: number;
  prefillTokenCount: number;
  decodeTokenCount: number;
  maxNumTokens?: number;
  initTimeSeconds: number;
}

export interface LiteRTMemoryInfo {
  totalRamMb: number;
  usedRamMb: number;
  availRamMb: number;
  gpuPrivateMb: number;
  lowMemory: boolean;
}

export interface LiteRTGenerationCallbacks {
  onToken: (token: string) => void;
  onReasoning: (token: string) => void;
  onComplete: (fullContent: string, fullReasoning: string, stats?: LiteRTBenchmarkStats) => void;
  onError: (error: Error) => void;
}

class LiteRTService {
  private loaded = false;
  private modelSupportsAudio = false;
  private activeBackend: LiteRTBackend | null = null;
  private readonly emitter: NativeEventEmitter | null = null;
  private subscriptions: EmitterSubscription[] = [];

  // Accumulated content for current generation
  private currentContent = '';
  private currentReasoning = '';
  private currentToolCallHandler: ((name: string, args: Record<string, unknown>) => Promise<string>) | null = null;

  // Multi-turn tracking — reset conversation only when context changes
  private activeConversationId: string | null = null;
  private activeSystemPrompt: string | null = null;
  private activeToolsJson: string | null = null;
  private _lastBenchmarkStats: LiteRTBenchmarkStats | undefined = undefined;

  // Context usage tracking — cumulative tokens across turns, reset on conversation reset
  private cumulativeTokens = 0;
  private configuredMaxTokens = 4096;

  constructor() {
    if (LiteRTModule) {
      this.emitter = new NativeEventEmitter(LiteRTModule);
      logger.log(TAG, 'initialized — native module available');
    } else {
      logger.log(TAG, 'native module not available on this platform');
    }
  }

  // ---------------------------------------------------------------------------
  // loadModel
  // ---------------------------------------------------------------------------

  async loadModel(modelPath: string, preferredBackend: LiteRTBackend, opts: { supportsVision?: boolean; supportsAudio?: boolean; maxNumTokens?: number } = {}): Promise<void> {
    if (!this.isAvailable()) throw new Error('LiteRT is not available on this platform');
    const { supportsVision = false, supportsAudio = false, maxNumTokens = 4096 } = opts;
    this.configuredMaxTokens = maxNumTokens;
    logger.log(TAG, `loadModel — path=${modelPath} backend=${preferredBackend} supportsVision=${supportsVision} supportsAudio=${supportsAudio} maxNumTokens=${maxNumTokens}`);

    try {
      const actualBackend: string = await LiteRTModule.loadModel(modelPath, preferredBackend, supportsVision, supportsAudio, maxNumTokens);
      this.activeBackend = actualBackend as LiteRTBackend;
      this.loaded = true;
      this.modelSupportsAudio = supportsAudio;
      logger.log(TAG, `loadModel — loaded on ${this.activeBackend}`);
    } catch (e) {
      this.loaded = false;
      this.activeBackend = null;
      this.modelSupportsAudio = false;
      logger.log(TAG, `loadModel — failed: ${String(e)}`);
      throw e;
    }
  }

  /** Whether the currently loaded model accepts audio input directly. */
  supportsAudio(): boolean {
    return this.loaded && this.modelSupportsAudio;
  }

  // ---------------------------------------------------------------------------
  // resetConversation — cheap: closes + recreates Conversation, Engine stays
  // ---------------------------------------------------------------------------

  async resetConversation(
    systemPrompt: string,
    opts?: {
      samplerConfig?: { temperature?: number; topK?: number; topP?: number };
      tools?: any[];
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
  ): Promise<void> {
    if (!this.isAvailable() || !this.loaded) throw new Error('No LiteRT model loaded');
    const { samplerConfig, tools, history } = opts ?? {};
    const temperature = samplerConfig?.temperature ?? 0.8;
    const topK = samplerConfig?.topK ?? 40;
    const topP = samplerConfig?.topP ?? 0.95;
    const toolsJson = tools && tools.length > 0 ? JSON.stringify(tools) : '';
    const historyJson = history && history.length > 0 ? JSON.stringify(history) : '';
    await LiteRTModule.resetConversation(systemPrompt, temperature, topK, topP, toolsJson, historyJson);
    this.activeSystemPrompt = systemPrompt;
    this.activeToolsJson = toolsJson;
    // Seed the counter with estimated tokens already in the KV cache from history + system prompt.
    // The SDK loads these silently via ConversationConfig.initialMessages so they never appear
    // in lastPrefillTokenCount, causing cumulativeTokens to undercount and auto-compact to fire too late.
    const historyChars = (history ?? []).reduce((sum, m) => sum + m.content.length, 0);
    const systemChars = systemPrompt.length;
    const toolsChars = toolsJson.length;
    this.cumulativeTokens = Math.ceil((historyChars + systemChars + toolsChars) / 4);
  }

  /**
   * Ensure conversation is ready for the given context.
   * Resets only when conversationId or systemPrompt has changed — preserves
   * native turn history for follow-up messages in the same conversation.
   *
   * Auto-compact fires at 65% of context:
   * - Active session: asks the model to summarize what was discussed, then resets
   *   with [summary context + recent turns]. One reset only — summarization runs
   *   in the current KV cache while headroom still exists.
   * - First load (no active session): falls back to slicing the oldest half because
   *   we cannot summarize a session that has not been loaded yet.
   */
  async prepareConversation(
    conversationId: string,
    systemPrompt: string,
    opts?: {
      samplerConfig?: { temperature?: number; topK?: number; topP?: number };
      tools?: any[];
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
  ): Promise<void> {
    const toolsJson = opts?.tools && opts.tools.length > 0 ? JSON.stringify(opts.tools) : '';

    const maxTokens = this.configuredMaxTokens;
    const history = opts?.history;
    const incomingEstimate = history ? Math.ceil((history.reduce((s, m) => s + m.content.length, 0) + systemPrompt.length + toolsJson.length) / 4) : 0;

    const COMPACT_THRESHOLD = 0.65;
    const threshold = maxTokens * COMPACT_THRESHOLD;
    // For an active session cumulativeTokens tracks actual KV cache usage — use it directly.
    // For a new/switched session cumulativeTokens is stale; use incomingEstimate instead.
    const isActiveSession = this.activeConversationId === conversationId;
    const tokenMeasure = isActiveSession ? this.cumulativeTokens : incomingEstimate;
    const needsCompact = maxTokens > 0 && history != null && history.length > 2 &&
      tokenMeasure > threshold;

    if (needsCompact && history) {
      await runCompaction({
        history,
        systemPrompt,
        maxTokens,
        cumulativeTokens: this.cumulativeTokens,
        conversationId,
        activeConversationId: this.activeConversationId,
        opts: { samplerConfig: opts?.samplerConfig, tools: opts?.tools },
        summarize: (fullHistory) => this.summarizeCurrentSession(systemPrompt, fullHistory, opts?.tools),
        resetFn: (p, o) => this.resetConversation(p, o),
      });
      this.activeConversationId = conversationId;
      this.activeSystemPrompt = systemPrompt;
      this.activeToolsJson = toolsJson;
      return;
    }

    const idChanged = this.activeConversationId !== conversationId;
    const sysChanged = this.activeSystemPrompt !== systemPrompt;
    const toolsChanged = this.activeToolsJson !== toolsJson;
    const needsReset = idChanged || sysChanged || toolsChanged;
    if (needsReset) {
      await this.resetConversation(systemPrompt, { samplerConfig: opts?.samplerConfig, tools: opts?.tools, history: opts?.history });
      this.activeConversationId = conversationId;
    }
  }

  private async summarizeCurrentSession(
    systemPrompt: string,
    fullHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools?: any[],
  ): Promise<string | null> {
    // Strip <|think|> prefix so the summary call doesn't burn context on reasoning
    const noThinkPrompt = systemPrompt.replace(/^<\|think\|>\n?/, '');
    await this.resetConversation(noThinkPrompt, { tools, history: fullHistory });
    return summarizeSession(
      (text, cbs) => this.sendMessage(text, cbs),
      this.isAvailable() && this.loaded,
      (h) => { const p = this.currentToolCallHandler; this.currentToolCallHandler = h; return () => { this.currentToolCallHandler = p; }; },
      () => this.stopGeneration(),
    );
  }

  // ---------------------------------------------------------------------------
  // warmup — send a throwaway prompt to prime GPU/NPU shader caches
  // ---------------------------------------------------------------------------

  async warmup(): Promise<void> {
    if (!this.isAvailable() || !this.loaded) return;
    logger.log(TAG, 'warmup — starting');
    try {
      await this.resetConversation('');
      await new Promise<void>((resolve) => {
        this.sendMessage('Hi', {
          onToken: () => {},
          onReasoning: () => {},
          onComplete: () => resolve(),
          onError: () => resolve(),
        });
      });
      // Clear warmup state so first real message gets a fresh conversation
      this.activeConversationId = null;
      this.activeSystemPrompt = null;
      logger.log(TAG, 'warmup — done');
    } catch (e) {
      logger.log(TAG, `warmup — error (ignored): ${String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // sendMessage — sends current turn only, library holds history
  // ---------------------------------------------------------------------------

  async sendMessage(
    text: string,
    callbacks: LiteRTGenerationCallbacks,
    media?: { imageUris?: string[]; audioUris?: string[] },
  ): Promise<void> {
    if (!this.isAvailable() || !this.loaded) { callbacks.onError(new Error('No LiteRT model loaded')); return; }

    // Reset accumulators
    this.currentContent = '';
    this.currentReasoning = '';
    // currentToolCallHandler is set by generateRaw before sendMessage is called

    // Wall-clock tracking
    const sendStart = Date.now();
    let firstTokenTime: number | undefined;
    let jsDecodeTokenCount = 0;

    // Register event listeners for this generation
    this.clearSubscriptions();
    this.subscriptions = [
      this.emitter!.addListener(EVENT_TOKEN, (token: string) => {
        firstTokenTime ??= Date.now();
        jsDecodeTokenCount++;
        this.currentContent += token;
        callbacks.onToken(token);
      }),
      this.emitter!.addListener(EVENT_THINKING, (token: string) => {
        firstTokenTime ??= Date.now();
        this.currentReasoning += token;
        callbacks.onReasoning(token);
      }),
      this.emitter!.addListener(EVENT_COMPLETE, (benchmarkJson: string) => {
        logger.log(TAG, `sendMessage — complete, content=${this.currentContent.length} chars`);
        this.clearSubscriptions();

        this.currentToolCallHandler = null;

        // Parse native benchmark stats for accurate token counts
        let nativePrefillCount = 0;
        let nativeDecodeCount = jsDecodeTokenCount;
        if (benchmarkJson) {
          try {
            const native = JSON.parse(benchmarkJson) as Record<string, number>;
            nativePrefillCount = native.prefillTokenCount ?? 0;
            nativeDecodeCount = native.decodeTokenCount ?? jsDecodeTokenCount;
          } catch { /* use JS fallback counts */ }
        }

        // Accumulate into cumulative context usage.
        // Reasoning/thinking tokens fill the KV cache but are not included in
        // nativeDecodeCount, so estimate them from character length.
        const reasoningTokenEstimate = Math.ceil(this.currentReasoning.length / 4);
        this.cumulativeTokens += nativePrefillCount + nativeDecodeCount + reasoningTokenEstimate;

        // Build wall-clock stats
        const completeTime = Date.now();
        let ttft: number | undefined;
        let decodeElapsed: number | undefined;
        if (firstTokenTime !== undefined) {
          ttft = (firstTokenTime - sendStart) / 1000;
          decodeElapsed = (completeTime - firstTokenTime) / 1000;
        }
        const decodeTokensPerSecond = decodeElapsed && decodeElapsed > 0 && jsDecodeTokenCount > 1
          ? jsDecodeTokenCount / decodeElapsed
          : undefined;

        const wallClockStats: LiteRTBenchmarkStats = {
          ttft: ttft ?? 0,
          decodeTokensPerSecond: decodeTokensPerSecond ?? 0,
          prefillTokensPerSecond: 0,
          prefillTokenCount: nativePrefillCount || jsDecodeTokenCount,
          decodeTokenCount: nativeDecodeCount,
          maxNumTokens: this.configuredMaxTokens,
          initTimeSeconds: 0,
        };

        callbacks.onComplete(this.currentContent, this.currentReasoning, wallClockStats);
      }),
      this.emitter!.addListener(EVENT_ERROR, (message: string) => {
        logger.log(TAG, `sendMessage — error: ${message}`);
        this.clearSubscriptions();

        this.currentToolCallHandler = null;
        callbacks.onError(new Error(message));
      }),
      this.emitter!.addListener(EVENT_TOOL_CALL, async (json: string) => {
        logger.log(TAG, `sendMessage — tool call received: ${json.substring(0, 200)}`);
        try {
          const { id, name, arguments: args } = JSON.parse(json) as {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          };
          const handler = this.currentToolCallHandler;
          const result = handler ? await handler(name, args) : 'Tool unavailable during this operation. Please respond directly without using tools.';
          logger.log(TAG, `sendMessage — responding to tool call id=${id} name=${name} resultLen=${result.length}`);
          await LiteRTModule.respondToToolCall(id, result);
        } catch (e) {
          logger.log(TAG, `sendMessage — tool call handling error: ${String(e)}`);
        }
      }),
    ];

    try {
      const normalizedImageUris = media?.imageUris?.filter(Boolean) ?? [];
      const normalizedAudioUris = media?.audioUris?.filter(Boolean) ?? [];
      if (normalizedAudioUris.length > 0 && normalizedImageUris.length > 0) {
        // Both modalities in one turn — a single audio branch would otherwise drop
        // the images (native buildSendContents emits image + audio + text together).
        await LiteRTModule.sendMessageWithMedia(text, normalizedImageUris, normalizedAudioUris);
      } else if (normalizedAudioUris.length > 0) {
        await LiteRTModule.sendMessageWithAudio(text, normalizedAudioUris);
      } else if (normalizedImageUris.length > 0) {
        await LiteRTModule.sendMessageWithImages(text, normalizedImageUris);
      } else {
        await LiteRTModule.sendMessage(text, null);
      }
    } catch (e) {
      this.clearSubscriptions();
      const err = e instanceof Error ? e : new Error(String(e));
      logger.log(TAG, `sendMessage — native error: ${err.message}`);
      callbacks.onError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // generateRaw — used by the tool loop only.
  // Wraps sendMessage into a Promise<string>. No chat store interaction.
  // ---------------------------------------------------------------------------

  async generateRaw(
    text: string,
    media?: { imageUris?: string[]; audioUris?: string[] },
    handlers?: GenerateRawHandlers,
  ): Promise<string> {
    const { imageUris, audioUris } = media ?? {};
    const { onToken, onToolCall, onReasoning } = handlers ?? {};
    logger.log(TAG, `generateRaw — text=${text.length}ch, hasToolHandler=${!!onToolCall}, imageCount=${imageUris?.length ?? 0}, audioCount=${audioUris?.length ?? 0}, first100="${text.substring(0, 100)}"`);
    this.currentToolCallHandler = onToolCall ?? null;
    return new Promise((resolve, reject) => {
      this.sendMessage(text, {
        onToken: t => onToken?.(t),
        onReasoning: t => onReasoning?.(t),
        onComplete: (fullContent, _reasoning, stats) => {
          logger.log(TAG, `generateRaw — complete, response=${fullContent.length}ch, first200="${fullContent.substring(0, 200)}"`);
          this._lastBenchmarkStats = stats;
          resolve(fullContent);
        },
        onError: (err) => {
          logger.log(TAG, `generateRaw — error: ${err.message}`);
          this.currentToolCallHandler = null;
          reject(err);
        },
      }, { imageUris, audioUris }).catch(reject);
    });
  }

  // ---------------------------------------------------------------------------
  // generateToolSelection — one-shot, tools-free routing pass for the LiteRT
  // two-pass tool selector. Runs on a throwaway native session so it never
  // pollutes a real chat's history/KV, then drops that session so pass 2 rebuilds
  // the real conversation. Deterministic (temperature 0).
  // ---------------------------------------------------------------------------

  async generateToolSelection(systemPrompt: string, userText: string): Promise<string> {
    await this.prepareConversation('__tool_select__', systemPrompt, {
      samplerConfig: { temperature: 0, topK: 1, topP: 1 },
      tools: [],
      history: [],
    });
    try {
      // No onToolCall handler -> pure text, the model cannot call tools here.
      return await this.generateRaw(userText, undefined, {});
    } finally {
      this.invalidateConversation();
    }
  }

  // ---------------------------------------------------------------------------
  // stopGeneration
  // ---------------------------------------------------------------------------

  async stopGeneration(): Promise<void> {
    if (!this.isAvailable()) return;
    logger.log(TAG, 'stopGeneration');
    this.clearSubscriptions();
    // Don't null activeConversationId — the native conversation is still loaded and
    // its KV cache still reflects cumulativeTokens. Clearing the id would force the
    // next prepareConversation to classify the same conversation as "new", falling
    // back to incomingEstimate (which sums all JS history) and triggering an unnecessary
    // compaction. Caller can invalidate explicitly via invalidateConversation() if
    // the message rewind requires a fresh native conversation.
    try { await LiteRTModule.stopGeneration(); }
    catch (e) { logger.log(TAG, `stopGeneration — error (ignored): ${String(e)}`); }
  }

  // ---------------------------------------------------------------------------
  // unloadModel — expensive: closes Conversation + Engine
  // ---------------------------------------------------------------------------

  async unloadModel(): Promise<void> {
    if (!this.isAvailable()) return;
    logger.log(TAG, 'unloadModel');
    this.clearSubscriptions();
    this.currentToolCallHandler = null;
    this.activeConversationId = null;
    this.activeSystemPrompt = null;
    this.activeToolsJson = null;
    this.cumulativeTokens = 0;
    this.configuredMaxTokens = 4096;
    try {
      await LiteRTModule.unloadModel();
    } catch (e) {
      logger.log(TAG, `unloadModel — error (ignored): ${String(e)}`);
    } finally {
      this.loaded = false;
      this.modelSupportsAudio = false;
      this.activeBackend = null;
    }
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  isModelLoaded(): boolean {
    return this.loaded;
  }

  isNPU(): boolean {
    return this.activeBackend === 'npu';
  }

  getActiveBackend(): LiteRTBackend | null {
    return this.activeBackend;
  }

  getLastBenchmarkStats(): LiteRTBenchmarkStats | undefined {
    return this._lastBenchmarkStats;
  }

  getContextUsage(): { used: number; max: number } {
    return { used: this.cumulativeTokens, max: this.configuredMaxTokens };
  }

  isAvailable(): boolean {
    return !!LiteRTModule;
  }

  /**
   * Force the next prepareConversation call to reset native history.
   * Call before regeneration or edit — the JS message array is being rewound,
   * so the native conversation must start fresh from that point.
   */
  invalidateConversation(): void {
    this.activeConversationId = null;
  }

  async getMemoryInfo(): Promise<LiteRTMemoryInfo | null> {
    if (!this.isAvailable()) return null;
    try { return await LiteRTModule.getMemoryInfo(); }
    catch (e) { logger.log(TAG, `getMemoryInfo — error: ${String(e)}`); return null; }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private clearSubscriptions(): void {
    this.subscriptions.forEach(s => s.remove());
    this.subscriptions = [];
  }
}

export const liteRTService = new LiteRTService();
