import { VIDEO_SETTING_KEYS, acceptsVideoSetting } from '@offgrid/models';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  KNOWLEDGE_DOCUMENT_ENTITY,
  SHARED_FILE_ENTITY,
  TASK_LAUNCH_ENTITY,
  TASK_CONTROL_ENTITY,
  TASK_RUN_ENTITY,
  createKnowledgeDocumentStateFields,
  createSharedFileStateFields,
  isRuntimeOnlyMessage,
  type SharedFileDescriptor,
} from '@offgrid/sync';
import type { Conversation, Message, Project } from '../../types';
import type { KnowledgeDocumentSnapshot } from './knowledgeDocument';
import { serializeMessageContext } from './messageContext';

/** Stable wire entity names shared with Off Grid Desktop. */
export const CORE_SYNC_ENTITIES = {
  // Dependency order is wire order: parents must materialize before children.
  project: 'project',
  conversation: 'conversation',
  message: 'message',
  knowledgeDocument: KNOWLEDGE_DOCUMENT_ENTITY,
  sharedFile: SHARED_FILE_ENTITY,
  modelSetting: 'model_setting',
  taskLaunch: TASK_LAUNCH_ENTITY,
  taskRun: TASK_RUN_ENTITY,
  taskControl: TASK_CONTROL_ENTITY,
} as const;

export type CoreSyncEntity =
  (typeof CORE_SYNC_ENTITIES)[keyof typeof CORE_SYNC_ENTITIES];

export interface SyncMutation {
  entity: CoreSyncEntity;
  entityId: string;
  kind: 'put' | 'delete';
  fields?: Record<string, unknown>;
}

interface ModelSettingDescriptor {
  localKey: string;
  accepts: (value: unknown) => boolean;
}

const finiteInRange =
  (minimum: number, maximum: number) =>
  (value: unknown): boolean =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum;

const integerInRange =
  (minimum: number, maximum: number) =>
  (value: unknown): boolean =>
    Number.isInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum;

/** Desktop wire keys mapped once to the equivalent mobile setting owner keys. */
const MODEL_SETTING_DESCRIPTORS: Readonly<
  Record<string, ModelSettingDescriptor>
> = {
  ...Object.fromEntries(
    VIDEO_SETTING_KEYS.map(key => [
      key,
      {
        localKey: key,
        accepts: (value: unknown) => acceptsVideoSetting(key, value),
      },
    ]),
  ),
  temperature: { localKey: 'temperature', accepts: finiteInRange(0, 2) },
  ctxSize: {
    localKey: 'contextLength',
    accepts: integerInRange(512, 1_048_576),
  },
  topP: { localKey: 'topP', accepts: finiteInRange(0, 1) },
  repeatPenalty: {
    localKey: 'repeatPenalty',
    accepts: finiteInRange(0, 2),
  },
  maxTokens: { localKey: 'maxTokens', accepts: integerInRange(1, 1_048_576) },
  maxToolCalls: {
    localKey: 'maxToolCalls',
    accepts: integerInRange(1, 100),
  },
  systemPrompt: {
    localKey: 'systemPrompt',
    accepts: value => typeof value === 'string',
  },
  kvCacheType: {
    localKey: 'cacheType',
    accepts: value => value === 'f16' || value === 'q8_0' || value === 'q4_0',
  },
  flashAttn: {
    localKey: 'flashAttn',
    accepts: value => typeof value === 'boolean',
  },
  gpuLayers: { localKey: 'gpuLayers', accepts: integerInRange(-1, 999) },
  threads: { localKey: 'nThreads', accepts: integerInRange(0, 256) },
  batchSize: { localKey: 'nBatch', accepts: integerInRange(1, 65_536) },
  // Portable generation behaviour: these mean the same thing on every device, so a preference set
  // on one is a preference everywhere. Hardware choices deliberately do NOT appear here — see below.
  thinkingEnabled: {
    localKey: 'thinkingEnabled',
    accepts: value => typeof value === 'boolean',
  },
  imageSteps: { localKey: 'imageSteps', accepts: integerInRange(1, 200) },
  imageGuidanceScale: {
    localKey: 'imageGuidanceScale',
    accepts: finiteInRange(0, 30),
  },
  imageWidth: { localKey: 'imageWidth', accepts: integerInRange(64, 4096) },
  imageHeight: { localKey: 'imageHeight', accepts: integerInRange(64, 4096) },
  enhanceImagePrompts: {
    localKey: 'enhanceImagePrompts',
    accepts: value => typeof value === 'boolean',
  },
  imageGenerationMode: {
    localKey: 'imageGenerationMode',
    accepts: value => value === 'auto' || value === 'manual',
  },
  autoDetectMethod: {
    localKey: 'autoDetectMethod',
    accepts: value => value === 'pattern' || value === 'llm',
  },
};

