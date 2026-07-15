
/**
 * Remote Model Capabilities
 *
 * Helpers for fetching model metadata (context length, vision support)
 * from Ollama and LM Studio servers.
 */

import logger from '../utils/logger';
import { templateEmitsReasoning, REASONING_DELIMITERS } from '../utils/messageContent';

export interface RemoteModelInfo {
  contextLength: number;
  supportsVision: boolean;
  supportsToolCalling?: boolean;
  supportsThinking?: boolean;
  /** Server honors chat_template_kwargs.enable_thinking to toggle reasoning per request. */
  acceptsThinkingKwarg?: boolean;
}

function parseModelInfoKeys(modelInfo: Record<string, unknown>): { contextLength: number; supportsVision: boolean } {
  let contextLength = 0;
  let supportsVision = false;
  for (const key of Object.keys(modelInfo)) {
    if (key.endsWith('.context_length')) {
      const val = modelInfo[key];
      if (typeof val === 'number' && val > 0) contextLength = val;
    }
    if (key.includes('vision') || key.includes('clip')) {
      supportsVision = true;
    }
  }
  return { contextLength, supportsVision };
}

function parseNumCtx(parameters: string): number {
  const match = /num_ctx\s+(\d+)/.exec(parameters);
  if (match) {
    const val = Number.parseInt(match[1], 10);
    if (val > 0) return val;
  }
  return 0;
}

function extractOllamaCapabilities(data: Record<string, unknown>): RemoteModelInfo {
  let contextLength = 4096;
  let supportsVision = false;

  // Newer Ollama versions expose a top-level `capabilities` array (e.g. ["vision", "tools"]).
  // Gemma 4 and similar models use this field instead of model_info keys.
  let supportsToolCalling: boolean | undefined;
  if (Array.isArray(data.capabilities)) {
    const caps = data.capabilities as unknown[];
    supportsVision = caps.includes('vision');
    supportsToolCalling = caps.includes('tools');
  }

  if (data.model_info && typeof data.model_info === 'object') {
    const parsed = parseModelInfoKeys(data.model_info as Record<string, unknown>);
    if (parsed.contextLength > 0) contextLength = parsed.contextLength;
    if (!supportsVision) supportsVision = parsed.supportsVision;
  }

  // projector_info is present for multimodal models when capabilities array is missing.
  if (!supportsVision && data.projector_info && typeof data.projector_info === 'object') {
    const projectorKeys = Object.keys(data.projector_info as Record<string, unknown>);
    supportsVision = projectorKeys.some(k => k.includes('vision') || k.includes('clip'));
  }

  if (contextLength === 4096 && typeof data.parameters === 'string') {
    const numCtx = parseNumCtx(data.parameters);
    if (numCtx > 0) contextLength = numCtx;
  }

  // Thinking support detection:
  // - Older models: template contains .Think / .Thinking / .IsThinkSet
  // - Newer models (qwen3.5+): use RENDERER/PARSER in modelfile instead of template logic
  const template = typeof data.template === 'string' ? data.template : '';
  const modelfile = typeof data.modelfile === 'string' ? data.modelfile : '';
  const supportsThinking =
    /\.Think|\.Thinking|\.IsThinkSet/.test(template) ||
    /^RENDERER\s/m.test(modelfile);

  return { contextLength, supportsVision, supportsToolCalling, supportsThinking };
}

/**
 * Fetches model capabilities for an Ollama model via POST /api/show.
 * Vision is detected by inspecting model_info keys for "vision" or "clip" —
 * Ollama populates these for multimodal models (e.g. clip.vision.block_count).
 * Falls back to contextLength=4096, supportsVision=false on any failure.
 */
export async function fetchRemoteModelInfo(
  endpoint: string,
  modelName: string,
): Promise<RemoteModelInfo> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return { contextLength: 4096, supportsVision: false };

    const data = await response.json();
    return extractOllamaCapabilities(data);
  } catch {
    // Timeout, network error, parse error
  }

  return { contextLength: 4096, supportsVision: false };
}

