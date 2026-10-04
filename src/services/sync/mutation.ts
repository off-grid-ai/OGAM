import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  createKnowledgeDocumentStateFields,
  createSharedFileStateFields,
  type SharedFileDescriptor,
  type CoreSyncEntity,
  type SyncMutation,
} from '@offgrid/sync';
import {
  decodeModelSettingPatch,
  encodeChangedModelSettings,
  type EncodedModelSetting,
} from '@offgrid/models';
import {
  CORE_SYNC_ENTITIES,
  type KnowledgeDocumentSnapshot,
} from '@offgrid/application';

// The committed-mutation contract (entity table in wire order, mutation shape) is shared with
// Off Grid Desktop through @offgrid/sync; this module keeps only the Mobile record builders.
export type { CoreSyncEntity, SyncMutation } from '@offgrid/sync';

function modelSettingMutation(setting: EncodedModelSetting): SyncMutation {
  return {
    entity: CORE_SYNC_ENTITIES.modelSetting,
    entityId: setting.wireKey,
    kind: 'put',
    fields: { version: setting.version, value_json: setting.valueJson },
  };
}

export function modelSettingMutations(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): SyncMutation[] {
  return encodeChangedModelSettings('mobile', before, after).map(modelSettingMutation);
}

export function mobileModelSettingPatch(
  wireKey: string,
  fields: Record<string, unknown>,
): Record<string, unknown> | null {
  return decodeModelSettingPatch('mobile', wireKey, fields);
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

/**
 * Publish the mutations a COMMITTED settings save planned. Shared decided which portable keys moved
 * and encoded them once, so nothing is re-diffed here - this is the publish half of the settings
 * command's port, not a store subscriber.
 */
export function emitCommittedModelSettings(
  mutations: readonly EncodedModelSetting[],
): void {
  for (const setting of mutations) emitSyncMutation(modelSettingMutation(setting));
}
