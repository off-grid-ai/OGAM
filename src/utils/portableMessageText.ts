import type { SyncedMessageContentPart } from '@offgrid/sync';

/** Project portable rich content into the text-only contract used by legacy Mobile views. */
export function portableMessageText(
  content: string | readonly SyncedMessageContentPart[] | null | undefined,
): string | undefined {
  if (typeof content === 'string') return content;
  if (!content) return undefined;
  return content
    .flatMap(part => (part.type === 'text' ? [part.text] : []))
    .join('\n');
}
