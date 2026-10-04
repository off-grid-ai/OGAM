import type {
  LocalMessageContentLocation,
  MessageRecord,
  PortableMessageContentPart,
} from '@offgrid/application';
import type {MediaAttachment, Message} from '../../../types';
import {portableMessageText} from '../../../utils/portableMessageText';
import {resolveDocumentPath} from '../../../utils/resolveDocumentPath';

function attachmentLocation(
  locations: readonly LocalMessageContentLocation[],
  part: Exclude<PortableMessageContentPart, {readonly type: 'text'}>,
  index: number,
): LocalMessageContentLocation | undefined {
  return locations.find(location =>
    'contentId' in location
      ? location.contentId === part.contentId
      : location.index === index,
  );
}

function attachmentId(
  record: MessageRecord,
  part: Exclude<PortableMessageContentPart, {readonly type: 'text'}>,
  index: number,
): string {
  if (part.contentId) return part.contentId;
  if (part.type === 'image' && part.id) return part.id;
  return `${record.id}:attachment:${index}`;
}

function audioFormat(mimeType: string | undefined): 'wav' | 'mp3' | undefined {
  const normalized = mimeType?.toLowerCase();
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav') return 'wav';
  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') return 'mp3';
  return undefined;
}

function projectAttachments(record: MessageRecord): MediaAttachment[] | undefined {
  if (typeof record.portable.content === 'string') return undefined;
  const locations = record.local?.contentLocations ?? [];
  const attachments: MediaAttachment[] = [];
  record.portable.content.forEach((part, index) => {
    if (part.type === 'text') return;
    const location = attachmentLocation(locations, part, index);
    const uri = location?.uri ? resolveDocumentPath(location.uri) : '';
    const common = {
      id: attachmentId(record, part, index),
      uri,
      ...(part.mimeType === undefined ? {} : {mimeType: part.mimeType}),
      ...(part.name === undefined ? {} : {fileName: part.name}),
      ...(part.sizeBytes === undefined ? {} : {fileSize: part.sizeBytes}),
      ...(uri ? {} : {pending: true}),
    };
    if (part.type === 'image') {
      attachments.push({
        ...common,
        type: 'image' as const,
        ...(part.width === undefined ? {} : {width: part.width}),
        ...(part.height === undefined ? {} : {height: part.height}),
      });
      return;
    }
    if (part.type === 'audio') {
      const format = audioFormat(part.mimeType);
      attachments.push({
        ...common,
        type: 'audio' as const,
        ...(format === undefined ? {} : {audioFormat: format}),
        ...(part.durationSeconds === undefined
          ? {}
          : {audioDurationSeconds: part.durationSeconds}),
      });
      return;
    }
    attachments.push({...common, type: 'document' as const});
  });
  return attachments.length > 0 ? attachments : undefined;
}

/** Convert one canonical workspace record into Mobile's read-only presentation shape. */
export function projectWorkspaceMessage(record: MessageRecord): Message {
  const local = record.local as Partial<Message> | undefined;
  const timestamp = Date.parse(record.createdAt);
  const attachments = projectAttachments(record) ?? local?.attachments;
  const context = record.portable.context;
  const generationMeta =
    context?.toolsOffered === undefined
      ? local?.generationMeta
      : {...local?.generationMeta, routedToolNames: context.toolsOffered};
  return {
    ...local,
    ...(local?.audioPath === undefined
      ? {}
      : {audioPath: resolveDocumentPath(local.audioPath)}),
    id: record.id,
    uuid: record.id,
    role: record.portable.role,
    content: portableMessageText(record.portable.content) ?? '',
    timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
    ...(attachments === undefined ? {} : {attachments}),
    ...(generationMeta === undefined ? {} : {generationMeta}),
    ...(context?.reasoning === undefined
      ? {}
      : {reasoningContent: context.reasoning}),
    ...(context?.notice === undefined ? {} : {isSystemInfo: context.notice}),
    ...(context?.toolCalls === undefined
      ? {}
      : {toolArtifacts: [...context.toolCalls]}),
    ...(context?.tool?.name === undefined ? {} : {toolName: context.tool.name}),
    ...(context?.tool?.callId === undefined
      ? {}
      : {toolCallId: context.tool.callId}),
    ...(context?.durationMs === undefined
      ? {}
      : {generationTimeMs: context.durationMs}),
  };
}
