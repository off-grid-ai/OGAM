import type { Message } from '../types';

/**
 * What a chat is, for its row in a list: the last turn the person sent says (image, video, text);
 * chats from before that was recorded are an image or video chat when a reply carries one.
 */
export function chatKind(messages: readonly Message[]): 'text' | 'image' | 'video' {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'user' && message.turnKind) return message.turnKind;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    const kinds = new Set((message.attachments ?? []).map(attachment => attachment.type));
    if (kinds.has('video')) return 'video';
    if (kinds.has('image')) return 'image';
  }
  return 'text';
}

/**
 * The preview a row shows, or nothing when it only repeats the title (e.g. "You: <the same words>"):
 * a row that says the same thing twice tells you nothing new.
 */
export function rowPreview(preview: string | null | undefined, title: string): string {
  if (!preview) return '';
  const plain = (text: string) => text.replace(/^You:\s*/, '').replace(/[.…\s]+$/, '').trim().toLowerCase();
  const p = plain(preview);
  const t = plain(title);
  return p.length > 0 && t.length > 0 && (p.startsWith(t) || t.startsWith(p)) ? '' : preview;
}
