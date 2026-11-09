import type { ToolCall } from './types';

/** Small models often name an argument differently ("filename" for "path", "text" for "content"). Accept the usual alternatives. */
const ALIASES: Record<string, string[]> = {
  path: ['file_path', 'filepath', 'filename', 'file_name', 'file', 'name'],
  content: ['text', 'body', 'data', 'file_content', 'contents'],
  name: ['title', 'document', 'document_name', 'doc'],
};
export function arg(call: ToolCall, param: string): unknown {
  const a = call.arguments ?? {};
  if (a[param] !== undefined && a[param] !== null && a[param] !== '') return a[param];
  for (const alt of ALIASES[param] ?? []) if (a[alt] !== undefined && a[alt] !== null && a[alt] !== '') return a[alt];
  return a[param];
}

/** Said back to the model when write_file arrives with no content, so it retries instead of leaving an empty file. */
export const EMPTY_WRITE = 'Nothing was written: the content was empty. Call write_file again with the complete text in "content" (if it is long, write it in parts: the first part with append false, then each next part with append true).';

/** A non-empty string argument (trimmed), under its own name or a usual alternative; null when missing. */
export function requireString(call: ToolCall, param: string): string | null {
  const val = arg(call, param);
  return (val && typeof val === 'string' && val.trim()) ? val.trim() : null;
}
