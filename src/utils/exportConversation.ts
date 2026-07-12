import { Share } from 'react-native';
import RNShare from 'react-native-share';
import RNFS from 'react-native-fs';
import { Conversation, Message } from '../types';

/** Above this many lines, the transcript is shared as a .txt file instead of inline text. */
const FILE_SHARE_LINE_THRESHOLD = 30;

function sanitizeFileName(title: string): string {
  const trimmed = title.trim().replace(/[^a-zA-Z0-9-_ ]/g, '').trim();
  return trimmed.length > 0 ? trimmed.replace(/\s+/g, '_') : 'conversation';
}

function roleLabel(role: Message['role']): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    case 'tool':
      return 'Tool';
  }
}

function formatMessage(message: Message): string {
  const time = new Date(message.timestamp).toLocaleString();
  const attachmentCount = message.attachments?.length ?? 0;
  const attachmentNote = attachmentCount > 0
    ? ` [${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}]`
    : '';
  return `[${time}] ${roleLabel(message.role)}:${attachmentNote}\n${message.content}`;
}

/** Pure serializer: a Conversation -> a plain-text transcript. No I/O. */
export function formatConversationAsText(conversation: Conversation): string {
  const header = [
    conversation.title,
    `Model: ${conversation.modelId}`,
    `Created: ${new Date(conversation.createdAt).toLocaleString()}`,
    `Updated: ${new Date(conversation.updatedAt).toLocaleString()}`,
  ].join('\n');

  if (conversation.messages.length === 0) {
    return `${header}\n`;
  }

  const body = conversation.messages.map(formatMessage).join('\n\n');
  return `${header}\n\n${body}\n`;
}

/**
 * Thin I/O wrapper: hands the transcript to the native share sheet, as a file for long chats.
 *
 * React Native's built-in `Share` module can't deliver file attachments on Android at all —
 * it silently drops the `url` field and sends only `message`/`title` to the native intent.
 * `react-native-share` owns the file-attachment path on both platforms (it wraps the file in a
 * content:// URI via its own FileProvider on Android, and an activity item on iOS), so long
 * chats route through it instead of the core `Share` API.
 */
export async function shareConversationAsText(conversation: Conversation): Promise<void> {
  const transcript = formatConversationAsText(conversation);
  try {
    if (transcript.split('\n').length > FILE_SHARE_LINE_THRESHOLD) {
      const filePath = `${RNFS.CachesDirectoryPath}/${sanitizeFileName(conversation.title)}.txt`;
      await RNFS.writeFile(filePath, transcript, 'utf8');
      await RNShare.open({
        url: `file://${filePath}`,
        type: 'text/plain',
        filename: sanitizeFileName(conversation.title),
        title: conversation.title,
        failOnCancel: false,
      });
      return;
    }
    await Share.share({
      message: transcript,
      title: conversation.title,
    });
  } catch {
    // User cancelled or the share sheet failed to open — nothing to recover.
  }
}
