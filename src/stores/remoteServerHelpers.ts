/**
 * Remote Server Helpers
 *
 * Pure async helpers for testing server connections and fetching model lists.
 * Extracted from remoteServerStore to keep the store file under the line limit.
 */

import {
  RemoteServer,
  RemoteModel,
  RemoteMediaModelIds,
  RemoteModelCatalog,
  RemoteModelCategory,
  ServerTestResult,
} from '../types';
import { testEndpoint, detectServerType } from '../services/httpClient';
import logger from '../utils/logger';
import {
  fetchModelCapabilities,
  isGenerativeModel,
} from './remoteModelCapabilities';
import {
  detectVisionCapability,
  detectToolCallingCapability,
} from '../utils/remoteCapabilityDetect';
import {
  REMOTE_FETCH_REDIRECT_POLICY,
  remoteAuthorizationHeaders,
} from '../services/remoteTransportPolicy';
import { readOffGridDesktopModelState } from '../services/offGridDesktopModels';

/** Timeout for model discovery fetches (non-critical, background operation) */
const DISCOVERY_FETCH_TIMEOUT_MS = 5000;

function trimTrailingSlashes(value: string): string {
  let result = value;
  while (result.endsWith('/')) result = result.slice(0, -1);
  return result;
}

async function fetchForDiscovery(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    DISCOVERY_FETCH_TIMEOUT_MS,
  );
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

const gatewayCategory = (kind: unknown): RemoteModelCategory | null => {
  if (kind === 'chat' || kind === 'vision') return 'text';
  if (kind === 'image') return 'image';
  if (kind === 'transcription') return 'transcription';
  if (kind === 'speech') return 'voice';
  return null;
};

function declaredCapability(
  capabilities: unknown,
  capability: 'vision' | 'tools',
): boolean | undefined {
  if (!Array.isArray(capabilities)) return undefined;
  return capabilities.includes(capability);
}

