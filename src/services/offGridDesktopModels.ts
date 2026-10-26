import type {
  RemoteMediaModelIds,
  RemoteModel,
  RemoteModelCatalog,
  RemoteModelCategory,
  RemoteModelOption,
  RemoteServer,
} from '../types';
import { predictGgufCapabilities } from '../utils/ggufCapabilities';
import { displayModelName } from '../utils/displayModelName';
import {
  REMOTE_FETCH_REDIRECT_POLICY,
  remoteAuthorizationHeaders,
} from './remoteTransportPolicy';

type GatewayCategory = RemoteModelCategory | null;

interface GatewayCatalogModel {
  id: string;
  name: string;
  kind: string;
  files: string[];
}

interface GatewayLiveModel {
  // An absent array means Desktop has not loaded this model yet; it is not a
  // declaration that the model lacks tools.
  capabilities: string[] | null;
  reasoningMandatory: boolean;
}

export interface OffGridDesktopModelState {
  catalog: RemoteModelCatalog;
  active: RemoteMediaModelIds;
  textModels: RemoteModel[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function categoryForKind(kind: string): GatewayCategory {
  if (kind === 'text' || kind === 'vision' || kind === 'chat') return 'text';
  if (kind === 'video') return 'video';
  if (kind === 'image') return 'image';
  if (kind === 'voice' || kind === 'speech') return 'voice';
  if (kind === 'transcription') return 'transcription';
  return null;
}

function modelFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    const candidate = record(item);
    return typeof candidate?.name === 'string' && candidate.name.trim()
      ? [candidate.name.trim()]
      : [];
  });
}

function parseCatalog(value: unknown): GatewayCatalogModel[] | null {
  const payload = record(value);
  if (
    !payload ||
    !Array.isArray(payload.models) ||
    !Array.isArray(payload.kinds)
  ) {
    return null;
  }
  const models: GatewayCatalogModel[] = [];
  for (const item of payload.models) {
    const candidate = record(item);
    if (
      typeof candidate?.id !== 'string' ||
      !candidate.id.trim() ||
      typeof candidate.name !== 'string' ||
      !candidate.name.trim() ||
      typeof candidate.kind !== 'string'
    ) {
      continue;
    }
    models.push({
      id: candidate.id.trim(),
      // Desktop names an imported model by its file path; every picker reads this name, so it is
      // cleaned once here, exactly as the other remote discovery paths already clean theirs.
      name: displayModelName(candidate.name.trim()),
      kind: candidate.kind,
      files: modelFiles(candidate.files),
    });
  }
  return models;
}

function parseInstalled(value: unknown): Set<string> | null {
  const payload = record(value);
  if (!payload || !Array.isArray(payload.installed)) return null;
  return new Set(
    payload.installed.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0,
    ),
  );
}

function parseLiveModels(value: unknown): Map<string, GatewayLiveModel> {
  const payload = record(value);
  const result = new Map<string, GatewayLiveModel>();
  if (!payload || !Array.isArray(payload.data)) return result;
  for (const item of payload.data) {
    const candidate = record(item);
    if (typeof candidate?.id !== 'string') continue;
    const capabilities = Array.isArray(candidate.capabilities)
      ? candidate.capabilities.filter(
          (capability): capability is string => typeof capability === 'string',
        )
      : null;
    const reasoning = record(candidate.reasoning);
    result.set(candidate.id, {
      capabilities,
      reasoningMandatory: reasoning?.mandatory === true,
    });
  }
  return result;
}

function parseActive(value: unknown): Record<string, string | null> | null {
  const payload = record(value);
  if (!payload) return null;
  const active: Record<string, string | null> = {};
  for (const [kind, id] of Object.entries(payload)) {
    if (id !== null && typeof id !== 'string') return null;
    active[kind] = typeof id === 'string' && id.trim() ? id.trim() : null;
  }
  return active;
}

async function gatewayFetch(
  server: Pick<RemoteServer, 'endpoint' | 'apiKey'>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let endpoint = server.endpoint;
  while (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);
  return fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...remoteAuthorizationHeaders(server.endpoint, server.apiKey),
      ...init.headers,
    },
    redirect: REMOTE_FETCH_REDIRECT_POLICY,
  });
}

