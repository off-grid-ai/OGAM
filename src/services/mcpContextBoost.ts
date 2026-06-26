/**
 * MCP context boost.
 *
 * MCP tool schemas are large, and a small on-device context can't hold them
 * alongside the conversation — which is why the tool loop otherwise runs a separate
 * "routing" generation to thin the tool set. Instead, when the user enables MCP
 * tools we raise the on-device context window and output budget to the model's
 * maximum (the same ceilings the Model Settings sliders expose) and reload the
 * active model so the schemas fit, then skip routing entirely.
 *
 * Targets reuse the exact ceilings from ModelSettingsScreen/TextGenerationSection so
 * the boost and the slider agree on what "max" means. The reload goes through
 * activeModelService (the residency manager's single load gateway) — never the raw
 * llmService, so the global model-load lock is respected.
 *
 * Policy (product decision): turning MCP ON bumps + reloads; turning MCP OFF leaves
 * the maxed settings in place (no restore).
 */
import { useAppStore } from '../stores/appStore';
import { hardwareService } from './hardware';
import { activeModelService } from './activeModelService';
import { getToolExtensions } from './tools/extensions';
import logger from '../utils/logger';

/** llama Max Tokens slider ceiling (TextGenerationSection llama row). */
const LLAMA_MAX_OUTPUT_TOKENS = 8192;
/** Fallbacks mirror the slider when the model's true max context is unknown. */
const LLAMA_CTX_FALLBACK = 32768;
const LITERT_CTX_FALLBACK_LARGE_RAM = 32768;
const LITERT_CTX_FALLBACK = 12288;
const LARGE_RAM_GB = 8;

/** Serializes boost reloads so rapid tool toggles don't stack model reloads. */
let boostInFlight = false;

/** True when any MCP tool is currently enabled. */
export function isMcpEnabled(): boolean {
  const mcp = getToolExtensions().find(e => e.id === 'mcp');
  return (mcp?.enabledToolCount() ?? 0) > 0;
}

/** The model's max context for the boost — mirrors the Model Settings slider ceilings. */
function targetContextFor(engine: string | undefined, modelMaxContext: number | null): number {
  if (engine === 'litert') {
    const isLargeRam = hardwareService.getTotalMemoryGB() > LARGE_RAM_GB;
    return modelMaxContext ?? (isLargeRam ? LITERT_CTX_FALLBACK_LARGE_RAM : LITERT_CTX_FALLBACK);
  }
  return modelMaxContext ?? LLAMA_CTX_FALLBACK;
}

/**
 * When MCP tools are enabled, raise the active on-device model's context window and
 * output budget to the model maximum and reload so the boost takes effect now. No-op
 * when MCP is off, no on-device model is active, or the settings are already maxed.
 */
export async function applyMcpContextBoost(): Promise<void> {
  if (boostInFlight) return;
  if (!isMcpEnabled()) return;

  const store = useAppStore.getState();
  const { activeModelId, downloadedModels, modelMaxContext, settings } = store;
  if (!activeModelId) return; // remote model or nothing loaded — nothing to reload
  const model = downloadedModels.find(m => m.id === activeModelId);
  if (!model) return;

  const targetCtx = targetContextFor(model.engine, modelMaxContext);

  if (model.engine === 'litert') {
    if ((settings.liteRTMaxTokens ?? 4096) >= targetCtx) return; // already maxed
    store.updateSettings({ liteRTMaxTokens: targetCtx });
  } else {
    const alreadyMaxed =
      (settings.contextLength ?? 4096) >= targetCtx &&
      (settings.maxTokens ?? 1024) >= LLAMA_MAX_OUTPUT_TOKENS;
    if (alreadyMaxed) return;
    store.updateSettings({ contextLength: targetCtx, maxTokens: LLAMA_MAX_OUTPUT_TOKENS });
  }

  boostInFlight = true;
  try {
    logger.log(`[MCP] context boost — reloading ${activeModelId} (${model.engine}) at ctx=${targetCtx}`);
    // Reload through the residency manager's global lock (never bypass via llmService).
    await activeModelService.unloadTextModel();
    await activeModelService.loadTextModel(activeModelId);
  } catch (err: any) {
    logger.error(`[MCP] context boost reload failed: ${err?.message ?? err}`);
  } finally {
    boostInFlight = false;
  }
}