async function fetchGatewayModelCatalog(
  server: RemoteServer,
): Promise<RemoteModelCatalog> {
  const url = trimTrailingSlashes(server.endpoint);
  const headers: Record<string, string> = { Accept: 'application/json' };
  Object.assign(
    headers,
    remoteAuthorizationHeaders(server.endpoint, server.apiKey),
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    DISCOVERY_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${url}/v1/models`, {
      headers,
      signal: controller.signal,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
    if (!response.ok) return {};
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) return {};

    const result: RemoteModelCatalog = {};
    for (const model of payload.data as Array<{
      id?: unknown;
      name?: unknown;
      kind?: unknown;
    }>) {
      if (typeof model.id !== 'string' || typeof model.kind !== 'string')
        continue;
      const category = gatewayCategory(model.kind);
      if (!category) continue;
      const options = result[category] ?? [];
      options.push({
        id: model.id,
        name:
          typeof model.name === 'string' && model.name.trim()
            ? displayModelName(model.name)
            : displayModelName(model.id),
      });
      result[category] = options;
    }
    return result;
  } catch {
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}

function defaultModelIds(catalog: RemoteModelCatalog): RemoteMediaModelIds {
  return Object.fromEntries(
    Object.entries(catalog)
      .filter(([, models]) => models?.[0])
      .map(([category, models]) => [category, models![0].id]),
  ) as RemoteMediaModelIds;
}

/**
 * The Off Grid AI Desktop gateway tags every /v1/models entry with a modality
 * `kind` (chat | vision | image | speech | transcription). Only chat/vision are
 * text models that belong in the chat model picker — image, speech (TTS) and
 * transcription (STT) models must not be listed as text. Servers that don't send
 * `kind` (Ollama, LM Studio) fall back to the name-based generative filter.
 */
function isTextModel(model: {
  id?: string;
  name?: string;
  kind?: unknown;
}): boolean {
  const kind = typeof model.kind === 'string' ? model.kind : null;
  if (kind) return kind === 'chat' || kind === 'vision';
  return isGenerativeModel(model.id ?? model.name ?? '');
}

const MODEL_FILE_EXT = /\.(gguf|bin|safetensors|task|litertlm|pte)$/i;

/**
 * Human-readable label for a remote model. Some gateways report the model id as a
 * full file path (e.g. "/Users/admin/.offgrid/models/Qwen3.5-9B-Q4_K_M.gguf"),
 * which is unreadable in the picker. Show the basename without the extension while
 * keeping the raw id for loading.
 *
 * Only basename-strip when the id actually LOOKS like a filesystem path — an
 * absolute POSIX path ("/…"), a Windows path ("C:\…" / "C:/…"), or any string
 * that ends in a known model file extension. A namespace-style slug ("org/model",
 * "meta-llama/Llama-3.1-8B") is NOT a path: stripping its prefix would drop the
 * meaningful namespace and could collapse distinct models to the same label, so
 * it's returned unchanged.
 */
export function displayModelName(id: string): string {
  if (id.startsWith('remote-vision:')) {
    const modelSeparator = id.indexOf(':', 'remote-vision:'.length);
    if (modelSeparator !== -1) {
      try {
        return decodeURIComponent(id.slice(modelSeparator + 1));
      } catch {
        // Keep the stable raw id when a third-party gateway sends bad encoding.
      }
    }
  }
  const looksLikePath =
    id.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(id) ||
    id.includes('\\') ||
    MODEL_FILE_EXT.test(id);
  const base = looksLikePath ? id.split(/[\\/]/).pop() || id : id;
  return base.replace(MODEL_FILE_EXT, '');
}

export async function testServerConnection(
  server: RemoteServer,
): Promise<ServerTestResult> {
  try {
    const testResult = await testEndpoint(
      server.endpoint,
      10000,
      server.apiKey,
    );

    if (!testResult.success) {
      return {
        success: false,
        error: testResult.error,
        latency: testResult.latency,
      };
    }

    const desktopState = await readOffGridDesktopModelState(server);
    if (desktopState) {
      return {
        success: true,
        latency: testResult.latency,
        models: desktopState.textModels,
        mediaModels: desktopState.active,
        modelCatalog: desktopState.catalog,
        modelManagement: 'offgrid-desktop-v1',
        serverInfo: { name: 'off-grid-desktop' },
      };
    }
    if (server.modelManagement === 'offgrid-desktop-v1') {
      return {
        success: false,
        error: 'Desktop model state could not be read.',
        latency: testResult.latency,
      };
    }

    // Generic OpenAI-compatible servers keep their /v1/models discovery path.
    const [models, modelCatalog] = await Promise.all([
      fetchModelsFromServer(server),
      fetchGatewayModelCatalog(server),
    ]);

    // Detect server type
    const serverType = await detectServerType(
      server.endpoint,
      5000,
      server.apiKey,
    );

    return {
      success: true,
      latency: testResult.latency,
      models,
      mediaModels: defaultModelIds(modelCatalog),
      modelCatalog,
      serverInfo: {
        name: serverType?.type,
        version: serverType?.version,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function testEndpointAndGetModels(
  endpoint: string,
  apiKey?: string,
): Promise<ServerTestResult> {
  try {
    const testResult = await testEndpoint(endpoint, 10000, apiKey);

    if (!testResult.success) {
      return {
        success: false,
        error: testResult.error,
        latency: testResult.latency,
      };
    }

    // Try to discover models with a temporary server config
    const tempServer: RemoteServer = {
      id: 'temp',
      name: 'temp',
      endpoint,
      providerType: 'openai-compatible',
      createdAt: new Date().toISOString(),
      apiKey,
    };
    const desktopState = await readOffGridDesktopModelState(tempServer);
    if (desktopState) {
      return {
        success: true,
        latency: testResult.latency,
        models: desktopState.textModels,
        mediaModels: desktopState.active,
        modelCatalog: desktopState.catalog,
        modelManagement: 'offgrid-desktop-v1',
        serverInfo: { name: 'off-grid-desktop' },
      };
    }

    // Generic OpenAI-compatible servers keep their /v1/models discovery path.
    const [models, modelCatalog] = await Promise.all([
      fetchModelsFromServer(tempServer),
      fetchGatewayModelCatalog(tempServer),
    ]);
    const serverType = await detectServerType(endpoint, 5000, apiKey);

    return {
      success: true,
      latency: testResult.latency,
      models,
      mediaModels: defaultModelIds(modelCatalog),
      modelCatalog,
      serverInfo: {
        name: serverType?.type,
        version: serverType?.version,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function fetchModelsFromServer(
  server: RemoteServer,
): Promise<RemoteModel[]> {
  const url = trimTrailingSlashes(server.endpoint);

  // Headers for authentication
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  Object.assign(
    headers,
    remoteAuthorizationHeaders(server.endpoint, server.apiKey),
  );

  // Try OpenAI-compatible endpoint first
  try {
    const response = await fetchForDiscovery(`${url}/v1/models`, {
      method: 'GET',
      headers,
    });

    if (response.ok) {
      const data = await response.json();

      const nameDetect = {
        vision: detectVisionCapability,
        toolCalling: detectToolCallingCapability,
      };

      // OpenAI format: { object: "list", data: [{ id, object, owned_by, ... }] }
      if (data?.object === 'list' && Array.isArray(data.data)) {
        const generativeModels = data.data.filter(
          (model: { id: string; kind?: unknown }) => isTextModel(model),
        );
        const modelInfos = await Promise.all(
          generativeModels.map((model: { id: string }) =>
            fetchModelCapabilities(url, model.id, nameDetect),
          ),
        );
        return generativeModels.map(
          (
            model: {
              id: string;
              name?: string;
              kind?: unknown;
              owned_by?: string;
              max_context_length?: number;
              capabilities?: unknown;
            },
            i: number,
          ) => ({
          id: model.id,
            name: displayModelName(model.name?.trim() || model.id),
          serverId: server.id,
          capabilities: {
            // The gateway declares each model's kind authoritatively; trust kind:'vision'
            // for vision support. The name/probe-based fallback (modelInfos) can't detect a
            // gateway vision model whose id doesn't match the name heuristics, which dropped
            // the attached image client-side (the model then behaved text-only).
              supportsVision:
                model.kind === 'vision' ||
                (declaredCapability(model.capabilities, 'vision') ??
                  modelInfos[i].supportsVision),
              supportsToolCalling:
                declaredCapability(model.capabilities, 'tools') ??
                modelInfos[i].supportsToolCalling ??
                detectToolCallingCapability(model.id),
            supportsThinking: modelInfos[i].supportsThinking ?? false,
            thinkingLevelsOnly: modelInfos[i].thinkingLevelsOnly,
            acceptsThinkingKwarg: modelInfos[i].acceptsThinkingKwarg ?? false,
            maxContextLength: modelInfos[i].contextLength,
          },
          lastUpdated: new Date().toISOString(),
          }),
        );
      }

      // Ollama format via /v1/models: { models: [{ name, ... }] }
      if (Array.isArray(data.models)) {
        const generativeModels = data.models.filter(
          (model: { name: string; kind?: unknown }) => isTextModel(model),
        );
        const modelInfos = await Promise.all(
          generativeModels.map((model: { name: string }) =>
            fetchModelCapabilities(url, model.name, nameDetect),
          ),
        );
        return generativeModels.map(
          (
            model: { name: string; details?: Record<string, unknown> },
            i: number,
          ) => ({
            id: model.name,
            name: displayModelName(model.name),
            serverId: server.id,
            capabilities: {
              supportsVision: modelInfos[i].supportsVision,
              supportsToolCalling:
                modelInfos[i].supportsToolCalling ??
                detectToolCallingCapability(model.name),
              supportsThinking: modelInfos[i].supportsThinking ?? false,
              thinkingLevelsOnly: modelInfos[i].thinkingLevelsOnly,
              acceptsThinkingKwarg: modelInfos[i].acceptsThinkingKwarg ?? false,
              maxContextLength: modelInfos[i].contextLength,
            },
            details: model.details,
            lastUpdated: new Date().toISOString(),
          }),
        );
      }
    }
  } catch (error) {
    logger.warn('[RemoteServer] Failed to fetch from /v1/models:', error);
  }

  // Try Ollama-specific endpoint (use origin to avoid double-path if endpoint has a prefix)
  try {
    const ollamaUrl = `${new URL(url).origin}/api/tags`;
    const response = await fetchForDiscovery(ollamaUrl, {
      method: 'GET',
      headers,
    });

    if (response.ok) {
      const data = await response.json();

      if (Array.isArray(data.models)) {
        const nameDetect = {
          vision: detectVisionCapability,
          toolCalling: detectToolCallingCapability,
        };
        const generativeModels = data.models.filter((model: { name: string }) =>
          isGenerativeModel(model.name),
        );
        const modelInfos = await Promise.all(
          generativeModels.map((model: { name: string }) =>
            fetchModelCapabilities(url, model.name, nameDetect),
          ),
        );
        return generativeModels.map(
          (
            model: { name: string; details?: Record<string, unknown> },
            i: number,
          ) => ({
            id: model.name,
            name: displayModelName(model.name),
            serverId: server.id,
            capabilities: {
              supportsVision: modelInfos[i].supportsVision,
              supportsToolCalling:
                modelInfos[i].supportsToolCalling ??
                detectToolCallingCapability(model.name),
              supportsThinking: modelInfos[i].supportsThinking ?? false,
              thinkingLevelsOnly: modelInfos[i].thinkingLevelsOnly,
              acceptsThinkingKwarg: modelInfos[i].acceptsThinkingKwarg ?? false,
              maxContextLength: modelInfos[i].contextLength,
            },
            details: model.details,
            lastUpdated: new Date().toISOString(),
          }),
        );
      }
    }
  } catch (error) {
    logger.warn('[RemoteServer] Failed to fetch from /api/tags:', error);
  }

  // No models found
  return [];
}
