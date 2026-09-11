import type {
  LocalMessageState,
  PortableMessageState,
} from '@offgrid/application';
import { applicationFacade } from './applicationFacade';

/**
 * The one append path for application-owned durable chat notices that sit outside a model turn.
 * Model responses and tool-loop rows are committed only by ChatSession.
 */
export async function appendWorkspaceContentMessage(input: {
  conversationId: string;
  messageId?: string;
  portable: PortableMessageState;
  local?: LocalMessageState;
}): Promise<void> {
  const outcome = await applicationFacade().workspaceContent.execute({
    type: 'append_message',
    conversationId: input.conversationId,
    ...(input.messageId ? { messageId: input.messageId } : {}),
    portable: input.portable,
    ...(input.local ? { local: input.local } : {}),
  });
  if (!outcome.ok) throw new Error(outcome.failure.message);
}
