import { useAppStore } from '../stores';
import { llmService } from './llm';
import { liteRTService } from './litert';
import { isLiteRTModel, type DownloadedModel } from '../types';
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
export interface CapabilityInputs {
  /** A remote (gateway) model is active — its declared capabilities win. */
  isRemote: boolean;
  remoteCaps?: { supportsVision?: boolean; supportsToolCalling?: boolean; supportsThinking?: boolean } | null;
  /** The active LOCAL model's engine ('litert' | 'llama' | ...) and LiteRT capability flags. */
  engine?: string;
  liteRTVision?: boolean;
  liteRTAudio?: boolean;
  /** Whether the LiteRT engine currently has a model resident (its tools/thinking need it loaded). */
  liteRTLoaded: boolean;
  /** The llama engine's live capabilities (only meaningful when loaded). */
  llama: { loaded: boolean; vision: boolean; audio: boolean; tools: boolean; thinking: boolean };
}

/**
 * THE single source for "what can the active text model do" — the exact rule previously
 * re-derived in useChatModelStateSync / useChatModelActions / useChatGenerationActions et al.
 * Precedence: remote (declared caps) → LiteRT (vision/audio from the model FLAG, no load needed;
 * tools/thinking only once the engine is loaded) → llama (all from the loaded engine) → none.
 * Pure and zero-IO so callers keep their own reactive inputs; adding an engine is a branch here (OCP).
 */
export function deriveEngineCapabilities(i: CapabilityInputs): EngineCapabilities {
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
  // llama (and any future engine): capabilities come from the loaded engine, false when not loaded.
  return {
    vision: i.llama.loaded ? i.llama.vision : false,
    audio: i.llama.loaded ? i.llama.audio : false,
    tools: i.llama.loaded ? i.llama.tools : false,
    thinking: i.llama.loaded ? i.llama.thinking : false,
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
      logger.warn('[engines] text engine unload during switch failed, continuing:', e);
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
  (engine as { invalidateConversation?: () => void } | null)?.invalidateConversation?.();
}

/**
 * Is this LOCAL text model actually resident on its engine? The per-engine readiness predicate
 * in ONE place: LiteRT tracks only "a model is loaded"; llama must have the SELECTED model's path
 * loaded (a different llama model resident is NOT ready). Callers pass their own model and use
 * this instead of branching on engine === 'litert' for readiness.
 */
export function isModelReady(model: { engine?: string; filePath?: string } | null | undefined): boolean {
  if (!model) return false;
  return model.engine === 'litert'
    ? liteRTService.isModelLoaded()
    : llmService.isModelLoaded() && llmService.getLoadedModelPath() === model.filePath;
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
  remoteCaps?: CapabilityInputs['remoteCaps'];
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
  });
}

/** Local-only convenience for the generation routing path (no remote); reads .tools/.vision. */
export function activeLocalTextCapabilities(model: DownloadedModel | null | undefined): EngineCapabilities {
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
  opts: { isRemote: boolean; thinkingEnabled: boolean },
): boolean {
  if (opts.isRemote) return false;
  return !!model && isLiteRTModel(model) && liteRTService.isModelLoaded()
    ? opts.thinkingEnabled
    : llmService.isGemma4Model() && llmService.isThinkingEnabled();
}

/**
 * Returns the service for the currently active text engine, or null if no
 * model is loaded. Use this for operations that both engines support
 * (stopGeneration, isModelLoaded, unloadModel). For engine-specific
 * operations keep the explicit branch — it should be visible at the call site.
 */
export function getActiveEngineService(): typeof llmService | typeof liteRTService | null {
  const { downloadedModels, activeModelId } = useAppStore.getState();
  const model = downloadedModels.find(m => m.id === activeModelId);
  if (!model) return null;
  return model.engine === 'litert' ? liteRTService : llmService;
}
