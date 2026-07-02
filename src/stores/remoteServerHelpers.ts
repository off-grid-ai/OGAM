
/**
 * Remote Server Helpers
 *
 * Pure async helpers for testing server connections and fetching model lists.
 * Extracted from remoteServerStore to keep the store file under the line limit.
 */

import { RemoteServer, RemoteModel, ServerTestResult } from '../types';
import { testEndpoint, detectServerType } from '../services/httpClient';
import logger from '../utils/logger';
import {
  fetchModelCapabilities,
  isGenerativeModel,
} from './remoteModelCapabilities';
import {
  detectVisionCapability,
  detectToolCallingCapability,
} from '../services/remoteServerManagerUtils';

/** Timeout for model discovery fetches (non-critical, background operation) */
const DISCOVERY_FETCH_TIMEOUT_MS = 5000;

/**
 * The Off Grid AI Desktop gateway tags every /v1/models entry with a modality
 * `kind` (chat | vision | image | speech | transcription). Only chat/vision are
 * text models that belong in the chat model picker — image, speech (TTS) and
 * transcription (STT) models must not be listed as text. Servers that don't send
 * `kind` (Ollama, LM Studio) fall back to the name-based generative filter.
 */
function isTextModel(model: { id?: string; name?: string; kind?: unknown }): boolean {
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
  const looksLikePath =
    id.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(id) ||
    id.includes('\\') ||
    MODEL_FILE_EXT.test(id);
  const base = looksLikePath ? (id.split(/[\\/]/).pop() || id) : id;
  return base.replace(MODEL_FILE_EXT, '');
}

export async function testServerConnection(server: RemoteServer): Promise<ServerTestResult> {
  try {
    const testResult = await testEndpoint(server.endpoint, 10000, server.apiKey);

    if (!testResult.success) {
      return {
        success: false,
        error: testResult.error,
        latency: testResult.latency,
      };
    }

    // Try to discover models
    const models = await fetchModelsFromServer(server);

    // Detect server type
    const serverType = await detectServerType(server.endpoint, 5000, server.apiKey);

    return {
      success: true,
      latency: testResult.latency,
      models,
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
    const models = await fetchModelsFromServer(tempServer);
    const serverType = await detectServerType(endpoint, 5000, apiKey);

    return {
      success: true,
      latency: testResult.latency,
      models,
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

export async function fetchModelsFromServer(server: RemoteServer): Promise<RemoteModel[]> {
  let url = server.endpoint;
  while (url.endsWith('/')) url = url.slice(0, -1);

  // Headers for authentication
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (server.apiKey) {
    headers.Authorization = `Bearer ${server.apiKey}`;
  }

  // Try OpenAI-compatible endpoint first
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DISCOVERY_FETCH_TIMEOUT_MS);

    const response = await fetch(`${url}/v1/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();

      const nameDetect = { vision: detectVisionCapability, toolCalling: detectToolCallingCapability };

      // OpenAI format: { object: "list", data: [{ id, object, owned_by, ... }] }
      if (data?.object === 'list' && Array.isArray(data.data)) {
        const generativeModels = data.data.filter((model: { id: string; kind?: unknown }) => isTextModel(model));
        const modelInfos = await Promise.all(
          generativeModels.map((model: { id: string }) =>
            fetchModelCapabilities(url, model.id, nameDetect)
          )
        );
        return generativeModels.map((model: { id: string; owned_by?: string; max_context_length?: number }, i: number) => ({
          id: model.id,
          name: displayModelName(model.id),
          serverId: server.id,
          capabilities: {
            supportsVision: modelInfos[i].supportsVision,
            supportsToolCalling: modelInfos[i].supportsToolCalling ?? detectToolCallingCapability(model.id),
            supportsThinking: modelInfos[i].supportsThinking ?? false,
            maxContextLength: modelInfos[i].contextLength,
          },
          lastUpdated: new Date().toISOString(),
        }));
      }

      // Ollama format via /v1/models: { models: [{ name, ... }] }
      if (Array.isArray(data.models)) {
        const generativeModels = data.models.filter(
          (model: { name: string; kind?: unknown }) => isTextModel(model)
        );
        const modelInfos = await Promise.all(
          generativeModels.map((model: { name: string }) =>
            fetchModelCapabilities(url, model.name, nameDetect)
          )
        );
        return generativeModels.map(
          (model: { name: string; details?: Record<string, unknown> }, i: number) => ({
            id: model.name,
            name: displayModelName(model.name),
            serverId: server.id,
            capabilities: {
              supportsVision: modelInfos[i].supportsVision,
              supportsToolCalling: modelInfos[i].supportsToolCalling ?? detectToolCallingCapability(model.name),
              supportsThinking: modelInfos[i].supportsThinking ?? false,
              maxContextLength: modelInfos[i].contextLength,
            },
            details: model.details,
            lastUpdated: new Date().toISOString(),
          })
        );
      }
    }
  } catch (error) {
    logger.warn('[RemoteServer] Failed to fetch from /v1/models:', error);
  }

  // Try Ollama-specific endpoint (use origin to avoid double-path if endpoint has a prefix)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DISCOVERY_FETCH_TIMEOUT_MS);

    const ollamaUrl = `${new URL(url).origin}/api/tags`;
    const response = await fetch(ollamaUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();

      if (Array.isArray(data.models)) {
        const nameDetect = { vision: detectVisionCapability, toolCalling: detectToolCallingCapability };
        const generativeModels = data.models.filter(
          (model: { name: string }) => isGenerativeModel(model.name)
        );
        const modelInfos = await Promise.all(
          generativeModels.map((model: { name: string }) =>
            fetchModelCapabilities(url, model.name, nameDetect)
          )
        );
        return generativeModels.map(
          (model: { name: string; details?: Record<string, unknown> }, i: number) => ({
            id: model.name,
            name: displayModelName(model.name),
            serverId: server.id,
            capabilities: {
              supportsVision: modelInfos[i].supportsVision,
              supportsToolCalling: modelInfos[i].supportsToolCalling ?? detectToolCallingCapability(model.name),
              supportsThinking: modelInfos[i].supportsThinking ?? false,
              maxContextLength: modelInfos[i].contextLength,
            },
            details: model.details,
            lastUpdated: new Date().toISOString(),
          })
        );
      }
    }
  } catch (error) {
    logger.warn('[RemoteServer] Failed to fetch from /api/tags:', error);
  }

  // No models found
  return [];
}