function optionFor(
  models: readonly GatewayCatalogModel[],
  installed: ReadonlySet<string>,
): RemoteModelCatalog {
  const result: RemoteModelCatalog = {};
  for (const model of models) {
    if (!installed.has(model.id)) continue;
    const category = categoryForKind(model.kind);
    if (!category) continue;
    const option: RemoteModelOption = {
      id: model.id,
      name: model.name,
      ...(model.files.length > 0 ? { activeAliases: model.files } : {}),
    };
    result[category] = [...(result[category] ?? []), option];
  }
  return result;
}

function activeOptionId(
  catalog: RemoteModelCatalog,
  category: RemoteModelCategory,
  activeId: string | null | undefined,
): string | undefined {
  if (!activeId) return undefined;
  return catalog[category]?.find(
    option =>
      option.id === activeId || option.activeAliases?.includes(activeId),
  )?.id;
}

function projectActive(
  catalog: RemoteModelCatalog,
  active: Record<string, string | null>,
): RemoteMediaModelIds {
  const text = activeOptionId(catalog, 'text', active.text);
  const video = activeOptionId(catalog, 'video', active.video);
  const image = activeOptionId(catalog, 'image', active.image);
  const transcription = activeOptionId(
    catalog,
    'transcription',
    active.transcription,
  );
  const voice = activeOptionId(
    catalog,
    'voice',
    active.speech ?? active.voice,
  );
  return {
    ...(text ? { text } : {}),
    ...(image ? { image } : {}),
    ...(video ? { video } : {}),
    ...(transcription ? { transcription } : {}),
    ...(voice ? { voice } : {}),
  };
}

function textModels(
  serverId: string,
  models: readonly GatewayCatalogModel[],
  installed: ReadonlySet<string>,
  liveModels: ReadonlyMap<string, GatewayLiveModel>,
): RemoteModel[] {
  return models.flatMap(model => {
    if (!installed.has(model.id) || categoryForKind(model.kind) !== 'text') {
      return [];
    }
    const live = liveModels.get(model.id);
    const predicted = predictGgufCapabilities(model);
    const hasLiveCapabilities = live?.capabilities !== undefined && live.capabilities !== null;
    const supportsThinking = hasLiveCapabilities
      ? live?.capabilities?.includes('reasoning') === true ||
        live?.reasoningMandatory === true
      : predicted.thinking;
    return [
      {
        id: model.id,
        name: model.name,
        serverId,
        capabilities: {
          supportsVision:
            model.kind === 'vision' ||
            live?.capabilities?.includes('vision') === true,
          supportsToolCalling: hasLiveCapabilities
            ? live?.capabilities?.includes('tools') === true
            : // Desktop offloads idle models, so /v1/models can omit capabilities.
              // Keep tools usable until the runtime makes an authoritative claim.
              true,
          supportsThinking,
          acceptsThinkingKwarg:
            model.id.startsWith('remote-vision:') && supportsThinking,
          ...(live?.reasoningMandatory ? { thinkingLevelsOnly: true } : {}),
        },
        lastUpdated: new Date().toISOString(),
      },
    ];
  });
}

/** Detect and read the complete installed-model contract exposed by Off Grid Desktop. */
export async function readOffGridDesktopModelState(
  server: Pick<RemoteServer, 'id' | 'endpoint' | 'apiKey'>,
): Promise<OffGridDesktopModelState | null> {
  try {
    const [catalogResponse, installedResponse, activeResponse, liveResponse] =
      await Promise.all([
        gatewayFetch(server, '/v1/models/catalog'),
        gatewayFetch(server, '/v1/models/installed'),
        gatewayFetch(server, '/v1/models/active'),
        gatewayFetch(server, '/v1/models'),
      ]);
    if (!catalogResponse.ok || !installedResponse.ok || !activeResponse.ok) {
      return null;
    }
    const [catalogPayload, installedPayload, activePayload] =
      await Promise.all([
        catalogResponse.json(),
        installedResponse.json(),
        activeResponse.json(),
      ]);
    const models = parseCatalog(catalogPayload);
    const installed = parseInstalled(installedPayload);
    const activeValues = parseActive(activePayload);
    const liveModels = liveResponse.ok
      ? parseLiveModels(await liveResponse.json().catch(() => null))
      : new Map<string, GatewayLiveModel>();
    if (!models || !installed || !activeValues) return null;
    const catalog = optionFor(models, installed);
    return {
      catalog,
      active: projectActive(catalog, activeValues),
      textModels: textModels(server.id, models, installed, liveModels),
    };
  } catch {
    return null;
  }
}

