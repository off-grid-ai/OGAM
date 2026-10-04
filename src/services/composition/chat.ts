// Composition root: the shared chat session, its operation and context services, context
// compaction, intent classification, and prompt enhancement over Mobile's store and runtime ports.
import {
  ChatContextApplicationService,
  ChatOperationApplicationService,
  ChatSessionService,
  once,
} from '@offgrid/models';
import {
  createWorkspaceContentChatSessionRepository,
  type ModelsChatPlatformPort,
} from '@offgrid/application';
import {
  mobileChatContextPorts,
  mobileChatOperationCommand,
  mobileChatOperationPorts,
  mobileChatQueueSnapshot,
  mobileChatSessionPorts,
  resetMobileChatQueue,
  subscribeMobileChatQueue,
  subscribeMobileChatSessionEvents,
} from '../adapters/models/mobileChatHostPort';
import { contextCompaction, generationIntent } from './chat-services';
import { applicationFacade } from '../applicationFacade';
import { generateId } from '../../utils/generateId';

// Re-exported so the existing import paths keep resolving; the owner is `chat-services`.
;

// These two belong to ONE application root, like the session below. Kept for the whole process,
// they held the model list of the FIRST root: after a restart the phone had a live root with models
// and a chat still asking the dead one, so it answered that nothing could reply.
let chatOperationService: ChatOperationApplicationService | null = null;
let chatContextService: ChatContextApplicationService | null = null;

const chatOperation = (): ChatOperationApplicationService => {
  chatOperationService ??= new ChatOperationApplicationService(
    mobileChatOperationPorts(generationIntent()),
  );
  return chatOperationService;
};
const chatContext = (): ChatContextApplicationService => {
  chatContextService ??= new ChatContextApplicationService(mobileChatContextPorts());
  return chatContextService;
};
// Not a process-lifetime memo. Chat belongs to ONE application root: when that root is disposed
// its session is shut down and dropped, so the next root composes a fresh one and can never inherit
// a turn that is still writing from the session before it.
let chatRepository: ReturnType<typeof createWorkspaceContentChatSessionRepository> | null = null;
let chatSession: ChatSessionService | null = null;

export function getMobileChatRepository(): NonNullable<typeof chatRepository> {
  chatRepository ??= createWorkspaceContentChatSessionRepository({
    workspaceContent: applicationFacade().workspaceContent,
    newId: generateId,
    now: Date.now,
  });
  return chatRepository;
}

export function getMobileChatSession(): ChatSessionService {
  if (chatSession) return chatSession;
  const [generation, options] = mobileChatSessionPorts(
    {
      augment: ({ identity, signal }) => chatContext().compose({
        conversationId: identity.conversationId,
        projectId: identity.projectId,
        signal,
      }),
    },
    {
      resolve: input => chatOperation().resolve(
        mobileChatOperationCommand(input),
      ),
    },
    contextCompaction(),
  );
  chatSession = new ChatSessionService(generation, getMobileChatRepository(), options);
  return chatSession;
}

/**
 * End every accepted turn, then drop the session.
 *
 * The reference is dropped BEFORE the wait, so a startup that overlaps a shutdown composes a new
 * session instead of sending into the one being torn down.
 */
export async function shutdownMobileChatSession(reason?: unknown): Promise<void> {
  const session = chatSession;
  chatSession = null;
  chatRepository = null;
  // Dropped with the root that composed them, so the next root builds them over its own models.
  chatOperationService = null;
  chatContextService = null;
  await session?.shutdown(reason);
  // The queue projection is module state and outlives this root. Clearing it after the wait means
  // the last thing every reader saw is an empty queue, so the next root cannot read a reply from
  // the previous one as still going.
  resetMobileChatQueue();
}
export const modelsChatPort: ModelsChatPlatformPort = {
  snapshot: () => mobileChatQueueSnapshot(),
  subscribe: listener => subscribeMobileChatQueue(listener),
  events: listener => subscribeMobileChatSessionEvents(listener),
  send: command => getMobileChatSession().send(command),
  regenerate: command => getMobileChatSession().regenerate(command),
  edit: command => getMobileChatSession().edit(command),
  stop: (turnId, reason) => getMobileChatSession().stop(turnId, reason),
  stopConversation: (conversationId, reason) =>
    getMobileChatSession().stopConversation(conversationId, reason),
  restore: conversationId => getMobileChatSession().restoreConversation(conversationId),
  shutdown: reason => shutdownMobileChatSession(reason),
  // Workspace content has no per-conversation repository cache to invalidate.
  invalidate: () => undefined,
};
