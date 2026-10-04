import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { ToolRoutingService } from '@offgrid/models';
import {
  mobileToolEmbeddingCache,
  resetMobileToolEmbeddingCache,
} from '../../../src/services/composition/tools';

const tool = (name: string, description = `does ${name}`) => ({
  name,
  description,
  inputSchema: { type: 'object', properties: {} },
});

// 12 tools so routing actually runs (topK 4 < 12).
const TOOLS = Array.from({ length: 12 }, (_, i) => tool(`provider-action-${i}`));

describe('toolEmbeddingRouter (F6 — persistent embedding cache)', () => {
  const mockEmbed = jest.fn<Promise<number[][]>, [readonly string[]]>();
  const select = (query: string, tools = TOOLS, topK = 4) => new ToolRoutingService({
    embedding: { embed: mockEmbed },
    embeddingCache: mobileToolEmbeddingCache(),
  }).select({
    messages: [{ role: 'user', content: query }],
    builtInTools: [],
    externalTools: tools,
    remoteModel: false,
    embeddingRouting: true,
    modelRouting: false,
    selectionLimit: topK,
    routingThreshold: 0,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    resetMobileToolEmbeddingCache();
    await AsyncStorage.clear();
    // Deterministic per-text embeddings so cosine math is stable.
    let n = 0;
    mockEmbed.mockImplementation(async inputs => inputs.map(() => { n += 1; return [n, 1, 0]; }));
  });

  it('embeds each tool once and the query once on a cold cache', async () => {
    await select('find my page');
    // 1 query embed + 12 tool embeds
    expect(mockEmbed).toHaveBeenCalledTimes(TOOLS.length + 1);
  });

  it('persists embeddings so a relaunch (cache cleared) does not re-embed tools', async () => {
    await select('find my page');
    await new Promise(r => setTimeout(r, 1100)); // let the debounced persist fire
    const stored = await AsyncStorage.getItem('tool-embedding-cache-v1');
    expect(stored).toBeTruthy();

    // Simulate relaunch: clear in-memory cache, keep AsyncStorage.
    resetMobileToolEmbeddingCache();
    mockEmbed.mockClear();
    await select('find my page');
    // Only the query is embedded; all 12 tools come from the persisted cache.
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });

  it('re-embeds a tool whose description changed (content-hash keyed)', async () => {
    await select('find my page');
    await new Promise(r => setTimeout(r, 1100));
    resetMobileToolEmbeddingCache();
    mockEmbed.mockClear();

    const changed = [tool('provider-action-0', 'NOW DOES SOMETHING ELSE'), ...TOOLS.slice(1)];
    await select('find my page', changed);
    // query (1) + the single changed tool (1) re-embedded; the other 11 are cached.
    expect(mockEmbed).toHaveBeenCalledTimes(2);
  });

  it('drops a cached entry with a corrupt (NaN) vector on hydration and re-embeds it', async () => {
    await select('find my page');
    await new Promise(r => setTimeout(r, 1100)); // let the debounced persist fire

    // Corrupt ONE tool's persisted vector (a NaN slips in via stale/garbled storage).
    // Left unchecked it would poison cosine similarity with NaN scores.
    const stored = JSON.parse((await AsyncStorage.getItem('tool-embedding-cache-v1'))!);
    const corruptName = Object.keys(stored)[0];
    stored[corruptName] = { ...stored[corruptName], v: [Number.NaN, 1, 0] };
    await AsyncStorage.setItem('tool-embedding-cache-v1', JSON.stringify(stored));

    resetMobileToolEmbeddingCache();
    mockEmbed.mockClear();
    await select('find my page');
    // query (1) + the one corrupt tool re-embedded (1); the other 11 came from valid cache.
    expect(mockEmbed).toHaveBeenCalledTimes(2);
  });

  it('returns all tools without embedding when count <= topK', async () => {
    const result = await select('x', TOOLS.slice(0, 3), 4);
    expect(result.tools).toHaveLength(3);
    expect(mockEmbed).not.toHaveBeenCalled();
  });
});