/** Activate one installed Desktop model, then confirm Desktop reports that exact selection. */
export async function activateOffGridDesktopModel(
  server: RemoteServer,
  category: RemoteModelCategory,
  modelId: string,
): Promise<OffGridDesktopModelState> {
  const response = await gatewayFetch(server, '/v1/models/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: modelId, kind: category }),
  });
  const result = record(await response.json().catch(() => null));
  if (response.status === 401) {
    throw new Error(
      server.apiKey
        ? 'Desktop did not accept this API key. Copy a current one from Off Grid AI Desktop, Gateway, API keys, and paste it in Remote servers, Edit.'
        : 'Desktop asks for an API key. Copy one from Off Grid AI Desktop, Gateway, API keys, and paste it in Remote servers, Edit.',
    );
  }
  if (!response.ok || result?.success !== true) {
    throw new Error(
      typeof result?.error === 'string'
        ? result.error
        : 'Desktop could not activate this model.',
    );
  }
  const refreshed = await readOffGridDesktopModelState(server);
  if (!refreshed || refreshed.active[category] !== modelId) {
    throw new Error('Desktop did not confirm the selected model.');
  }
  return refreshed;
}

/** How a download on the Desktop is going, as its gateway reports it. */
export interface OffGridDesktopDownload {
  status: 'idle' | 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  percent: number;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
  /** On completion: the installed package to activate. */
  installedId?: string;
}

function gatewayError(server: Pick<RemoteServer, 'apiKey'>, status: number, fallback: string, body: Record<string, unknown> | null): Error {
  if (status === 401) {
    return new Error(
      server.apiKey
        ? 'Desktop did not accept this API key. Copy a current one from Off Grid AI Desktop, Gateway, API keys, and paste it in Remote servers, Edit.'
        : 'Desktop asks for an API key. Copy one from Off Grid AI Desktop, Gateway, API keys, and paste it in Remote servers, Edit.',
    );
  }
  return new Error(typeof body?.error === 'string' ? body.error : fallback);
}

/** Start downloading one catalog model on the Desktop. Desktop resolves its weights and companion files. */
export async function startOffGridDesktopDownload(server: RemoteServer, modelId: string): Promise<void> {
  const response = await gatewayFetch(server, '/v1/models/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: modelId }),
  });
  if (!response.ok) {
    throw gatewayError(server, response.status, 'Desktop could not start the download.', record(await response.json().catch(() => null)));
  }
}

/** Read how a Desktop download is going. */
export async function readOffGridDesktopDownload(server: RemoteServer, modelId: string): Promise<OffGridDesktopDownload> {
  const response = await gatewayFetch(server, `/v1/models/pull/status?id=${encodeURIComponent(modelId)}`);
  const body = record(await response.json().catch(() => null));
  if (!response.ok || !body) {
    throw gatewayError(server, response.status, 'Desktop did not say how the download is going.', body);
  }
  const status = typeof body.status === 'string' ? body.status : 'idle';
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  return {
    status: (['queued', 'downloading', 'completed', 'failed', 'cancelled'].includes(status)
      ? status
      : 'idle') as OffGridDesktopDownload['status'],
    percent: Math.max(0, Math.min(100, number(body.percent) ?? 0)),
    downloadedBytes: number(body.downloadedBytes),
    totalBytes: number(body.totalBytes),
    error: typeof body.error === 'string' ? body.error : undefined,
    installedId: typeof body.installedId === 'string' && body.installedId ? body.installedId : undefined,
  };
}