/**
 * Fetches model capabilities for an LM Studio server via GET /api/v1/models.
 * LM Studio's native endpoint exposes vision and tool-use capability per model.
 * Falls back to contextLength=4096, supportsVision=false on any failure.
 */
export async function fetchLmStudioModelInfo(
  endpoint: string,
  modelId: string,
): Promise<RemoteModelInfo> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${endpoint}/api/v1/models`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return { contextLength: 4096, supportsVision: false };

    const data = await response.json();
    // LM Studio /api/v1/models returns { models: [...] } with each entry keyed by "key" field
    const models: unknown[] = Array.isArray(data?.models) ? data.models : [];

    const model = models.find(
      (m): m is Record<string, unknown> =>
        typeof m === 'object' && m !== null && (m as Record<string, unknown>).key === modelId,
    );

    if (!model) return { contextLength: 4096, supportsVision: false };

    // LM Studio capabilities: { vision: bool, trained_for_tool_use: bool }
    // Note: type is always "llm" even for VL models — use capabilities.vision instead
    const caps = typeof model.capabilities === 'object' && model.capabilities !== null
      ? model.capabilities as Record<string, unknown>
      : {};

    const contextLength =
      typeof model.max_context_length === 'number' && model.max_context_length > 0
        ? model.max_context_length
        : 4096;

    // LM Studio doesn't expose thinking capability in /api/v1/models.
    // Probe via a 1-token streaming request to learn whether THIS model thinks.
    const supportsThinking = await probeLmStudioThinking(endpoint, modelId);

    return {
      contextLength,
      supportsVision: caps.vision === true,
      supportsToolCalling: caps.trained_for_tool_use === true,
      supportsThinking,
      // Reaching here means the server answered /api/v1/models with this model —
      // it IS LM Studio, which always honors chat_template_kwargs.enable_thinking.
      // That's a property of the server (transport), independent of whether this
      // particular model reasons — so it must not hinge on the probe. Tying it to
      // the probe would strip the kwarg from a thinking model whenever the probe
      // merely flaked (timeout/network) during discovery.
      acceptsThinkingKwarg: true,
    };
  } catch {
    // Timeout, network error, parse error
  }

  return { contextLength: 4096, supportsVision: false };
}

/**
 * Probe an LM Studio model for thinking support by sending a short streaming
 * request and checking if any SSE delta contains thinking content.
 *
 * LM Studio only honours `chat_template_kwargs` in streaming mode.
 * React Native's fetch doesn't support ReadableStream, so the full SSE
 * response is collected with `response.text()` instead.
 *
 * LM Studio may return thinking in different ways:
 * - Inline `<think>` tags in message.content
 * - Separate message.reasoning_content field
 */
function deltaHasThinking(delta: Record<string, unknown>): boolean {
  // Inline reasoning emitted in `content` (no reasoning_content field) is detected through the
  // SHARED reasoning grammar (REASONING_DELIMITERS) — not a hardcoded `<think>` — so this agrees
  // with the rest of the reasoning parsers and catches Gemma/Qwen channel reasoning too.
  if (
    typeof delta.content === 'string' &&
    REASONING_DELIMITERS.some((d) => (delta.content as string).includes(d.open))
  ) {
    return true;
  }
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) return true;
  if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) return true;
  if (typeof delta.thinking === 'string' && delta.thinking.length > 0) return true;
  return false;
}

async function probeLmStudioThinking(endpoint: string, modelId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    // Use streaming — LM Studio only honours chat_template_kwargs in streaming mode.
    // Read the full SSE response as text (RN fetch supports .text() but not ReadableStream).
    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Say hi' }],
        max_tokens: 2,
        stream: true,
        chat_template_kwargs: { enable_thinking: true },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!response.ok) return false;

    // response.text() collects the full SSE stream as a string
    const text = await response.text();

    // Check all SSE data lines for thinking indicators
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const chunk = JSON.parse(line.slice(6));
        const delta = chunk?.choices?.[0]?.delta;
        if (delta && deltaHasThinking(delta)) return true;
      } catch { /* skip malformed lines */ }
    }

    return false;
  } catch (error) {
    // Timeout, network error, model not loaded
    logger.warn('[probeLmStudioThinking] Failed to probe for thinking support:', error);
  }
  return false;
}

/**
 * Fetches model capabilities from a llama.cpp server via GET /props.
 *
 * The Off Grid AI Gateway is a llama.cpp server: its /v1/models list carries no
 * capability data, but /props reports the loaded model's real capabilities —
 * authoritative because they come from the actually-loaded projector/template,
 * not a name guess. A llama.cpp server serves ONE model, so /props maps to it.
 *
 *   modalities:        { vision, video, audio }        → vision / audio input
 *   chat_template_caps.supports_tools                   → tool calling
 *   chat_template_caps.supports_preserve_reasoning /    → thinking (reasoning)
 *   default_generation_settings.params.reasoning_format
 *
 * Non-llama.cpp servers (Ollama, LM Studio) 404 here — the caller then falls
 * through to their own arms. Returns null on any failure so the orchestrator
 * can distinguish "no llama.cpp data" from a real all-false result.
 */
export async function fetchLlamaCppProps(
  endpoint: string,
): Promise<RemoteModelInfo | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${endpoint}/props`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    return parsePropsCapabilities(await response.json());
  } catch (error) {
    // A non-llama.cpp server simply has no /props (network error / abort) — that's
    // expected and silent. Only an unexpected shape after a 200 is worth flagging,
    // but that path returns null from parsePropsCapabilities, not throw. Log at warn
    // for parity with probeLmStudioThinking so a regressing server leaves a breadcrumb.
    logger.warn('[fetchLlamaCppProps] /props unavailable:', endpoint, error instanceof Error ? error.message : error);
  } finally {
    // Always clear — an early fetch rejection (e.g. DNS failure) otherwise leaves
    // the abort timer scheduled to fire after the function has returned.
    clearTimeout(timeoutId);
  }
  return null;
}

