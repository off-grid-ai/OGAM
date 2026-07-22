import { useAppStore, useRemoteServerStore } from '../stores';
import { llmService } from './llm';
import { liteRTService } from './litert';
import { providerRegistry } from './providers';
import { isLiteRTModel, type DownloadedModel, type Message } from '../types';
import {
  predictGgufCapabilities,
  type PredictedGgufCapabilities,
} from '../utils/ggufCapabilities';
import logger from '../utils/logger';

/** Every text-generation engine, defined ONCE here so callers never hardcode the concrete set. */
const TEXT_ENGINES = [liteRTService, llmService];

/** What the active text model can do, resolved once so callers never branch on the concrete engine. */
export interface EngineCapabilities {
  vision: boolean;
  audio: boolean;
  tools: boolean;
  thinking: boolean;
}

/** Runtime inputs for deriveEngineCapabilities — passed explicitly so the rule is pure/testable. */
/** A remote model's declared capabilities (single named type so callers don't index CapabilityInputs). */
export type RemoteCaps = {
  supportsVision?: boolean;
  supportsToolCalling?: boolean;
  supportsThinking?: boolean;
} | null;

export interface CapabilityInputs {
  /** A remote (gateway) model is active — its declared capabilities win. */
  isRemote: boolean;
  remoteCaps?: RemoteCaps;
  /** The active LOCAL model's engine ('litert' | 'llama' | ...) and LiteRT capability flags. */
  engine?: string;
  liteRTVision?: boolean;
  liteRTAudio?: boolean;
  /** Whether the LiteRT engine currently has a model resident (its tools/thinking need it loaded). */
  liteRTLoaded: boolean;
  /** The llama engine's live capabilities (only meaningful when loaded). */
  llama: {
    loaded: boolean;
    vision: boolean;
    audio: boolean;
    tools: boolean;
    thinking: boolean;
  };
  /** Static PREDICTION for a llama model that is selected but not loaded (models load lazily on
   *  first send). Without it the Tools/Thinking affordances were hidden for a just-selected
   *  Gemma 4 until the first send loaded it (device 2026-07-13). Loaded live caps win. */
  llamaPredicted?: PredictedGgufCapabilities;
}

/**
 * THE single source for "what can the active text model do" — the exact rule previously
 * re-derived in useChatModelStateSync / useChatModelActions / useChatGenerationActions et al.
 * Precedence: remote (declared caps) → LiteRT (vision/audio from the model FLAG, no load needed;
 * tools/thinking only once the engine is loaded) → llama (all from the loaded engine) → none.
 * Pure and zero-IO so callers keep their own reactive inputs; adding an engine is a branch here (OCP).
 */
export function deriveEngineCapabilities(
  i: CapabilityInputs,
): EngineCapabilities {
  if (i.isRemote) {
    return {
      vision: i.remoteCaps?.supportsVision ?? false,
      tools: i.remoteCaps?.supportsToolCalling ?? false,
      thinking: i.remoteCaps?.supportsThinking ?? false,
      audio: false, // remote audio capability is not tracked today
    };
  }
  if (i.engine === 'litert') {
    return {
      vision: !!i.liteRTVision, // from the model flag — shown before load (matches state-sync)
      audio: !!i.liteRTAudio,
      tools: i.liteRTLoaded, // native tool calling, but only once the engine is resident
      thinking: i.liteRTLoaded,
    };
  }
  // llama (and any future engine): the LOADED engine's template-derived capabilities are
  // authoritative; before the lazy load, fall back to the static name/mmproj PREDICTION so a
  // just-selected model shows its real affordances (unknown names predict false — no change).
  return {
    vision: i.llama.loaded ? i.llama.vision : i.llamaPredicted?.vision ?? false,
    audio: i.llama.loaded ? i.llama.audio : false,
    tools: i.llama.loaded ? i.llama.tools : i.llamaPredicted?.tools ?? false,
    thinking: i.llama.loaded
      ? i.llama.thinking
      : i.llamaPredicted?.thinking ?? false,
  };
}

/**
 * Unload every text engine (an idle engine is a safe no-op). Used on a model switch so a
 * cross-engine swap (LiteRT <-> llama) can't leave the previous model resident, without the
 * caller branching on which concrete engine held it. Adding an engine is one entry above (OCP).
 */
export async function unloadAllTextEngines(): Promise<void> {
  for (const engine of TEXT_ENGINES) {
    try {
      await engine.unloadModel();
    } catch (e) {
      logger.warn(
        '[engines] text engine unload during switch failed, continuing:',
        e,
      );
    }
  }
}

/**
 * Stop generation on every text engine. The engine SET is owned here (TEXT_ENGINES), so callers never
 * enumerate llmService/liteRTService themselves — adding an engine changes only this file (OCP). Used by the
 * defensive stop path; llama's stopCompletion and litert's stopGeneration differ at the native layer but are
 * uniform through this one call.
 */
export async function stopAllTextEngines(): Promise<void> {
  for (const engine of TEXT_ENGINES) {
    try {
      await engine.stopGeneration();
    } catch {
      /* best-effort: a stale/idle engine may reject; keep going */
    }
  }
}

