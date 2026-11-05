import { useEffect, useState } from 'react';
import type { Conversation } from '../../types';
import { useChatStore } from '../../stores/chatStore';
import { ragDatabase } from '../rag/database';

/** The tool that searches a chat's documents and its project's knowledge base. */
export const KNOWLEDGE_SEARCH_TOOL = 'search_knowledge_base';

function chatHasDocument(conversation: Conversation | undefined): boolean {
  return !!conversation?.messages.some(message =>
    message.attachments?.some(attachment => attachment.type === 'document' && !!attachment.documentId),
  );
}

/**
 * Whether search_knowledge_base has anything to search in this chat: a document attached in it, or
 * an enabled file in its project's knowledge base. With nothing to search the tool is not offered,
 * so a new chat's question is answered, not met with "I found no passages".
 */
export async function hasSearchableKnowledge(conversationId: string): Promise<boolean> {
  const conversation = useChatStore.getState().conversations.find(c => c.id === conversationId);
  if (chatHasDocument(conversation)) return true;
  if (!conversation?.projectId) return false;
  await ragDatabase.ensureReady();
  return ragDatabase.getEnabledDocumentsByProject(conversation.projectId).length > 0;
}

/**
 * The tools a turn offers: the ones the person turned on, minus knowledge search when there is
 * nothing to search. The quick-settings count reads the same rule, so the count shown and the tools
 * sent stay one number.
 */
export function toolsForTurn(enabledTools: readonly string[], searchable: boolean): string[] {
  return searchable ? [...enabledTools] : enabledTools.filter(id => id !== KNOWLEDGE_SEARCH_TOOL);
}

/** The same answer for a screen: false until the chat or its project is known to hold a document. */
export function useHasSearchableKnowledge(conversation: Conversation | null | undefined): boolean {
  const attached = chatHasDocument(conversation ?? undefined);
  const id = conversation?.id;
  const projectId = conversation?.projectId;
  const [inProject, setInProject] = useState(false);
  useEffect(() => {
    let current = true;
    if (!id || !projectId) {
      setInProject(false);
      return;
    }
    hasSearchableKnowledge(id).then(result => {
      if (current) setInProject(result);
    }, () => undefined);
    return () => {
      current = false;
    };
  }, [id, projectId]);
  return attached || inProject;
}
