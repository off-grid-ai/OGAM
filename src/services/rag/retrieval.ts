import { ragDatabase, RagSearchResult } from './database';
import { embeddingService } from './embedding';
import { cosineSimilarity } from './vectorMath';
import logger from '../../utils/logger';

/** Strip HTML-like tags without regex backtracking risk. */
function stripAngleBracketTags(text: string): string {
  let result = '';
  let inTag = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '<') { inTag = true; continue; }
    if (text[i] === '>') { inTag = false; continue; }
    if (!inTag) result += text[i];
  }
  return result;
}

interface SearchResult {
  chunks: RagSearchResult[];
  truncated: boolean;
}

class RetrievalService {
  async search(projectId: string, query: string, topK: number = 5): Promise<SearchResult> {
    const chunks = await this.searchSemantic(projectId, query, topK);
    return { chunks, truncated: false };
  }

  private async searchSemantic(projectId: string, query: string, topK: number): Promise<RagSearchResult[]> {
    if (!query.trim()) return [];

    const stored = ragDatabase.getEmbeddingsByProject(projectId);
    if (stored.length === 0) {
      // Fallback: return first chunks if no embeddings exist yet
      logger.log('[Retrieval] No embeddings found, returning first chunks as fallback');
      return ragDatabase.getChunksByProject(projectId, topK);
    }

    if (!embeddingService.isLoaded()) {
      try {
        await embeddingService.load();
      } catch (err) {
        logger.error('[Retrieval] Failed to load embedding model, falling back', err);
        return ragDatabase.getChunksByProject(projectId, topK);
      }
    }

    let queryVec: number[];
    try {
      queryVec = await embeddingService.embed(query);
    } catch (err) {
      logger.error('[Retrieval] Failed to embed query, falling back', err);
      return ragDatabase.getChunksByProject(projectId, topK);
    }

    const scored = stored.map(entry => ({
      doc_id: entry.doc_id,
      name: entry.name,
      content: entry.content,
      position: entry.position,
      metadata: entry.metadata,
      score: cosineSimilarity(queryVec, entry.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  formatForPrompt(result: SearchResult): string {
    if (result.chunks.length === 0) return '';

    const sections = result.chunks.map((chunk) => {
      // Sanitize content to prevent prompt injection from user-uploaded documents
      const safeName = chunk.name.replaceAll(/[<>]/g, '');
      const safeContent = stripAngleBracketTags(chunk.content);
      return `[Source: ${safeName} (part ${chunk.position + 1})]\n${safeContent}`;
    });

    return `<knowledge_base>\nThe following excerpts are from the user's project knowledge base. Use them to inform your response when relevant.\n\n${sections.join('\n\n---\n\n')}\n</knowledge_base>`;
  }

  estimateCharBudget(contextLengthTokens: number): number {
    // 25% of context window reserved for RAG; ~4 chars per token → simplifies to contextLength
    return Math.max(0, Math.floor(contextLengthTokens));
  }

  async searchWithBudget(params: { projectId: string; query: string; contextLength: number; topK?: number }): Promise<SearchResult> {
    const result = await this.search(params.projectId, params.query, params.topK ?? 5);
    const budget = this.estimateCharBudget(params.contextLength);

    let totalChars = 0;
    const fittingChunks: RagSearchResult[] = [];
    let truncated = false;

    for (const chunk of result.chunks) {
      totalChars += chunk.content.length;
      if (totalChars > budget) {
        truncated = true;
        break;
      }
      fittingChunks.push(chunk);
    }

    return { chunks: fittingChunks, truncated };
  }
}

export const retrievalService = new RetrievalService();
