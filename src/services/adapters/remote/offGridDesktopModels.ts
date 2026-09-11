import logger from '../../../utils/logger';
import type {
  RemoteMediaModelIds,
  RemoteModel,
  RemoteModelCatalog,
  RemoteModelCategory,
  RemoteServer,
} from '../../../types';
import {
  REMOTE_FETCH_REDIRECT_POLICY,
  projectOffGridDesktopModels,
  remoteApiBase,
  remoteAuthorizationHeaders,
  type RemoteDesktopProviderEvidence,
} from '@offgrid/models';

const REQUEST_TIMEOUT_MS = 5_000;

interface OffGridDesktopModelState {
  catalog: RemoteModelCatalog;
  active: RemoteMediaModelIds;
  textModels: RemoteModel[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function gatewayFetch(
  server: Pick<RemoteServer, 'endpoint' | 'apiKey'>,
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = remoteApiBase(server.endpoint);
  try {
    return await fetch(`${endpoint}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...remoteAuthorizationHeaders(server.endpoint, server.apiKey),
        ...init.headers,
      },
      signal: controller.signal,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Read the three Desktop resources without applying provider or inventory policy. */
export async function readOffGridDesktopModelEvidence(
  server: Pick<RemoteServer, 'endpoint' | 'apiKey'>,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<RemoteDesktopProviderEvidence | null> {
  try {
    const [catalogResponse, installedResponse, activeResponse] = await Promise.all([
      gatewayFetch(server, '/models/catalog', { timeoutMs }),
      gatewayFetch(server, '/models/installed', { timeoutMs }),
      gatewayFetch(server, '/models/active', { timeoutMs }),
    ]);
    if (!catalogResponse.ok || !installedResponse.ok || !activeResponse.ok) return null;
    const [catalog, installed, active] = await Promise.all([
      catalogResponse.json(), installedResponse.json(), activeResponse.json(),
    ]);
    return { catalog, installed, active };
  } catch {
    return null;
  }
}

/** Read raw Desktop inventory over HTTP, then delegate validation and projection to Shared. */
async function readOffGridDesktopModelState(
  server: Pick<RemoteServer, 'id' | 'endpoint' | 'apiKey'>,
): Promise<OffGridDesktopModelState | null> {
  try {
    const evidence = await readOffGridDesktopModelEvidence(server);
    if (!evidence) return null;
    const projected = projectOffGridDesktopModels(evidence);
    if (!projected) return null;
    const lastUpdated = new Date().toISOString();
    return {
      catalog: projected.catalog,
      active: projected.selections,
      textModels: projected.textModels.map(model => ({
        id: model.id,
        name: model.name,
        serverId: server.id,
        capabilities: {
          supportsVision: model.capabilities?.supportsVision === true,
          // Published facts pass through as published; an absent fact stays unknown.
          ...(typeof model.capabilities?.supportsToolCalling === 'boolean'
            ? { supportsToolCalling: model.capabilities.supportsToolCalling }
            : {}),
          ...(typeof model.capabilities?.supportsThinking === 'boolean'
            ? { supportsThinking: model.capabilities.supportsThinking }
            : {}),
        },
        lastUpdated,
      })),
    };
  } catch (error) {
    // Never silent: "Desktop model state could not be read" needs a cause in the log.
    logger.warn(
      `[OffGridDesktop] model state unreadable at ${server.endpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/** Activate one installed Desktop model, then confirm Desktop reports that exact selection. */
export async function activateOffGridDesktopModel(
  server: RemoteServer,
  category: RemoteModelCategory,
  modelId: string,
): Promise<RemoteMediaModelIds> {
  const response = await gatewayFetch(server, '/models/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: modelId, kind: category }),
  });
  const result = record(await response.json().catch(() => null));
  if (!response.ok || result?.success !== true) {
    throw new Error(typeof result?.error === 'string'
      ? result.error
      : 'Desktop could not activate this model.');
  }
  const refreshed = await readOffGridDesktopModelState(server);
  if (!refreshed || refreshed.active[category] !== modelId) {
    // Say what was asked and what came back; a bare "did not confirm" hid an id-shape mismatch.
    logger.warn(
      `[OffGridDesktop] activation not confirmed: asked ${category}=${modelId}, Desktop reports ${JSON.stringify(refreshed?.active ?? null)}`,
    );
    throw new Error('Desktop did not confirm the selected model.');
  }
  return refreshed.active;
}