/**
 * Invalidate the active engine's cached conversation state before a history rewind (regenerate/
 * edit). LiteRT keeps a native per-conversation KV cache that must be reset; llama has none.
 * Dispatched via the registry so callers don't branch on engine === 'litert'.
 */
export function invalidateActiveConversation(): void {
  const engine = getActiveEngineService();
  (
    engine as { invalidateConversation?: () => void } | null
  )?.invalidateConversation?.();
}

/**
 * Is this LOCAL text model actually resident on its engine? The per-engine readiness predicate
 * in ONE place: LiteRT tracks only "a model is loaded"; llama must have the SELECTED model's path
 * loaded (a different llama model resident is NOT ready). Callers pass their own model and use
 * this instead of branching on engine === 'litert' for readiness.
 */
export function isModelReady(
  model: { engine?: string; filePath?: string } | null | undefined,
): boolean {
  if (!model) return false;
  return model.engine === 'litert'
    ? liteRTService.isModelLoaded()
    : llmService.isModelLoaded() &&
        llmService.getLoadedModelPath() === model.filePath;
}

/**
 * Whether a LOCAL model can accept an image RIGHT NOW — record-based, so it's valid BEFORE the model
 * loads (used to gate image sends). llama needs a present projector (mmProjPath); LiteRT carries vision in
 * the bundle (the liteRTVision flag). A missing/absent projector means the native completion would throw
 * "Multimodal support not enabled" — so the send must be blocked here, not sent and crashed (device 2026-07-14).
 */
export function localModelAcceptsImages(
  model: DownloadedModel | null | undefined,
): boolean {
  if (!model) return false;
  return isLiteRTModel(model) ? !!model.liteRTVision : !!model.mmProjPath;
}

/** Consume a local backend downgrade once per native load. Concurrent load
 * waiters cannot produce duplicate conversation notices. */
export function consumeBackendFallbackNotice(
  model: { engine?: string } | null | undefined,
): string | null {
  if (!model || model.engine === 'litert') return null;
  return llmService.consumeBackendFallbackNotice();
}

/**
 * Live capabilities of the ACTIVE text model (remote OR local), read from the running services
 * and fed through the one pure rule (deriveEngineCapabilities). The imperative counterpart to the
 * pure fn: every caller (generation routing, UI capability flags) uses THIS instead of poking
 * llmService / liteRTService directly or branching on engine === 'litert' — so a concrete engine
 * service never has to be imported into a screen (DIP). Adding a backend = extend
 * deriveEngineCapabilities, not the callers (OCP).
 * `thinking` here is CAPABILITY (does the model support it — drives the UI toggle), not "enabled
 * this turn"; the per-turn enablement lives in wantsLeadingThinkToken.
 */
export function activeTextCapabilities(i: {
  isRemote: boolean;
  remoteCaps?: RemoteCaps;
  model: DownloadedModel | null | undefined;
}): EngineCapabilities {
  const litert = i.model && isLiteRTModel(i.model) ? i.model : null;
  return deriveEngineCapabilities({
    isRemote: i.isRemote,
    remoteCaps: i.remoteCaps,
    engine: i.model?.engine,
    liteRTVision: litert ? litert.liteRTVision : undefined,
    liteRTAudio: litert ? litert.liteRTAudio : undefined,
    liteRTLoaded: liteRTService.isModelLoaded(),
    llama: {
      loaded: llmService.isModelLoaded(),
      vision: llmService.getMultimodalSupport()?.vision ?? false,
      audio: false,
      tools: llmService.supportsToolCalling(),
      thinking: llmService.supportsThinking(),
    },
    llamaPredicted:
      i.model?.engine === 'llama'
        ? predictGgufCapabilities(i.model)
        : undefined,
  });
}

/** Local-only convenience for the generation routing path (no remote); reads .tools/.vision. */
export function activeLocalTextCapabilities(
  model: DownloadedModel | null | undefined,
): EngineCapabilities {
  return activeTextCapabilities({ isRemote: false, model });
}

/** Is the native LiteRT runtime available on this device? Exposed here so UI (e.g. import-file
 *  validation) asks the engine registry instead of importing the concrete liteRTService (DIP). */
export function isLiteRTAvailable(): boolean {
  return liteRTService.isAvailable();
}

/**
 * Should a leading Gemma-4 `<|think|>` token be prepended to activate thinking for THIS turn?
 * The engine-specific detection lives here (the seam), not in the caller: LiteRT relies on the
 * turn's thinkingEnabled flag; llama introspects the loaded model (isGemma4Model + thinking on).
 * Remote never gets it. Callers pass their model + flags and never name a concrete engine.
 */
export function wantsLeadingThinkToken(
  model: DownloadedModel | null | undefined,
  opts: { isRemote: boolean },
): boolean {
  if (opts.isRemote) return false;
  // Read the thinking setting FRESH from the store here — NOT from a value threaded in by the caller.
  // The caller's copy comes from a React render snapshot (genDeps.settings) that lags by one render on a
  // resend, which made the `<|think|>` activation follow the PREVIOUS toggle state → thinking was off-by-one
  // (device 2026-07-14). Both engines now decide from the live value, so a toggle applies to the next turn.
  const thinkingEnabled = useAppStore.getState().settings.thinkingEnabled;
  return !!model && isLiteRTModel(model) && liteRTService.isModelLoaded()
    ? thinkingEnabled
    : llmService.isGemma4Model() && llmService.isThinkingEnabled();
}

