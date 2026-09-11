import { remoteDiscoveryEndpoints, selectedRemoteOptionName } from '@offgrid/models';
import type {
  RemoteMediaModelIds,
  RemoteModel,
  RemoteModelCatalog,
  RemoteModelOption,
  RemoteServer,
  ServerTestResult,
} from '../../types';

export type RemoteServerEditorFailure =
  | { kind: 'credential-read'; message: string }
  | { kind: 'discovery'; message: string }
  | { kind: 'post-save-probe'; message: string };

export class RemoteServerEditorOperationError extends Error {
  constructor(readonly failure: RemoteServerEditorFailure) {
    super(failure.message);
    this.name = 'RemoteServerEditorOperationError';
  }
}

export interface RemoteServerEditorModelIds {
  text?: string;
  image?: string;
  transcription?: string;
  voice?: string;
}

export type RemoteServerEditorModelNames = Record<
  keyof RemoteServerEditorModelIds,
  string | null
>;

export interface RemoteServerConnectionProjection {
  result: { success: boolean; message: string };
  failure: RemoteServerEditorFailure | null;
  models: RemoteModel[];
  catalog: RemoteModelCatalog;
  modelManagement?: 'offgrid-desktop-v1';
  confirmedSelections: RemoteMediaModelIds;
  modelIds: RemoteServerEditorModelIds;
  modelNames: RemoteServerEditorModelNames;
}

export interface RemoteServerEditorDraft {
  server?: RemoteServer;
  name: string;
  endpoint: string;
  apiKey: string;
  notes: string;
  modelIds: RemoteServerEditorModelIds;
  catalog: RemoteModelCatalog;
  modelManagement?: 'offgrid-desktop-v1';
  confirmedSelections: RemoteMediaModelIds;
  discoveredModels: RemoteModel[];
}

interface ExistingRemoteServerProjection {
  credential: string;
  connection: RemoteServerConnectionProjection;
}

export interface CandidateTestInput {
  endpoint: string;
  apiKey: string;
  current: RemoteServerEditorModelIds;
  includeTriedEndpoint?: boolean;
}

interface ManagedSelectionInput {
  serverId: string;
  next: RemoteMediaModelIds;
  current: RemoteMediaModelIds;
  desktopManaged: boolean;
}

export interface RemoteServerEditorPorts {
  credentials: { read(serverId: string): Promise<string | null> };
  servers: {
    add(input: Omit<RemoteServer, 'id' | 'createdAt'> & { apiKey?: string }): Promise<RemoteServer>;
    update(id: string, input: Partial<Omit<RemoteServer, 'id' | 'createdAt'>>): Promise<void>;
    testCandidate(endpoint: string, apiKey?: string): Promise<ServerTestResult>;
    testSaved(serverId: string): Promise<ServerTestResult>;
  };
  models: {
    project(serverId: string, models: RemoteModel[]): void;
    select(serverId: string, modality: keyof RemoteServerEditorModelIds, modelId: string): Promise<void>;
  };
  activeServerId(): string | null;
}

function selectedModelIds(result: ServerTestResult): RemoteServerEditorModelIds {
  return {
    text: result.selections?.text ?? result.models?.[0]?.id ?? '',
    image: result.selections?.image ?? '',
    transcription: result.selections?.transcription ?? '',
    voice: result.selections?.voice ?? '',
  };
}

function mergeDiscoveredModelIds(
  current: RemoteServerEditorModelIds,
  result: ServerTestResult,
): RemoteServerEditorModelIds {
  const discovered = selectedModelIds(result);
  if (result.modelManagement === 'offgrid-desktop-v1') return discovered;
  return {
    text: current.text || discovered.text || '',
    image: current.image || discovered.image || '',
    transcription: current.transcription || discovered.transcription || '',
    voice: current.voice || discovered.voice || '',
  };
}

function textModelOptions(
  models: readonly RemoteModel[],
  catalog: RemoteModelCatalog,
): RemoteModelOption[] {
  return [
    ...(catalog.text ?? []),
    ...models.map(model => ({ id: model.id, name: model.name })),
  ];
}

function projectModelNames(
  modelIds: RemoteServerEditorModelIds,
  models: readonly RemoteModel[],
  catalog: RemoteModelCatalog,
): RemoteServerEditorModelNames {
  // Shared resolves a persisted or transported id (route, legacy, or native) to its option name.
  const selectedName = (
    selectedId: string | undefined,
    options: RemoteModelOption[],
  ): string | null => (selectedId ? selectedRemoteOptionName(selectedId, options) : null);
  return {
    text: selectedName(modelIds.text, textModelOptions(models, catalog)),
    image: selectedName(modelIds.image, catalog.image ?? []),
    transcription: selectedName(modelIds.transcription, catalog.transcription ?? []),
    voice: selectedName(modelIds.voice, catalog.voice ?? []),
  };
}

function connectionProjection(
  result: ServerTestResult,
  current: RemoteServerEditorModelIds,
  triedEndpoint?: string,
): RemoteServerConnectionProjection {
  if (!result.success) {
    const message = result.error || 'Connection failed';
    return {
      result: {
        success: false,
        message: triedEndpoint ? `${message}\nTried: ${triedEndpoint}` : message,
      },
      failure: { kind: 'discovery', message },
      models: [],
      catalog: {},
      modelManagement: undefined,
      confirmedSelections: {},
      modelIds: current,
      modelNames: projectModelNames(current, [], {}),
    };
  }
  const models = result.models ?? [];
  const catalog = result.catalog ?? {};
  const modelIds = mergeDiscoveredModelIds(current, result);
  const modelCount =
    (result.models?.length ?? 0) +
    Object.values(result.catalog ?? {}).reduce(
      (count, options) => count + (options?.length ?? 0),
      0,
    );
  return {
    result: {
      success: true,
      message: `Connected (${result.latency}ms)${
        modelCount > 0
          ? `\n${modelCount} model${modelCount === 1 ? '' : 's'} available`
          : ''
      }`,
    },
    failure: null,
    models,
    catalog,
    modelManagement: result.modelManagement,
    confirmedSelections: result.selections ?? {},
    modelIds,
    modelNames: projectModelNames(modelIds, models, catalog),
  };
}

