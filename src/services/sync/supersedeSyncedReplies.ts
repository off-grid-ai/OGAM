import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { useRemoteChatStreamStore } from '../../stores/remoteChatStreamStore';
import logger from '../../utils/logger';
import { CORE_SYNC_ENTITIES } from '@offgrid/application';
import {
  deleteSyncMutation,
  emitSyncMutation,
} from './mutation';

/**
 * Replace any reply that is still represented by a remote live preview.
 *
 * The preview's message id is also its durable record id. Tombstoning that id before discarding the
 * preview keeps an in-flight put from restoring the old reply after the replacement has started.
 */
export function supersedeSyncedReplies(conversationId: string): void {
  const previews = useRemoteChatStreamStore
    .getState()
    .previews.filter(preview => preview.conversationId === conversationId);
  if (previews.length === 0) return;

  for (const preview of previews) {
    emitSyncMutation(
      deleteSyncMutation(CORE_SYNC_ENTITIES.message, preview.messageId),
    );
  }
  callHook(HOOKS.chatStreamDiscardConversation, conversationId);
  logger.log(
    `[RESEND-SM] superseded ${previews.length} synced preview(s) conv=${conversationId}`,
  );
}
