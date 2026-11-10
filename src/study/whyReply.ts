import type { GenerationMeta } from '../types';

/** What a reply was written from, in plain lines, for the "Why this reply" action. Empty when nothing was recorded. */
export function whyThisReply(meta: Partial<GenerationMeta> | undefined): string {
  if (!meta) return '';
  const lines: string[] = [];
  if (meta.modelName) lines.push(`Model: ${meta.modelName}`);
  if (meta.lessonsUsed?.length) lines.push(`Lessons used: ${meta.lessonsUsed.join(' and ')}`);
  if (meta.sources?.length) {
    lines.push('Document excerpts:');
    meta.sources.forEach((s, i) => lines.push(`${i + 1}. ${s.title}${s.quote ? `: "${s.quote}"` : ''}`));
  }
  if (meta.routedToolNames?.length) lines.push(`Tools it could use: ${meta.routedToolNames.join(', ')}`);
  if (meta.truncated) lines.push('The reply was cut off at the length limit.');
  return lines.join('\n');
}
