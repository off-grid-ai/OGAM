import { useSyncExternalStore } from 'react';
import { generationSession } from '../services/generationSession';

/**
 * Reactive View projection of the GenerationSession owner — returns the conversation
 * id a turn is currently generating for (or null), re-rendering when it changes. The
 * View observes this; it never writes the session (callers dispatch begin()/end()).
 */
export function useGeneratingConversationId(): string | null {
  return useSyncExternalStore(
    (cb) => generationSession.subscribe(cb),
    () => generationSession.getConversationId(),
  );
}
