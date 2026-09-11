/**
 * RED-FLOW (integration) — PR#453 (audit A12): the tool-routing embedding cache serves a stale-dimension
 * vector after the embedding model's output dimension changes, silently poisoning routing.
 *
 * A cached vector from the old embedding model must not survive an output-dimension change, so a
 * cached vector from an old model (dim 3) is returned even when the current model emits dim 5 —
 * cosineSimilarity then loops on the longer query and reads undefined from the shorter stale vector
 * (:88) → NaN. Correct: a dimension change re-embeds the tool. Drives the REAL router; the only faked
 * boundary is the embedding model (embeddingService.embed), whose output DIMENSION we swap.
 */
import { ToolRoutingService } from '@offgrid/models';
import {
  mobileToolEmbeddingCache,
  resetMobileToolEmbeddingCache,
} from '../../../src/services/composition/tools';

type Tool = { type: 'function'; function: { name: string; description: string } };
const TOOLS: Tool[] = [
  { type: 'function', function: { name: 'web_search', description: 'Search the web' } },
  { type: 'function', function: { name: 'calculator', description: 'Evaluate a math expression' } },
  { type: 'function', function: { name: 'get_current_datetime', description: 'Get the current date and time' } },
  { type: 'function', function: { name: 'get_device_info', description: 'Get device information' } },
];

describe('PR#453 — stale-dimension tool-embedding cache (red-flow)', () => {
  it('re-embeds a cached tool vector when the embedding model dimension changes', async () => {
    resetMobileToolEmbeddingCache();
    let dim = 3;
    const embed = jest.fn(async (inputs: readonly string[]) => inputs.map(() => new Array(dim).fill(0.1)));
    const service = new ToolRoutingService({
      embedding: { embed },
      embeddingCache: mobileToolEmbeddingCache(),
    });
    const select = (query: string) => service.select({
      messages: [{ role: 'user', content: query }],
      builtInTools: [],
      externalTools: TOOLS.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        inputSchema: { type: 'object', properties: {} },
      })),
      remoteModel: false,
      embeddingRouting: true,
      modelRouting: false,
      selectionLimit: 2,
      routingThreshold: 0,
    });

    // Turn 1 — old embedding model (dim 3): populates the cache with 3-dim tool vectors.
    await select('search the web for cats');

    // The user swaps the embedding model; its output dimension is now 5.
    dim = 5;
    embed.mockClear();

    // Turn 2 — same tools. The tool vectors must be re-embedded at the new dimension, not served stale.
    await select('search the web for dogs');

    // Correct: at least one TOOL text is re-embedded this turn (dimension changed). Today embedTool
    // serves the stale 3-dim vectors on a hash match, so only the query is embedded → RED.
    const embeddedTexts = embed.mock.calls.flatMap(c => c[0].map(String));
    const reEmbeddedATool = embeddedTexts.some(t => TOOLS.some(tool => t.includes(tool.function.name)));
    expect(reEmbeddedATool).toBe(true);
  });
});
