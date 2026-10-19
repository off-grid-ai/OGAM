// The chat turn's view of documents on the phone: the project's knowledge base and every document
// attached in the conversation are rebuilt for this question by the shared turn service, within a
// budget set by the phone's context window and how fast this phone reads prompts. Returns the prompt
// blocks and the passages the answer may cite as [S#]. A knowledge-base search the model runs during
// the turn (search_knowledge_base) numbers its passages after the turn's own, so they cite the same way.

import {
  estimateTokens,
  type CitedSource,
  type DocumentScope,
  type DocumentSource,
  type DocumentTurnStatus,
  type FoundPassage,
} from '@offgrid/rag/documents';
import { useChatStore } from '../../stores/chatStore';
import type { DocumentCitation, MediaAttachment, Message } from '../../types';
import { attachmentSource } from './conversation';
import { documentTurns } from '.';
import { shownMessages } from '../../utils/chatThread';

/** Prompt-reading speed assumed for a phone until one is measured (tokens a second). */
const PHONE_PREFILL_TOKENS_PER_SECOND = 150;

const previousSources = new Map<string, string[]>();

/** The [S#] numbers a turn has handed out: its own passages, then any a tool search added. */
interface TurnCitations {
  numbers: Map<string, number>;
  sources: DocumentCitation[];
}

const turnCitations = new Map<string, TurnCitations>();

function citationKey(passage: { documentId: string; page: number; position: number }): string {
  return `${passage.documentId}:${passage.page}:${passage.position}`;
}

function citationNumber(id: string): number {
  return Number(id.replace(/^S/, ''));
}

function toCitation(source: CitedSource): DocumentCitation {
  return {
    id: source.id,
    documentId: source.documentId,
    name: source.name,
    page: source.page,
    ...(source.label ? { label: source.label } : {}),
    snippet: source.snippet,
  };
}

function freshCitations(key: string): TurnCitations {
  const citations: TurnCitations = { numbers: new Map(), sources: [] };
  turnCitations.set(key, citations);
  return citations;
}

/** Every passage this conversation's current turn may cite, in [S#] order, for the reply's links. */
export function turnSources(conversationId: string): DocumentCitation[] {
  return [...(turnCitations.get(conversationId)?.sources ?? [])];
}

export interface TurnDocuments {
  /** Goes after the system prompt; identical across turns while the documents do not change. */
  stable: string;
  /** Goes before this turn's question. */
  turn: string;
  sources: DocumentCitation[];
}

function measuredPrefill(messages: Message[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const rate = messages[i]!.generationMeta?.prefillTokensPerSecond;
    if (rate && Number.isFinite(rate) && rate > 0) return rate;
  }
  return undefined;
}

export async function prepareTurnDocuments(input: {
  conversationId: string;
  /** The conversation's project, so its knowledge base is read first. */
  projectId?: string;
  /** Documents attached to the message being sent (may not be in the store yet). */
  attachments?: MediaAttachment[];
  question: string;
  systemPrompt: string;
  contextLength: number;
  isRemote: boolean;
  /** < 1 on a retry after the prompt did not fit. */
  documentScale?: number;
  /**
   * The model can call search_knowledge_base this turn. Then the project's knowledge base is left
   * to it (when needed): a question that does not need the documents does not wait on them. A
   * model without that tool still gets the knowledge base in its prompt.
   */
  knowledgeSearch?: boolean;
  /** What the turn is doing with its documents, for the live status line. */
  onStatus?: (status: DocumentTurnStatus) => void;
}): Promise<TurnDocuments | null> {
  const citations = freshCitations(input.conversationId);
  const current: DocumentSource[] = [];
  for (const attachment of input.attachments ?? []) {
    const source = await attachmentSource(attachment);
    if (source) current.push(source);
  }
  const conversation = useChatStore.getState().conversations.find((c) => c.id === input.conversationId);
  const messages = shownMessages(conversation?.messages ?? []).filter((message) => !message.isSystemInfo);
  const ctx = input.contextLength;
  const result = await documentTurns.prepare({
    conversationId: input.conversationId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.onStatus ? { onStatus: input.onStatus } : {}),
    ...(input.knowledgeSearch ? { projectDocuments: 'when-needed' as const } : {}),
    current,
    question: input.question,
    previousQuestions: messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .slice(-3, -1),
    previousSources: previousSources.get(input.conversationId),
    budget: {
      ctx,
      replyReserve: Math.min(1024, Math.max(256, Math.floor(ctx * 0.1))),
      systemTokens: estimateTokens(input.systemPrompt),
      requiredToolTokens: 0,
      historyTokens: messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
      questionTokens: estimateTokens(input.question),
      prefillTokensPerSecond: measuredPrefill(messages) ?? PHONE_PREFILL_TOKENS_PER_SECOND,
      remote: input.isRemote,
      ...(input.documentScale ? { scale: input.documentScale } : {}),
    },
  });
  if (!result) return null;
  previousSources.set(input.conversationId, result.usedKeys);
  for (const source of result.sources) citations.numbers.set(citationKey(source), citationNumber(source.id));
  citations.sources = result.sources.map(toCitation);
  return { stable: result.stable, turn: result.turn, sources: [...citations.sources] };
}

/**
 * search_knowledge_base: the best passages across the chat's documents and its project's knowledge
 * base, as `<source>` blocks. A passage the turn already gave the model keeps its [S#]; a new one
 * gets the next number, and is added to the turn's sources so its citation opens the page.
 */
export async function searchDocumentsForTool(
  scope: DocumentScope,
  query: string,
  onStatus?: (status: DocumentTurnStatus) => void,
): Promise<string> {
  const key = scope.conversationId ?? `project:${scope.projectId ?? ''}`;
  const citations = turnCitations.get(key) ?? freshCitations(key);
  let next = Math.max(0, ...citations.numbers.values()) + 1;
  const assigned: string[] = [];
  const citationId = (passage: FoundPassage): number => {
    const passageKey = citationKey(passage);
    const known = citations.numbers.get(passageKey);
    if (known) return known;
    const number = next++;
    citations.numbers.set(passageKey, number);
    assigned.push(passageKey);
    return number;
  };
  try {
    const { text, sources } = await documentTurns.searchForTool(scope, query, citationId, {
      ...(onStatus ? { onStatus } : {}),
    });
    const cited = new Set(citations.sources.map((source) => source.id));
    const added = sources.filter((source) => !cited.has(source.id)).map(toCitation);
    citations.sources = [...citations.sources, ...added].sort(
      (a, b) => citationNumber(a.id) - citationNumber(b.id),
    );
    return text;
  } catch (error) {
    for (const passageKey of assigned) citations.numbers.delete(passageKey);
    throw error;
  }
}
