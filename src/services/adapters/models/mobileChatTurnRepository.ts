import {
  projectChatMessage,
  type GenerationMessage,
  type MessageRecord,
} from '@offgrid/application';
import type {Message} from '../../../types';

export function generationMessage(message: Message): GenerationMessage {
  // This value is persisted by ChatSessionService. Keep every display attachment here; Shared
  // removes display-only media only when it composes a model request.
  return projectChatMessage(message);
}

/** Project one canonical message without routing through the retired ChatStore shape. */
export function mobileWorkspaceGenerationMessage(
  record: MessageRecord,
): GenerationMessage {
  const locations = new Map(
    (record.local?.contentLocations ?? []).map(location => [location.index, location]),
  );
  const content = typeof record.portable.content === 'string'
    ? record.portable.content
    : record.portable.content.map((part, index) => {
        const location = locations.get(index);
        return {
          ...part,
          ...(location?.uri === undefined ? {} : {uri: location.uri}),
          ...(location?.data === undefined ? {} : {data: location.data}),
        };
      });
  const context = record.portable.context;
  const toolCalls = context?.toolCalls?.map(call => {
    if (!call.id || call.arguments === undefined) {
      throw new Error(`Message ${record.id} has incomplete tool-call facts.`);
    }
    return {id: call.id, name: call.name, arguments: call.arguments};
  });
  return {
    role: record.portable.role,
    content,
    ...(context?.reasoning ? {reasoning: context.reasoning} : {}),
    ...(record.portable.role === 'tool' && context?.tool?.name
      ? {name: context.tool.name}
      : {}),
    ...(record.portable.role === 'tool' && context?.tool?.callId
      ? {toolCallId: context.tool.callId}
      : {}),
    ...(toolCalls === undefined ? {} : {toolCalls}),
  };
}
