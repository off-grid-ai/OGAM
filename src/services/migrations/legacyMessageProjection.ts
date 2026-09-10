import type {
  ChatTurnRecord,
  LocalMessageContentLocation,
} from '@offgrid/application';
import {serializeSyncedMessageContext} from '@offgrid/sync';
import {storedRecord as record, type StoredRecord} from './legacyContentSource';

export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is not a non-empty string`);
  }
  return value;
}

export function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function portableToolArtifacts(
  message: StoredRecord,
  label: string,
): StoredRecord[] | undefined {
  const toolArtifacts = message.toolArtifacts;
  if (toolArtifacts !== undefined && !Array.isArray(toolArtifacts)) {
    throw new Error(`${label}.toolArtifacts is not an array`);
  }
  const artifacts = (toolArtifacts ?? []).map((value, index) => ({
    ...record(value, `${label}.toolArtifacts[${index}]`),
  }));
  const consumedArtifactIndexes = new Set<number>();
  if (message.toolCalls !== undefined) {
    if (!Array.isArray(message.toolCalls)) {
      throw new Error(`${label}.toolCalls is not an array`);
    }
    for (const [index, value] of message.toolCalls.entries()) {
      const call = record(value, `${label}.toolCalls[${index}]`);
      const id = optionalText(call.id);
      const name = text(call.name, `${label}.toolCalls[${index}].name`);
      if (typeof call.arguments !== 'string') {
        throw new Error(`${label}.toolCalls[${index}].arguments is not text`);
      }
      const matchingIndex = artifacts.findIndex(
        (artifact, artifactIndex) =>
          (id !== null || !consumedArtifactIndexes.has(artifactIndex)) &&
          (id === null
            ? artifact.name === name &&
              (artifact.arguments === undefined ||
                artifact.arguments === call.arguments)
            : artifact.id === id),
      );
      if (matchingIndex < 0) {
        artifacts.push({
          ...(id === null ? {} : {id}),
          name,
          arguments: call.arguments,
          result: '',
        });
        if (id === null) consumedArtifactIndexes.add(artifacts.length - 1);
        continue;
      }
      const matchingArtifact = artifacts[matchingIndex];
      if (id === null) consumedArtifactIndexes.add(matchingIndex);
      if (
        matchingArtifact.name !== name ||
        (matchingArtifact.arguments !== undefined &&
          matchingArtifact.arguments !== call.arguments)
      ) {
        throw new Error(
          `${label}.toolCalls[${index}] conflicts with its completed-tool artifact`,
        );
      }
      artifacts[matchingIndex] = {
        ...matchingArtifact,
        ...(id === null ? {} : {id}),
        name,
        arguments: call.arguments,
      };
    }
  }
  return artifacts.length > 0 ? artifacts : undefined;
}

export function portableContext(message: StoredRecord, label: string): string | null {
  const generationMeta =
    message.generationMeta === undefined
      ? undefined
      : record(message.generationMeta, `${label}.generationMeta`);
  const toolArtifacts = portableToolArtifacts(message, label);
  const role = text(message.role, `${label}.role`);
  const candidate = {
    ...(message.reasoningContent === undefined
      ? {}
      : {reasoning: message.reasoningContent}),
    ...(generationMeta?.routedToolNames === undefined
      ? {}
      : {toolsOffered: generationMeta.routedToolNames}),
    ...(toolArtifacts?.length ? {toolCalls: toolArtifacts} : {}),
    ...(role === 'tool'
      ? {
          tool: {
            ...(message.toolCallId === undefined
              ? {}
              : {callId: message.toolCallId}),
            ...(message.toolName === undefined ? {} : {name: message.toolName}),
            status: 'completed',
            ...(message.generationTimeMs === undefined
              ? {}
              : {durationMs: message.generationTimeMs}),
          },
        }
      : {}),
    ...(message.isSystemInfo === true ? {notice: true} : {}),
    status: 'completed',
    ...(message.generationTimeMs === undefined
      ? {}
      : {durationMs: message.generationTimeMs}),
  };
  const serialized = serializeSyncedMessageContext(candidate);
  if (
    serialized === null ||
    stableJson(JSON.parse(serialized)) !== stableJson(candidate)
  ) {
    throw new Error(
      `${label} has portable context that cannot be represented losslessly`,
    );
  }
  return Object.keys(candidate).length === 1 ? null : serialized;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as StoredRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function stableMessageId(message: StoredRecord): string {
  return optionalText(message.uuid) ?? text(message.id, 'message.id');
}

export function legacyTurns(input: {
  conversation: StoredRecord;
  conversationId: string;
  messages: readonly StoredRecord[];
  now: string;
}): {turns: ChatTurnRecord[]; turnIds: Map<string, string>} {
  const {conversation, conversationId, messages, now} = input;
  const turns: ChatTurnRecord[] = [];
  const turnIds = new Map<string, string>();
  for (let index = 0; index < messages.length; index += 1) {
    const user = messages[index];
    if (user.role !== 'user' || user.isSystemInfo === true) continue;
    const nextUserOffset = messages
      .slice(index + 1)
      .findIndex(
        message => message.role === 'user' && message.isSystemInfo !== true,
      );
    const end = nextUserOffset < 0 ? messages.length : index + 1 + nextUserOffset;
    const responses = messages
      .slice(index + 1, end)
      .filter(
        message =>
          (message.role === 'assistant' || message.role === 'tool') &&
          message.isSystemInfo !== true,
      );
    const turnId = stableMessageId(user);
    const responseMessageIds = responses.map(stableMessageId);
    turnIds.set(text(user.id, 'message.id'), turnId);
    for (const response of responses) {
      turnIds.set(text(response.id, 'message.id'), turnId);
    }
    const createdAt = isoTime(user.timestamp, now);
    const updatedAt = responses.reduce(
      (latest, response) => isoTime(response.timestamp, latest),
      createdAt,
    );
    const operation =
      user.turnKind === 'image'
        ? {
            type: 'image' as const,
            prompt: typeof user.content === 'string' ? user.content : '',
          }
        : Array.isArray(user.attachments) &&
            user.attachments.some(
              value => record(value, 'message.attachment').type === 'image',
            )
          ? {type: 'vision' as const}
          : {type: 'text' as const};
    const interrupted = [user, ...responses].some(
      message => message.isStreaming === true || message.isThinking === true,
    );
    turns.push({
      id: turnId,
      conversationId,
      ...(typeof conversation.projectId === 'string'
        ? {projectId: conversation.projectId}
        : {}),
      userMessageId: turnId,
      responseMessageIds,
      status: interrupted
        ? 'interrupted'
        : responses.length > 0
          ? 'completed'
          : 'queued',
      request: {operation, request: {}},
      requestId: turnId,
      position: turns.length,
      recoveryAttempts: 0,
      lastError: null,
      createdAt,
      updatedAt,
    });
  }
  return {turns, turnIds};
}

export function localMessageState(
  message: StoredRecord,
  locations: readonly LocalMessageContentLocation[] | undefined,
): StoredRecord {
  const local = {...message};
  delete local.id;
  delete local.uuid;
  delete local.role;
  delete local.content;
  delete local.timestamp;
  delete local.reasoningContent;
  delete local.turnKind;
  delete local.isSystemInfo;
  delete local.isStreaming;
  delete local.isThinking;
  delete local.attachments;
  delete local.generationTimeMs;
  delete local.toolCallId;
  delete local.toolCalls;
  delete local.toolArtifacts;
  delete local.toolName;
  if (locations) local.contentLocations = locations;
  if (local.generationMeta && typeof local.generationMeta === 'object') {
    const localGenerationMeta = {...(local.generationMeta as StoredRecord)};
    delete localGenerationMeta.routedToolNames;
    if (Object.keys(localGenerationMeta).length > 0) {
      local.generationMeta = localGenerationMeta;
    } else {
      delete local.generationMeta;
    }
  }
  return local;
}

export function isoTime(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return fallback;
}
