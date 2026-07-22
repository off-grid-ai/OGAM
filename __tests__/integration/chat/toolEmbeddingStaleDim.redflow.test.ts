/**
 * RED-FLOW (integration) — PR#453 (audit A12): the tool-routing embedding cache serves a stale-dimension
 * vector after the embedding model's output dimension changes, silently poisoning routing.
 *
 * embedTool keys the cache on the tool TEXT hash, not the model (toolEmbeddingRouter.ts:146-147), so a
 * cached vector from an old model (dim 3) is returned even when the current model emits dim 5 —
 * cosineSimilarity then loops on the longer query and reads undefined from the shorter stale vector
 * (:88) → NaN. Correct: a dimension change re-embeds the tool. Drives the REAL router; the only faked
 * boundary is the embedding model (embeddingService.embed), whose output DIMENSION we swap.
 */
import { selectToolsByEmbedding } from '../../../src/services/toolEmbeddingRouter';
import { embeddingService } from '../../../src/services/rag/embedding';

type Tool = {
  type: 'function';
  function: { name: string; description: string };
};
const TOOLS: Tool[] = [
  {
    type: 'function',
    function: { name: 'web_search', description: 'Search the web' },
  },
  {
    type: 'function',
    function: { name: 'calculator', description: 'Evaluate a math expression' },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_datetime',
      description: 'Get the current date and time',
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_device_info',
      description: 'Get device information',
    },
  },
];

describe('PR#453 — stale-dimension tool-embedding cache (red-flow)', () => {
  it('re-embeds a cached tool vector when the embedding model dimension changes', async () => {
    jest.spyOn(embeddingService, 'load').mockResolvedValue(undefined as never);
    let dim = 3;
    const embed = jest
      .spyOn(embeddingService, 'embed')
      .mockImplementation(async (_text: string) => new Array(dim).fill(0.1));

    // Turn 1 — old embedding model (dim 3): populates the cache with 3-dim tool vectors.
    await selectToolsByEmbedding('search the web for cats', TOOLS, 2);

    // The user swaps the embedding model; its output dimension is now 5.
    dim = 5;
    embed.mockClear();

    // Turn 2 — same tools. The tool vectors must be re-embedded at the new dimension, not served stale.
    await selectToolsByEmbedding('search the web for dogs', TOOLS, 2);

    // Correct: at least one TOOL text is re-embedded this turn (dimension changed). Today embedTool
    // serves the stale 3-dim vectors on a hash match, so only the query is embedded → RED.
    const embeddedTexts = embed.mock.calls.map(c => String(c[0]));
    const reEmbeddedATool = embeddedTexts.some(t =>
      TOOLS.some(tool => t.includes(tool.function.name)),
    );
    expect(reEmbeddedATool).toBe(true);
  });
});