/**
 * In-flight /props requests keyed by endpoint. /props is server-wide (a llama.cpp
 * server serves one model), but capability detection runs once per model — so a
 * multi-entry /v1/models would fire N identical /props requests. Sharing the
 * in-flight promise collapses them to one call per server per discovery pass.
 * Cleared when the request settles so a later refresh re-probes the live server.
 */
const propsInFlight = new Map<string, Promise<RemoteModelInfo | null>>();

/** De-duplicated wrapper around fetchLlamaCppProps — one /props call per endpoint. */
export function fetchLlamaCppPropsCached(endpoint: string): Promise<RemoteModelInfo | null> {
  // Deliberate in-flight-promise cache: return the pending promise un-awaited so concurrent
  // callers share one fetch. Explicit presence check (not a truthiness/await smell) so the
  // Promise-in-conditional rule (S6544) doesn't misread it as a forgotten await.
  const existing = propsInFlight.get(endpoint);
  if (existing !== undefined) return existing;
  const p = fetchLlamaCppProps(endpoint).finally(() => propsInFlight.delete(endpoint));
  propsInFlight.set(endpoint, p);
  return p;
}

/** Narrow an unknown value to a plain object, or null. */
function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? v as Record<string, unknown> : null;
}

/**
 * Parse a llama.cpp /props payload into RemoteModelInfo. Returns null when the
 * payload carries no capability data (not a llama.cpp server) so the caller can
 * fall through to other detection arms. Pure — no I/O — so it is unit-testable.
 */
