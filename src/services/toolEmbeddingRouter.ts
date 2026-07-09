/**
 * Semantic tool routing via the on-device embedding model (the same ~25MB
 * all-MiniLM-L6-v2 we already ship for RAG — see services/rag/embedding.ts).
 *
 * Why: with several MCP servers connected, dozens of large tool schemas would
 * otherwise all land in the prompt, and the model must prefill every one before it
 * can answer — which dominates time-to-first-token on-device. The main-model routing
 * pass (litertToolSelector) can't help on Android llama (it double-prefills the big
 * model, so it's disabled there). An embedding pass runs on the tiny MiniLM context
 * instead: embed the query + each tool's name/description, keep the top-K by cosine
 * similarity, and hand the main model only those. No extra big-model prefill, no new
 * model download.
 *
 * Tool-description embeddings are cached by content — a tool's schema is static, so
 * it's embedded once and reused across turns. The cache is persisted to disk so the
 * cold burst (~60 sequential CPU embeddings the first time MCP is used in a session)
 * happens once ever, not on the first message of every session — a real
 * time-to-first-token win for Pro/MCP users.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { embeddingService } from './rag/embedding';
import logger from '../utils/logger';

interface RoutableTool {
  function: { name: string; description?: string };
}

const CACHE_STORAGE_KEY = 'tool-embedding-cache-v1';
interface CacheEntry { h: string; v: number[] }
/** name -> { hash of embed text, embedding }. Static per tool content. */
const toolEmbeddingCache = new Map<string, CacheEntry>();
let hydrated = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Stable, cheap content hash (djb2) so a changed description re-embeds. */
function hashText(text: string): string {
  /* eslint-disable no-bitwise -- djb2 hash is defined in terms of bit ops */
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
  /* eslint-enable no-bitwise */
}

/** Load the persisted cache once. Corrupt/missing storage just starts empty. */
async function hydrateCache(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    for (const [name, entry] of Object.entries(parsed)) {
      // Validate the vector CONTENTS, not just that it's an array: a corrupt/stale
      // entry with a non-numeric or NaN element would silently poison cosine similarity
      // (NaN scores) and destabilize tool routing. Drop anything that isn't a non-empty
      // vector of finite numbers.
      const validVector = Array.isArray(entry?.v) && entry.v.length > 0
        && entry.v.every(n => typeof n === 'number' && Number.isFinite(n));
      if (entry && typeof entry.h === 'string' && validVector) toolEmbeddingCache.set(name, entry);
    }
    logger.log(`[ToolRouter] hydrated ${toolEmbeddingCache.size} cached tool embeddings`);
  } catch (e) {
    logger.warn(`[ToolRouter] failed to hydrate embedding cache: ${String(e)}`);
  }
}

/** Persist the cache (debounced) so freshly-embedded tools survive a relaunch. */
function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const obj = Object.fromEntries(toolEmbeddingCache);
    AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj)).catch(e =>
      logger.warn(`[ToolRouter] failed to persist embedding cache: ${String(e)}`),
    );
  }, 1000);
}

function firstLine(desc: string | undefined, max = 200): string {
  const line = (desc ?? '').split('\n')[0].trim();
  return line.length > max ? line.slice(0, max) : line;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Short/function words that shouldn't drive tool selection (they match too much).
const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'can', 'get', 'are', 'was', 'with', 'that',
  'this', 'have', 'has', 'from', 'about', 'what', 'which', 'show', 'tell', 'please',
  'give', 'into', 'them', 'they', 'our', 'out', 'all', 'any', 'some', 'use',
]);

/** Meaningful query tokens: lowercase words ≥3 chars, minus stopwords. */
function queryTokens(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw)) seen.add(raw);
  }
  return [...seen];
}

/**
 * Lexical boost on top of embedding similarity. A query token appearing in the tool
 * NAME is a strong signal (provider/verb names like "notion"/"search" live there); a
 * match in the description is a weaker one. This is what makes "look at my notion
 * page" surface notion-search/notion-fetch instead of notion-get-users — pure cosine
 * can't tell them apart, the literal word "notion" can.
 */
function lexicalBoost(tokens: string[], tool: RoutableTool): number {
  const name = tool.function.name.toLowerCase();
  const desc = (tool.function.description ?? '').toLowerCase();
  let nameHits = 0;
  let descHits = 0;
  for (const t of tokens) {
    if (name.includes(t)) nameHits++;
    else if (desc.includes(t)) descHits++;
  }
  return Math.min(nameHits, 2) * 0.3 + Math.min(descHits, 3) * 0.1;
}

// Verbs that mark a tool as a discovery / entry-point (you call these to FIND things
// before you can act on them). They embed poorly against natural phrasing like "get my
// latest page", so give them a structural nudge — without one, the model gets fetch/
// update tools but not the search/list tool it needs to start, and reports "no access".
const DISCOVERY_VERBS = ['search', 'list', 'query', 'find', 'fetch', 'get', 'read'];

function discoveryBoost(tool: RoutableTool): number {
  const name = tool.function.name.toLowerCase();
  return DISCOVERY_VERBS.some(v => name.includes(v)) ? 0.15 : 0;
}

async function embedTool(tool: RoutableTool): Promise<number[]> {
  const text = `${tool.function.name}: ${firstLine(tool.function.description)}`;
  const hash = hashText(text);
  const cached = toolEmbeddingCache.get(tool.function.name);
  if (cached && cached.h === hash) return cached.v;
  const vec = await embeddingService.embed(text);
  toolEmbeddingCache.set(tool.function.name, { h: hash, v: vec });
  schedulePersist();
  return vec;
}

/**
 * Return the names of the `topK` tools most semantically relevant to `query`.
 * Throws if embedding is unavailable so the caller can fall back to its own policy
 * (e.g. keep all tools) rather than silently dropping tools on a transient failure.
 */
export async function selectToolsByEmbedding(
  query: string,
  tools: RoutableTool[],
  topK: number,
): Promise<string[]> {
  if (tools.length <= topK || !query.trim()) {
    return tools.map(t => t.function.name);
  }
  await hydrateCache();
  await embeddingService.load();
  const queryVec = await embeddingService.embed(query);
  const tokens = queryTokens(query);
  const scored: Array<{ name: string; score: number }> = [];
  for (const tool of tools) {
    const vec = await embedTool(tool);
    // Hybrid: semantic similarity + lexical (provider/verb word) + discovery boost.
    const score = cosineSimilarity(queryVec, vec) + lexicalBoost(tokens, tool) + discoveryBoost(tool);
    scored.push({ name: tool.function.name, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, topK).map(s => s.name);
  logger.log(`[ToolRouter] hybrid-routed ${tools.length} → ${selected.length}: [${selected.join(', ')}]`);
  return selected;
}

/** Test helper: clear the in-memory cache and re-arm hydration. */
export function _resetToolEmbeddingCache(): void {
  toolEmbeddingCache.clear();
  hydrated = false;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}
