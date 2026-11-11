/** Starting a practice chat with the language tutor (the chats live under the built-in Learn a language project). */
import { useChatStore } from '../stores';
import { LANGUAGE_PROJECT_ID } from './tutor';

/** A new tutor chat, or the reason it cannot start (no model downloaded). */
export function startTutorChat(modelId: string | null | undefined): { conversationId: string } | { error: string } {
  if (!modelId) return { error: 'Download a text model first (Models tab), then you can chat with your tutor.' };
  return { conversationId: useChatStore.getState().createConversation(modelId, undefined, LANGUAGE_PROJECT_ID) };
}