function parsePropsCapabilities(data: unknown): RemoteModelInfo | null {
  const root = asObject(data);
  if (!root) return null;

  const modalities = asObject(root.modalities);
  const templateCaps = asObject(root.chat_template_caps);
  // A server that answers /props without either isn't one we can trust here.
  if (!modalities && !templateCaps) return null;

  const genSettings = asObject(root.default_generation_settings);
  const params = genSettings ? asObject(genSettings.params) : null;
  const reasoningFormat = typeof params?.reasoning_format === 'string' ? params.reasoning_format : 'none';

  // n_ctx lives on default_generation_settings (not on .params) for this build.
  const nCtx = genSettings?.n_ctx;
  const contextLength = typeof nCtx === 'number' && nCtx > 0 ? nCtx : 4096;

  // Thinking is a CAPABILITY, not the current default. `supports_preserve_reasoning`
  // and `reasoning_format` describe how the server formats reasoning by default —
  // they're false/none for a model that can still think on demand (verified: Qwen3.5
  // on the Gateway returns reasoning_content when enable_thinking:true is sent, yet
  // reports supports_preserve_reasoning=false). The reliable capability signal is the
  // chat template exposing an `enable_thinking` switch or `<think>` blocks.
  const template = typeof root.chat_template === 'string' ? root.chat_template : '';
  // A template referencing `enable_thinking` honors the chat_template_kwargs switch,
  // so the request builder can toggle reasoning per request on this server. This is a
  // distinct signal from supportsThinking (capability) and is returned for the builder.
  const acceptsThinkingKwarg = /enable_thinking/.test(template);
  // Template-based reasoning detection goes through the SHARED predicate
  // (templateEmitsReasoning) so remote and on-device (llmHelpers.detectThinkingSupport)
  // never diverge on the same template - it covers both the enable_thinking kwarg switch
  // and the <think>/channel output delimiters. The server-reported signals below are
  // extra capability evidence specific to the remote path.
  const supportsThinking =
    templateEmitsReasoning(template) ||
    templateCaps?.supports_preserve_reasoning === true ||
    (reasoningFormat !== 'none' && reasoningFormat !== '');

  return {
    contextLength,
    supportsVision: modalities?.vision === true,
    supportsToolCalling: templateCaps?.supports_tools === true,
    supportsThinking,
    acceptsThinkingKwarg,
  };
}

function hasRealData(info: RemoteModelInfo): boolean {
  return info.supportsVision || info.contextLength !== 4096 || info.supportsToolCalling === true || info.supportsThinking === true;
}

/**
 * Fetch model capabilities by trying llama.cpp /props, Ollama, and LM Studio
 * APIs in parallel. Falls back to name-based detection when none returns real
 * data. Works regardless of the port the server runs on.
 *
 * Priority: llama.cpp /props first — it is authoritative (reads the loaded
 * model's real modalities/template, not a name guess), which is why the Off
 * Grid AI Gateway's vision/thinking/tools now resolve correctly instead of
 * false-negativing through name-based detection.
 */
export async function fetchModelCapabilities(
  endpoint: string,
  modelId: string,
  nameBasedDetect: { vision: (id: string) => boolean; toolCalling: (id: string) => boolean },
): Promise<RemoteModelInfo> {
  const [propsInfo, ollamaInfo, lmInfo] = await Promise.all([
    // Deduped per endpoint — /props is server-wide, so all models on one server
    // share a single request instead of firing one each.
    fetchLlamaCppPropsCached(endpoint),
    fetchRemoteModelInfo(endpoint, modelId),
    fetchLmStudioModelInfo(endpoint, modelId),
  ]);

  // /props wins whenever it answered at all: on a llama.cpp server it is the
  // ground truth, even when every flag is false (a genuine text-only model).
  if (propsInfo) return propsInfo;
  if (hasRealData(ollamaInfo)) return ollamaInfo;
  if (hasRealData(lmInfo)) return lmInfo;

  // No API returned real data — fall back to name-based detection
  return {
    contextLength: 4096,
    supportsVision: nameBasedDetect.vision(modelId),
    supportsToolCalling: nameBasedDetect.toolCalling(modelId),
  };
}

/** Returns true for models that generate text/images — filters out embedding, reranker, etc. */
export function isGenerativeModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  const nonGenerativePatterns = [
    'embed', 'embedding', 'rerank', 'reranker', 'classifier',
    'bge-', 'e5-', 'gte-', 'minilm', 'arctic-embed',
  ];
  return !nonGenerativePatterns.some(p => id.includes(p));
}
