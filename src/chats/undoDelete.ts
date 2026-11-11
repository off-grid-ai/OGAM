/**
 * Deleting a chat takes effect at once, then waits a few seconds for an Undo. The chat's images are
 * only deleted when the wait is over, so Undo brings back everything. Undo also clears the deletion
 * record that sync would send to the other phone.
 */
import { useChatStore, useAppStore } from '../stores';
import { onnxImageGeneratorService } from '../services';
import { nearbySync } from '../services/nearbySync';
import type { Conversation } from '../types';

export const UNDO_MS = 8000;

interface Pending { conversation: Conversation; timer: ReturnType<typeof setTimeout> }
let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** The chat that can still be brought back, if any. */
export const undoableChat = (): Conversation | null => pending?.conversation ?? null;
export const subscribeUndo = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function removeImages(conversationId: string) {
  for (const id of useAppStore.getState().removeImagesByConversationId(conversationId))
    onnxImageGeneratorService.deleteGeneratedImage(id).catch(() => {});
}

/** Ends the wait for the chat now: its images go for good. */
function finish() {
  if (!pending) return;
  clearTimeout(pending.timer);
  const { conversation } = pending;
  pending = null;
  removeImages(conversation.id);
  emit();
}

export function deleteChatWithUndo(conversationId: string): void {
  const conversation = useChatStore.getState().conversations.find((c) => c.id === conversationId);
  // Locked and private chats are not kept in memory for an Undo: they go for good.
  if (!conversation || conversation.pinVerifier || conversation.isPrivate) {
    removeImages(conversationId);
    useChatStore.getState().deleteConversation(conversationId);
    return;
  }
  finish();
  useChatStore.getState().deleteConversation(conversationId);
  pending = { conversation, timer: setTimeout(finish, UNDO_MS) };
  emit();
}

export function undoDeleteChat(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  const { conversation } = pending;
  pending = null;
  useChatStore.getState().restoreConversation(conversation);
  nearbySync.forgetDeletion('conversations', conversation.id);
  emit();
}
