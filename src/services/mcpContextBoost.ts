/**
 * MCP enablement check.
 *
 * This module previously also auto-raised the on-device context window to the model
 * maximum (32768) and reloaded the active model whenever MCP tools were enabled, so
 * the large tool schemas would fit. That auto-boost was the primary stability/perf
 * regression on flagship (>8GB) devices — 8x KV cache caused iOS Metal buffer-alloc
 * crashes and Android litert OOM, tanked tok/s, and never restored. It was removed.
 * MCP tools are now thinned to fit the normal context window by the embedding
 * tool-router (see `toolEmbeddingRouter` / `selectEffectiveSchemas` in
 * `generationToolLoop`). Only the enablement check remains here.
 */
import { getToolExtensions } from './tools/extensions';

/** True when any MCP tool is currently enabled. */
export function isMcpEnabled(): boolean {
  const mcp = getToolExtensions().find(e => e.id === 'mcp');
  return (mcp?.enabledToolCount() ?? 0) > 0;
}
