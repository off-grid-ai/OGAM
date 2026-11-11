export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
  minChunkLength?: number;
}

export interface Chunk {
  content: string;
  position: number;
}

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 100;
const DEFAULT_MIN_CHUNK_LENGTH = 20;

function slidingWindowChunks(
  params: { text: string; chunkSize: number; overlap: number; minLength: number },
  chunks: Chunk[], startPosition: number,
): number {
  const { text, chunkSize, overlap, minLength } = params;
  let pos = startPosition;
  let start = 0;
  while (start < text.length) {
    const slice = text.slice(start, start + chunkSize);
    if (slice.trim().length >= minLength) {
      chunks.push({ content: slice.trim(), position: pos++ });
    }
    start += chunkSize - overlap;
  }
  return pos;
}

function flushChunk(
  opts: { chunk: string; minLength: number },
  chunks: Chunk[], position: number,
): number {
  if (opts.chunk.trim().length >= opts.minLength) {
    chunks.push({ content: opts.chunk.trim(), position });
    return position + 1;
  }
  return position;
}

/**
 * In a Markdown document a chunk is told where it sits ("[Chapter 2 > Cash flow]"), so a search result and the answer built from
 * it keep their place in the document. A chunk that already starts with a heading is left as it is; text without headings is
 * unchanged.
 */
export function withSectionContext(text: string, chunks: Chunk[]): Chunk[] {
  if (!text || !chunks.length) return chunks;
  const heads = [...text.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*$/gm)].map((m) => ({ at: m.index ?? 0, level: m[1].length, title: m[2] }));
  if (!heads.length) return chunks;
  let from = 0;
  return chunks.map((c) => {
    const found = text.indexOf(c.content.slice(0, 80), from);
    if (found >= 0) from = found;
    const stack: typeof heads = [];
    for (const h of heads) {
      if (h.at > from) break;
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      stack.push(h);
    }
    const path = stack.map((h) => h.title).join(' > ');
    return path && !/^#{1,6}\s/.test(c.content) ? { ...c, content: `[${path}]\n${c.content}` } : c;
  });
}

export function chunkDocument(text: string, options?: ChunkOptions): Chunk[] {
  return withSectionContext(text, plainChunks(text, options));
}

function plainChunks(text: string, options?: ChunkOptions): Chunk[] {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options?.overlap ?? DEFAULT_OVERLAP;
  const minLength = options?.minChunkLength ?? DEFAULT_MIN_CHUNK_LENGTH;

  if (!text || text.trim().length < minLength) return [];

  const paragraphs = text.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let currentChunk = '';
  let position = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if (trimmed.length > chunkSize) {
      position = flushChunk({ chunk: currentChunk, minLength }, chunks, position);
      currentChunk = '';
      position = slidingWindowChunks({ text: trimmed, chunkSize, overlap, minLength }, chunks, position);
      continue;
    }

    const candidate = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed;
    if (candidate.length > chunkSize) {
      position = flushChunk({ chunk: currentChunk, minLength }, chunks, position);
      currentChunk = trimmed;
    } else {
      currentChunk = candidate;
    }
  }

  flushChunk({ chunk: currentChunk, minLength }, chunks, position);
  return chunks;
}