/**
 * Returns the service for the currently active text engine, or null if no
 * model is loaded. Use this for operations that both engines support
 * (stopGeneration, isModelLoaded, unloadModel). For engine-specific
 * operations keep the explicit branch — it should be visible at the call site.
 */
export function getActiveEngineService():
  | typeof llmService
  | typeof liteRTService
  | null {
  const { downloadedModels, activeModelId } = useAppStore.getState();
  const model = downloadedModels.find(m => m.id === activeModelId);
  if (!model) return null;
  return model.engine === 'litert' ? liteRTService : llmService;
}

/**
 * Is a REMOTE (gateway / OpenAI-compatible) text model the ACTIVE text engine right now?
 *
 * THE single source of truth for "route text to a remote provider" — the exact rule
 * generationService.isUsingRemoteProvider re-derived and generateStandalone used to inline.
 * A remote model is active iff: a server is selected, its provider is actually REGISTERED (not
 * just persisted from a prior session), and NO local model is loaded (a loaded local model always
 * wins). Callers depend on this predicate instead of re-checking the store + registry + llmService
 * themselves, so "is remote active" lives in ONE place (DIP/DRY). Adding a backend never touches a
 * caller's readiness check.
 */
export function isRemoteTextModelActive(): boolean {
  const { activeServerId } = useRemoteServerStore.getState();
  if (!activeServerId) return false;
  if (!providerRegistry.hasProvider(activeServerId)) return false;
  if (llmService.isModelLoaded()) return false; // a loaded local model wins over a remote server
  return true;
}

/**
 * One-shot standalone text completion on the ACTIVE text engine — engine-agnostic.
 *
 * For NON-chat callers (image-prompt enhancement) that need a prompt→text completion
 * WITHOUT the chat streaming/turn/store machinery. The two engines have genuinely
 * different one-shot entry shapes — llama takes Message[] via generateResponse; LiteRT
 * runs on a throwaway native session (prepareConversation + generateRaw) so it never
 * pollutes a real chat's KV/history — so this is the SINGLE place that difference lives.
 * Callers depend on this seam, never on a concrete engine (the enhancement path used to
 * hardcode llmService, so a LiteRT text model reported "not loaded" and enhancement was
 * skipped even though the model was resident).
 */
export async function generateStandalone(
  messages: Message[],
  onToken?: (token: string) => void,
): Promise<string> {
  // Remote/gateway text model active with no local engine loaded: enhancement used to
  // fall through to the (unloaded) local llama and throw, so it was silently skipped
  // (Q8). Route the one-shot through the active provider, streaming content so the UI
  // can show live progress (B30b). Thinking OFF — enhancement is a utility rewrite.
  const { activeServerId, activeRemoteTextModelId } =
    useRemoteServerStore.getState();
  // A loaded LiteRT model still wins over a selected remote server (isRemoteTextModelActive only
  // rules out a loaded LLAMA model), so keep the litert guard here.
  const useRemote =
    isRemoteTextModelActive() && getActiveEngineService() !== liteRTService;
  if (useRemote) {
    const provider = providerRegistry.getProvider(activeServerId!)!;
    if (
      activeRemoteTextModelId &&
      provider.getLoadedModelId() !== activeRemoteTextModelId
    ) {
      await provider.loadModel(activeRemoteTextModelId);
    }
    let content = '';
    await provider.generate(
      messages,
      { enableThinking: false },
      {
        onToken: (t: string) => {
          content += t;
          onToken?.(t);
        },
        onComplete: result => {
          if (result?.content) content = result.content;
        },
        onError: err => {
          throw err instanceof Error ? err : new Error(String(err));
        },
      },
    );
    return content;
  }
  if (getActiveEngineService() === liteRTService) {
    const system = messages.find(m => m.role === 'system');
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const systemPrompt =
      typeof system?.content === 'string' ? system.content : '';
    const userText =
      typeof lastUser?.content === 'string' ? lastUser.content : '';
    const { settings } = useAppStore.getState();
    await liteRTService.prepareConversation('__standalone__', systemPrompt, {
      samplerConfig: {
        temperature: settings.liteRTTemperature,
        topP: settings.liteRTTopP,
      },
      history: [],
    });
    try {
      return await liteRTService.generateRaw(userText, undefined, {
        onToken: (t: string) => onToken?.(t),
      });
    } finally {
      liteRTService.invalidateConversation();
    }
  }
  // llama (default engine). Stream tokens for live progress; force thinking OFF so the
  // enhanced prompt is a clean rewrite, never a leaked reasoning chain (B30/B30b).
  return llmService.generateResponse(messages, {
    onStream: onToken
      ? data => {
          if (typeof (data as { content?: string })?.content === 'string')
            onToken((data as { content: string }).content);
        }
      : () => {},
    disableThinking: true,
  });
}
