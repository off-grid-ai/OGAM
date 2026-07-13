import logger from '../utils/logger';

type Listener = () => void;

/**
 * GenerationSession — the SINGLE owner of "which conversation is currently
 * generating an assistant turn".
 *
 * This used to be a mutable ref (`generatingForConversationRef`) written from 6+
 * scattered places across start / stop / regenerate / error paths — a classic
 * multi-writer desync hazard (the audit's #1 finding): two paths colliding left the
 * flag pointing at the wrong conversation or stuck non-null. Now there is ONE owner.
 * Callers dispatch begin()/end() intents; the View OBSERVES the projection (via
 * useGenerationSession) and never writes it. Every transition is [GEN-SM]-logged so a
 * stuck or concurrent generation is visible in the device trace.
 *
 * This is slice 1 of the GenerationSession refactor — it owns the session identity.
 * Later slices fold classify→route and uniform outcome/error surfacing onto it.
 */
class GenerationSessionService {
  private conversationId: string | null = null;
  private readonly listeners = new Set<Listener>();

  /** The conversation a turn is currently generating for, or null. */
  getConversationId(): string | null {
    return this.conversationId;
  }

  /** Whether a turn is currently generating for the given conversation. */
  isGeneratingFor(conversationId: string | null | undefined): boolean {
    return this.conversationId != null && this.conversationId === conversationId;
  }

  /** Mark a turn as generating for a conversation. Idempotent for the same id. */
  begin(conversationId: string): void {
    if (this.conversationId === conversationId) return;
    logger.log(`[GEN-SM] session begin conv=${conversationId} (was ${this.conversationId ?? 'none'})`);
    this.conversationId = conversationId;
    this.notify();
  }

  /** Clear the generating session (turn finished / failed / aborted / switched). */
  end(reason = 'done'): void {
    if (this.conversationId == null) return;
    logger.log(`[GEN-SM] session end conv=${this.conversationId} reason=${reason}`);
    this.conversationId = null;
    this.notify();
  }

  /** Subscribe to session changes (for the View projection). Returns unsubscribe. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** Test helper. */
  _reset(): void {
    this.conversationId = null;
    this.listeners.clear();
  }
}

export const generationSession = new GenerationSessionService();
