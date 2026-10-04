import { useSyncExternalStore } from 'react';
import { WorkspaceContentChatSessionAdapterError } from '@offgrid/application';
import type {
  ModelsSnapshot,
  RagSnapshot,
  SpeechSnapshot,
  SyncSnapshot,
  MessageRecord,
  WorkspaceContentSnapshot,
} from '@offgrid/application';
import type { AppSettings } from '../stores/appStore';
import { applicationFacade } from '../services/applicationFacade';
import { resolvedCommittedImageSettings } from '../services/modelServices/imageGenerationApplication';

export type MobileModelsSnapshot = Omit<ModelsSnapshot, 'settings'> & {
  readonly settings: Readonly<AppSettings>;
};

/** Structurally shared, read-only Models projection from the application root. */
export function useModelsProjection(): MobileModelsSnapshot {
  const models = applicationFacade().models;
  return useSyncExternalStore(
    models.subscribe,
    models.snapshot,
    models.snapshot,
  ) as MobileModelsSnapshot;
}

/** Reactive committed image execution settings, resolved by the Mobile image application adapter. */
export function useResolvedImageGenerationSettings() {
  return resolvedCommittedImageSettings(useModelsProjection().settings);
}

/** Structurally shared, read-only RAG projection from the application root. */
export function useRagProjection(): RagSnapshot {
  const rag = applicationFacade().rag;
  return useSyncExternalStore(rag.subscribe, rag.snapshot, rag.snapshot);
}

/** Structurally shared, read-only Speech projection from the application root. */
export function useSpeechProjection(): SpeechSnapshot {
  const speech = applicationFacade().speech;
  return useSyncExternalStore(
    speech.subscribe,
    speech.snapshot,
    speech.snapshot,
  );
}

/** Structurally shared, read-only Sync projection from the application root. */
export function useSyncProjection(): SyncSnapshot {
  const sync = applicationFacade().sync;
  return useSyncExternalStore(sync.subscribe, sync.snapshot, sync.snapshot);
}

/**
 * Structurally shared, read-only workspace-content (projects/conversations/messages/chat turns)
 * projection from the application root.
 *
 * READ-ONLY on purpose: this hook exposes the Shared `WorkspaceContentFacade` snapshot only. No
 * screen, store, or writer is switched to it by this hook - that cutover is a separate, later step.
 */
export function useWorkspaceContentProjection(): WorkspaceContentSnapshot {
  const workspaceContent = applicationFacade().workspaceContent;
  return useSyncExternalStore(
    workspaceContent.subscribe,
    workspaceContent.snapshot,
    workspaceContent.snapshot,
  );
}

/** Resolve ordered durable messages only when the Workspace Content owner is ready. */
export function requireWorkspaceConversationMessages(
  conversationId: string,
): readonly MessageRecord[] {
  const snapshot = applicationFacade().workspaceContent.snapshot();
  if (snapshot.status !== 'ready') {
    throw new WorkspaceContentChatSessionAdapterError('read', {
      kind: 'not_ready',
      message: 'Workspace content is not ready.',
    });
  }
  if (
    !snapshot.conversations.some(
      conversation => conversation.id === conversationId,
    )
  ) {
    throw new WorkspaceContentChatSessionAdapterError('read', {
      kind: 'not_found',
      entity: 'conversation',
      id: conversationId,
      message: `Conversation ${conversationId} was not found.`,
    });
  }
  return snapshot.messages.filter(
    message => message.conversationId === conversationId,
  );
}
