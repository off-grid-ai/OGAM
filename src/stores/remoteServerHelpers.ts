
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
    const { models } = await fetchModelsFromServer(server);

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
    const { models } = await fetchModelsFromServer(tempServer);
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

export interface DiscoveryResult {
  models: RemoteModel[];
  reachable: boolean;
}

export async function fetchModelsFromServer(server: RemoteServer): Promise<DiscoveryResult> {
  let url = server.endpoint;
  while (url.endsWith('/')) url = url.slice(0, -1);

  // Headers for authentication
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (server.apiKey) {
    headers.Authorization = `Bearer ${server.apiKey}`;
  }

  let reachable = false;

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
    reachable = true;

    if (response.ok) {
      const data = await response.json();

      const nameDetect = { vision: detectVisionCapability, toolCalling: detectToolCallingCapability };

      // OpenAI format: { object: "list", data: [{ id, object, owned_by, ... }] }
      if (data?.object === 'list' && Array.isArray(data.data)) {
        const generativeModels = data.data.filter((model: { id: string }) => isGenerativeModel(model.id));
        const modelInfos = await Promise.all(
          generativeModels.map((model: { id: string }) =>
            fetchModelCapabilities(url, model.id, nameDetect)
          )
        );
        return {
          models: generativeModels.map((model: { id: string; owned_by?: string; max_context_length?: number }, i: number) => ({
            id: model.id,
            name: model.id,
            serverId: server.id,
            capabilities: {
              supportsVision: modelInfos[i].supportsVision,
              supportsToolCalling: modelInfos[i].supportsToolCalling ?? detectToolCallingCapability(model.id),
              supportsThinking: modelInfos[i].supportsThinking ?? false,
              maxContextLength: modelInfos[i].contextLength,
            },
            lastUpdated: new Date().toISOString(),
          })),
          reachable: true,
        };
      }

      // Ollama format via /v1/models: { models: [{ name, ... }] }
      if (Array.isArray(data.models)) {
        const generativeModels = data.models.filter(
          (model: { name: string }) => isGenerativeModel(model.name)
        );
        const modelInfos = await Promise.all(
          generativeModels.map((model: { name: string }) =>
            fetchModelCapabilities(url, model.name, nameDetect)
          )
        );
        return {
          models: generativeModels.map(
            (model: { name: string; details?: Record<string, unknown> }, i: number) => ({
              id: model.name,
              name: model.name,
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
          ),
          reachable: true,
        };
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
    reachable = true;

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
        return {
          models: generativeModels.map(
            (model: { name: string; details?: Record<string, unknown> }, i: number) => ({
              id: model.name,
              name: model.name,
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
          ),
          reachable: true,
        };
      }
    }
  } catch (error) {
    logger.warn('[RemoteServer] Failed to fetch from /api/tags:', error);
  }

  // No models found — reachable tells the caller whether the server responded
  // at all (vs. network error / DNS / timeout).
  return { models: [], reachable };
}
