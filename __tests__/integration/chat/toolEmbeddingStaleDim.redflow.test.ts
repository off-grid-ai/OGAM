/**
 * RED-FLOW (integration) — PR#453 (audit A12): the tool-routing embedding cache serves a stale-dimension
 * vector after the embedding model's output dimension changes, silently poisoning routing.
 *
 * embedTool keyed the cache on the tool TEXT hash, not the model, so a cached vector from the old model
 * was returned even when the current model emits a different dimension — cosineSimilarity then loops on
 * the longer query and reads undefined from the shorter stale vector → NaN. Correct: a dimension change
 * re-embeds the tool.
 *
 * Drives the REAL router and the REAL embeddingService (bundled MiniLM copied out and loaded through the
 * residency lock; a chosen model committed through the documents store and loaded from its file). Only
 * the device is faked (embeddingDevice: llama.rn's embedding context, the disk, SQLite). The person
 * switches from the bundled model to a downloaded BERT encoder whose GGUF header says it emits 5-wide
 * vectors; the native context then answers at that width.
 */
import { launchEmbeddingDevice, type EmbeddingDevice } from '../../harness/embeddingDevice';

type Tool = { type: 'function'; function: { name: string; description: string } };
const TOOLS: Tool[] = [
  { type: 'function', function: { name: 'web_search', description: 'Search the web' } },
  { type: 'function', function: { name: 'calculator', description: 'Evaluate a math expression' } },
  { type: 'function', function: { name: 'get_current_datetime', description: 'Get the current date and time' } },
  { type: 'function', function: { name: 'get_device_info', description: 'Get device information' } },
];

const SMALL_MODEL = { id: 'author/tiny-bert-embed', name: 'Tiny BERT', size: 40 * 1024 * 1024 };
const SMALL_DIM = 5;

describe('PR#453 — stale-dimension tool-embedding cache (red-flow)', () => {
  it('re-embeds a cached tool vector when the embedding model dimension changes', async () => {
    const device: EmbeddingDevice = launchEmbeddingDevice();
    const llama = require('llama.rn');
    const RNFS = require('react-native-fs');
    const { embeddingService } = require('../../../src/services/rag/embedding');
    const { commitEmbeddingModel } = require('../../../src/services/documents/store');
    const { selectToolsByEmbedding, _resetToolEmbeddingCache } = require('../../../src/services/toolEmbeddingRouter');
    _resetToolEmbeddingCache();

    // Turn 1 — the bundled embedding model: populates the cache with its tool vectors.
    await selectToolsByEmbedding('search the web for cats', TOOLS, 2);
    const firstWidth = embeddingService.getDimension();

    // The person downloaded a smaller BERT encoder and chose it. Its file is on disk; its GGUF header
    // declares a 5-wide embedding, and the native context answers at that width.
    const filePath = embeddingService.modelPath(SMALL_MODEL.id);
    await RNFS.writeFile(filePath, 'x'.repeat(16), 'utf8');
    llama.loadLlamaModelInfo.mockImplementation(async (path: string) => (path === filePath
      ? { 'general.architecture': 'bert', 'bert.pooling_type': 1, 'bert.context_length': 512, 'bert.embedding_length': SMALL_DIM }
      : {}));
    const open = llama.initLlama.getMockImplementation();
    llama.initLlama.mockImplementation(async (params: { model?: string; embedding?: boolean }) => {
      const context = await open(params);
      if (!params?.embedding || params.model !== filePath) return context;
      return {
        ...context,
        embedding: async (text: string) => {
          await context.embedding(text); // still recorded as a native embedding call
          return { embedding: new Array(SMALL_DIM).fill(0.1) };
        },
      };
    });
    commitEmbeddingModel({ ...SMALL_MODEL, filePath });
    await embeddingService.unload();
    device.embedded.length = 0;

    // Turn 2 — same tools. The tool vectors must be re-embedded at the new dimension, not served stale.
    await selectToolsByEmbedding('search the web for dogs', TOOLS, 2);

    expect(firstWidth).not.toBe(SMALL_DIM);
    expect(embeddingService.getDimension()).toBe(SMALL_DIM);
    // Correct: at least one TOOL text reached the native model this turn (dimension changed).
    const reEmbeddedATool = device.embedded.some(t => TOOLS.some(tool => t.includes(tool.function.name)));
    expect(reEmbeddedATool).toBe(true);
  });
});
