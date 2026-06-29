export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
  minChunkLength?: number;
}

export interface Chunk {
  content: string;
  position: number;
  // Optional per-chunk metadata (e.g. recordingId, startMs, eventTitle for
  // recordings) so a search hit can cite and seek back to its source moment.
  metadata?: Record<string, unknown>;
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

export function chunkDocument(text: string, options?: ChunkOptions): Chunk[] {
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
