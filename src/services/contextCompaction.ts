/** Consumer-facing handle on the composed context-compaction service. */
import type {
  ChatCompactionContext,
  CompactableGenerationMessage,
  ContextCompactionService,
  GenerationMessage,
} from '@offgrid/models';
import { contextCompaction } from './composition/chat-services';
import { mobileCompactionOptions } from './contextCompactionPorts';

const sharedCompaction = (): ContextCompactionService<CompactableGenerationMessage> => contextCompaction();

/** Compatibility facade. It contains ports only; Shared owns all workflow and state. */
export const contextCompactionService = {
  get isCompacting(): boolean { return sharedCompaction().isCompacting; },
  subscribeCompacting: (listener: (active: boolean) => void) => sharedCompaction().subscribe(listener),
  signalCompacting: (active: boolean) => sharedCompaction().setExternalCompacting(active),
  isContextFullError: (error: unknown) => sharedCompaction().isCapacityError(error),
  /** Compact the exact prompt that overflowed; the previous summary comes from the conversation. */
  compactChat: (context: ChatCompactionContext): Promise<GenerationMessage[]> =>
    sharedCompaction().compactChat(context, mobileCompactionOptions(context)),
  /** Resolves once the cleared compaction state is durable; callers must await it. */
  clearSummary: (conversationId: string): Promise<void> => sharedCompaction().clear(conversationId),
};
