/**
 * A model often SAYS it made a file ("I've saved the report to Notes.md") when it never called the file tool, or the call
 * failed or was declined. This notices that mismatch so the reply can say plainly that nothing was written. Pure, so it
 * is tested without a device.
 */
const FILE_TOOLS = ['write_file', 'create_web_page', 'update_project_document'];

/** The reply claims that a file (or document) was made or saved. */
export function claimsFileWork(text: string): boolean {
  const t = text.replace(/\s+/g, ' ');
  return [
    /\b(i['’]?ve|i have|i)\s+(just\s+)?(created|saved|written|wrote|generated|made|added|updated|stored)\b[^.]{0,80}\b(file|document|doc|page|report|notes?|markdown|\.(md|txt|html|csv|json|pdf))\b/i,
    /\b(file|document|page|report)\b[^.]{0,40}\b(has been|was|is now)\s+(created|saved|written|updated|stored)\b/i,
    /\b(saved|created|written|stored)\s+(it\s+)?(to|in|as|at)\s+[`'"]?[\w./~ -]+\.(md|txt|html|csv|json|pdf|docx)\b/i,
  ].some((r) => r.test(t));
}

type ToolMessage = { role: string; toolName?: string; content: string };

/** A file tool ran in this turn and reported success (saved, rewrote, added to). */
export function fileWasWritten(messages: ToolMessage[]): boolean {
  return messages.some((m) => m.role === 'tool' && FILE_TOOLS.includes(m.toolName ?? '') && /^(saved|rewrote|added to)\b/i.test(m.content.trim()));
}

export const NO_FILE_NOTE = '\n\n(Atlas: no file was created. The model said it saved one, but the file tool did not run or did not finish. Ask again, and check that Files is turned on for this chat under Tools.)';

/** The note to add to a final reply, or '' when the claim is true or there was no claim. */
export function fileClaimNote(reply: string, messages: ToolMessage[]): string {
  return claimsFileWork(reply) && !fileWasWritten(messages) ? NO_FILE_NOTE : '';
}
