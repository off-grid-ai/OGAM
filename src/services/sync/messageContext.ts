import {
  projectSyncedMessageTurn,
  serializeSyncedMessageContext,
  type SyncedRetrievalSource,
  type SyncedToolArtifact,
  type SyncedMessageTurnInput,
  type SyncedMessageTurnProjection,
} from '@offgrid/sync';
import type { Message } from '../../types';

const RETRIEVAL_TOOL_ARTIFACT_ID = 'offgrid:retrieval-sources';

/** Feed durable retrieval evidence into the existing tool-result accordion. */
export function retrievalToolArtifact(
  sources?: readonly SyncedRetrievalSource[],
): SyncedToolArtifact | undefined {
  if (!sources?.length) return undefined;
  const count = sources.length;
  return {
    id: RETRIEVAL_TOOL_ARTIFACT_ID,
    name: `Searched your memory — ${count} result${count === 1 ? '' : 's'}`,
    result: sources
      .map(source => `${source.name} — ${Math.round(source.score * 100)}%`)
      .join('\n\n'),
    status: 'completed',
  };
}

/** Serialize only the shared, peer-safe part of a persisted message context. */
export function serializeMessageContext(
  message: Pick<
    Message,
    | 'role'
    | 'reasoningContent'
    | 'timeline'
    | 'toolCalls'
    | 'toolArtifacts'
    | 'toolCallId'
    | 'toolName'
    | 'generationTimeMs'
    | 'generationMeta'
    | 'isSystemInfo'
    | 'turnStatus'
  >,
): string | null {
  return serializeSyncedMessageContext({
    reasoning: message.reasoningContent,
    timeline: message.timeline,
    // "Model loaded: …" is the app talking, not the model. Only the device that wrote it knows
    // that, so it travels: without it the peer sees a plain assistant turn and draws a bubble,
    // and the same conversation reads differently on each device.
    notice: message.isSystemInfo,
    // Which tools this turn was GIVEN, not just the ones it called: a reply that had three tools and
    // used none is a different fact, and it is only known on the device that generated it.
    toolsOffered: message.generationMeta?.routedToolNames,
    metrics:
      message.role === 'assistant'
        ? {
            modelName: message.generationMeta?.modelName,
            totalSeconds:
              message.generationTimeMs === undefined
                ? undefined
                : message.generationTimeMs / 1000,
            timeToFirstTokenSeconds: message.generationMeta?.timeToFirstToken,
            decodeTokensPerSecond:
              message.generationMeta?.decodeTokensPerSecond ??
              message.generationMeta?.tokensPerSecond,
            prefillTokensPerSecond:
              message.generationMeta?.prefillTokensPerSecond,
            completionTokens: message.generationMeta?.tokenCount,
            contextWindowTokens: message.generationMeta?.contextWindowTokens,
            ...(message.generationMeta?.contextEstimate === false
              ? { promptTokens: message.generationMeta.contextPromptTokens }
              : {
                  estimatedPromptTokens:
                    message.generationMeta?.contextPromptTokens,
                }),
          }
        : undefined,
    toolCalls: [
      ...(message.toolCalls ?? []).map(call => ({
        ...call,
        result: '',
        status: 'running' as const,
      })),
      ...(message.toolArtifacts?.filter(
        artifact => artifact.id !== RETRIEVAL_TOOL_ARTIFACT_ID,
      ) ?? []),
    ],
    ...(message.role === 'tool'
      ? {
          tool: {
            callId: message.toolCallId,
            name: message.toolName,
            status: 'completed',
            durationMs: message.generationTimeMs,
          },
        }
      : {}),
    ...(message.generationTimeMs !== undefined
      ? { durationMs: message.generationTimeMs }
      : {}),
    status: message.turnStatus ?? 'completed',
  });
}

/** Admit peer-controlled context through the shared cross-host contract. */
/** Project a peer-controlled row into the one cross-host message-turn model. */
export function projectMessageTurn(
  input: SyncedMessageTurnInput,
): SyncedMessageTurnProjection | null {
  // Older desktop turns can carry text and media references as content parts. The shared-file
  // materializer attaches the media once the message exists; keep its text in the chat projection.
  const content = Array.isArray(input.content)
    ? input.content
        .filter(
          (part): part is { type: 'text'; text: string } =>
            typeof part === 'object' &&
            part !== null &&
            part.type === 'text' &&
            typeof part.text === 'string',
        )
        .map(part => part.text)
        .join('\n')
    : input.content;
  return projectSyncedMessageTurn({ ...input, content });
}