function compactSelections(ids: RemoteServerEditorModelIds): RemoteMediaModelIds {
  return {
    ...(ids.text?.trim() ? { text: ids.text.trim() } : {}),
    ...(ids.image?.trim() ? { image: ids.image.trim() } : {}),
    ...(ids.transcription?.trim()
      ? { transcription: ids.transcription.trim() }
      : {}),
    ...(ids.voice?.trim() ? { voice: ids.voice.trim() } : {}),
  };
}

/** Owns the complete editor transaction. React supplies and renders state only. */
export class RemoteServerEditorApplicationService {
  constructor(private readonly ports: RemoteServerEditorPorts) {}

  validate(input: Pick<RemoteServerEditorDraft, 'name' | 'endpoint'>): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!input.name.trim()) errors.name = 'Server name is required';
    if (!input.endpoint.trim()) {
      errors.endpoint = 'Endpoint URL is required';
    } else {
      try {
        new URL(input.endpoint); // eslint-disable-line no-new
      } catch {
        errors.endpoint = 'Invalid URL format';
      }
    }
    return errors;
  }

  projectModelNames(
    modelIds: RemoteServerEditorModelIds,
    models: readonly RemoteModel[],
    catalog: RemoteModelCatalog,
  ): RemoteServerEditorModelNames {
    return projectModelNames(modelIds, models, catalog);
  }

  async loadExisting(
    server: RemoteServer,
    current: RemoteServerEditorModelIds,
  ): Promise<ExistingRemoteServerProjection> {
    let credential: string | null;
    try {
      credential = await this.ports.credentials.read(server.id);
    } catch {
      throw new RemoteServerEditorOperationError({
        kind: 'credential-read',
        message: 'Could not read the API key from Keychain.',
      });
    }
    return {
      credential: credential ?? '',
      connection: await this.test({
        endpoint: server.endpoint,
        apiKey: credential ?? '',
        current,
        includeTriedEndpoint: false,
      }),
    };
  }

  async test(input: CandidateTestInput): Promise<RemoteServerConnectionProjection> {
    const { endpoint, apiKey, current, includeTriedEndpoint = true } = input;
    try {
      const result = await this.ports.servers.testCandidate(
        endpoint,
        apiKey || undefined,
      );
      return connectionProjection(
        result,
        current,
        includeTriedEndpoint && !result.success
          ? remoteDiscoveryEndpoints(endpoint)[0].url
          : undefined,
      );
    } catch (error) {
      return connectionProjection(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        current,
      );
    }
  }

  async save(draft: RemoteServerEditorDraft): Promise<RemoteServer> {
    const selections = compactSelections(draft.modelIds);
    const desktopManaged = draft.modelManagement === 'offgrid-desktop-v1';
    let saved: RemoteServer;
    if (draft.server) {
      await this.ports.servers.update(draft.server.id, {
        name: draft.name,
        endpoint: draft.endpoint,
        notes: draft.notes,
        apiKey: draft.apiKey,
        selections: desktopManaged ? draft.server.selections : selections,
        catalog: draft.catalog,
        modelManagement: draft.modelManagement,
      });
      saved = draft.server;
    } else {
      saved = await this.ports.servers.add({
        name: draft.name,
        endpoint: draft.endpoint,
        provider: 'openai-compatible',
        notes: draft.notes || undefined,
        apiKey: draft.apiKey || undefined,
        selections: desktopManaged ? draft.confirmedSelections : selections,
        catalog: draft.catalog,
        modelManagement: draft.modelManagement,
      });
    }

    if (draft.discoveredModels.length > 0) {
      this.ports.models.project(
        saved.id,
        draft.discoveredModels.map(model => ({ ...model, serverId: saved.id })),
      );
    }
    await this.activateChangedSelections({
      serverId: saved.id,
      next: selections,
      current:
        draft.server?.selections ?? (desktopManaged ? draft.confirmedSelections : {}),
      desktopManaged,
    });
    if (
      draft.server &&
      !desktopManaged &&
      selections.text &&
      this.ports.activeServerId() === saved.id
    ) {
      await this.ports.models.select(saved.id, 'text', selections.text);
    }
    if (!draft.server) await this.requirePostSaveProbe(saved.id);
    return saved;
  }

  private async activateChangedSelections(input: ManagedSelectionInput): Promise<void> {
    const { serverId, next, current, desktopManaged } = input;
    if (!desktopManaged) return;
    for (const modality of ['text', 'image', 'transcription', 'voice'] as const) {
      const modelId = next[modality];
      if (modelId && modelId !== current[modality]) {
        await this.ports.models.select(serverId, modality, modelId);
      }
    }
  }

  private async requirePostSaveProbe(serverId: string): Promise<void> {
    const probe = await this.ports.servers.testSaved(serverId);
    if (probe.success) return;
    throw new RemoteServerEditorOperationError({
      kind: 'post-save-probe',
      message: `${
        probe.error || 'The server was saved, but its connection check failed.'
      } Check the address and try again.`,
    });
  }
}

export function createRemoteServerEditorApplication(
  ports: RemoteServerEditorPorts,
): RemoteServerEditorApplicationService {
  return new RemoteServerEditorApplicationService(ports);
}