/**
 * DELIBERATELY NOT SYNCED — settings that describe the DEVICE, not the user's intent:
 *
 * - `inferenceBackend` / `liteRTBackend`: NPU on a Snapdragon phone is meaningless on an iPhone,
 *   and pushing one device's accelerator to another selects a backend it cannot run.
 * - `imageThreads` / `imageUseOpenCL`: same reason, for the image engine.
 * - `speculativeDecoding`: whether MTP helps depends on the model FILE present on each device, and
 *   the engine gate already decides that per load.
 *
 * `threads` and `gpuLayers` are in the map above and arguably belong in this list too — a count
 * tuned for a desktop's cores is wrong for a phone's performance cluster. They sync today; changing
 * that is a behaviour change for existing meshes, so it is called out rather than done quietly.
 */

export function modelSettingMutations(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): SyncMutation[] {
  const mutations: SyncMutation[] = [];
  for (const [wireKey, descriptor] of Object.entries(
    MODEL_SETTING_DESCRIPTORS,
  )) {
    const value = after[descriptor.localKey];
    if (
      value === undefined ||
      Object.is(value, before[descriptor.localKey]) ||
      !descriptor.accepts(value)
    )
      continue;
    mutations.push({
      entity: CORE_SYNC_ENTITIES.modelSetting,
      entityId: wireKey,
      kind: 'put',
      fields: { value_json: JSON.stringify(value) },
    });
  }
  return mutations;
}

export function mobileModelSettingPatch(
  wireKey: string,
  fields: Record<string, unknown>,
): Record<string, unknown> | null {
  const descriptor = MODEL_SETTING_DESCRIPTORS[wireKey];
  if (!descriptor || typeof fields.value_json !== 'string') return null;
  try {
    const value = JSON.parse(fields.value_json) as unknown;
    return descriptor.accepts(value) ? { [descriptor.localKey]: value } : null;
  } catch {
    return null;
  }
}

export function conversationPutMutation(
  conversation: Conversation,
): SyncMutation {
  return {
    entity: CORE_SYNC_ENTITIES.conversation,
    entityId: conversation.id,
    kind: 'put',
    fields: {
      title: conversation.title,
      project_id: conversation.projectId ?? null,
      created_at: conversation.createdAt,
      updated_at: conversation.updatedAt,
    },
  };
}

export function messagePutMutation(
  conversationId: string,
  message: Message,
): SyncMutation | null {
  if (
    !message.uuid ||
    // A thinking row is live UI state, not a completed chat turn. Image prompt enhancement creates
    // one with "Enhancing your prompt..." and later either replaces it with the labelled,
    // supporting-context message or deletes it. Publishing this intermediate row made peers render
    // it as a normal assistant answer, complete with reply actions, until the later mutation arrived.
    message.isThinking === true ||
    isRuntimeOnlyMessage({
      role: message.role,
      content: message.content,
      notice: message.isSystemInfo,
    })
  ) {
    return null;
  }
  return {
    entity: CORE_SYNC_ENTITIES.message,
    entityId: message.uuid,
    kind: 'put',
    fields: {
      conversation_id: conversationId,
      role: message.role,
      content: message.content,
      context: serializeMessageContext(message),
      created_at: new Date(message.timestamp).toISOString(),
    },
  };
}

export function projectPutMutation(project: Project): SyncMutation {
  return {
    entity: CORE_SYNC_ENTITIES.project,
    entityId: project.id,
    kind: 'put',
    fields: {
      name: project.name,
      description: project.description,
      system_prompt: project.systemPrompt,
      icon: project.icon ?? null,
      include_memory: 1,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    },
  };
}

export function knowledgeDocumentPutMutation(
  document: KnowledgeDocumentSnapshot,
): SyncMutation {
  return {
    entity: CORE_SYNC_ENTITIES.knowledgeDocument,
    entityId: document.syncId,
    kind: 'put',
    fields: { ...createKnowledgeDocumentStateFields(document) },
  };
}

export function sharedFilePutMutation(
  file: SharedFileDescriptor,
): SyncMutation {
  return {
    entity: CORE_SYNC_ENTITIES.sharedFile,
    entityId: file.syncId,
    kind: 'put',
    fields: { ...createSharedFileStateFields(file) },
  };
}

export function deleteSyncMutation(
  entity: CoreSyncEntity,
  entityId: string,
): SyncMutation {
  return { entity, entityId, kind: 'delete' };
}

/** Core commits first; Pro optionally records the resulting canonical mutation. */
export function emitSyncMutation(mutation: SyncMutation | null): void {
  if (!mutation) return;
  try {
    callHook(HOOKS.syncRecordLocalMutation, mutation);
  } catch {
    // Sync is additive. A Pro integration failure must not roll back local data.
  }
}

export function emitChangedModelSettings(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  for (const mutation of modelSettingMutations(before, after)) {
    emitSyncMutation(mutation);
  }
}
