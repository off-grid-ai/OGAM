/**
 * What a finished reply leaves behind.
 *
 * Pure, and separate from the store, because it answers a question the store only holds the inputs
 * for: given what streamed, is there a durable message to write - and therefore a record a paired
 * device should wait for? Stop the model mid-thought and the answer is no, which is the difference
 * between a peer retiring its preview and sitting on "Thinking..." until it expires.
 */
/**
 * How the reply that just ended finished, for whoever has to tell the other devices.
 *
 * A peer keeps a finished reply on screen until its durable record lands, which is right when a
 * record IS coming and wrong when it is not: stop the model while it is still thinking and the
 * empty stream is dropped, so nothing is ever stored and the peer sits on "Thinking..." until the
 * expiry window. Only the store knows which of the two happened, so it says.
 */
export interface ReplyEnd {
  conversationId: string;
  persisted: boolean;
}

/** What the live-stream service reads to describe this device's reply to its peers. */
export interface StreamingSnapshot {
  conversationId: string | null;
  /** The id this reply will be persisted under, so a peer can match it to the record. */
  messageId: string | null;
  content: string;
  reasoningContent: string;
  isStreaming: boolean;
  isThinking: boolean;
  isModelLoading: boolean;
  loadingModelName: string | null;
}
