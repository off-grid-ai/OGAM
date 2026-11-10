/**
 * Therapy-style protected project: one chat updates the shared "Current Progress" document
 * with the update_project_document tool, and a different chat in the same project then gets
 * that text in its prompt. Fakes only the device boundary: Keystore bridge, files, embeddings.
 */
import { NativeModules, Platform } from 'react-native';

const mockFiles = new Map<string, string>();
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs', CachesDirectoryPath: '/cache',
  exists: jest.fn(async (p: string) => mockFiles.has(p)),
  readFile: jest.fn(async (p: string) => mockFiles.get(p)),
  writeFile: jest.fn(async (p: string, d: string) => { mockFiles.set(p, d); }),
  unlink: jest.fn(async (p: string) => { mockFiles.delete(p); }),
  mkdir: jest.fn(async () => undefined),
}));
// Bag-of-words vectors: similar wording scores high, like the on-device embedding model.
const DIM = 64;
const vec = (t: string) => {
  const v = new Array(DIM).fill(0);
  t.toLowerCase().split(/[^a-z]+/).filter(Boolean).forEach((w) => { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) % DIM; v[h] += 1; });
  return v;
};
jest.mock('../../../src/services/rag/embedding', () => ({
  embeddingService: {
    isLoaded: () => true, load: async () => undefined,
    embed: async (t: string) => vec(t), embedBatch: async (ts: string[]) => ts.map(vec),
  },
}));
jest.mock('../../../src/services/rag/database', () => ({
  ragDatabase: { ensureReady: async () => undefined, getDocumentsByProject: () => [], isPathIndexed: () => false },
}));
jest.mock('../../../src/stores/protectedProjectStorage', () => ({
  unlockedProjectPin: (id: string) => (id === 'therapy' ? '123456' : undefined),
  isProtectedProjectUnlocked: (id: string) => id === 'therapy',
  protectedProjectStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));

import { useProjectStore } from '../../../src/stores/projectStore';
import { protectedVault } from '../../../src/stores/protectedProjectVault';
import { executeToolCall } from '../../../src/services/tools/handlers';
import { injectRagContext } from '../../../src/screens/ChatScreen/useChatGenerationActions';

const enc = (t: string) => `atlasitem:v1:${Buffer.from(t).toString('base64')}`;
const dec = (b: string) => Buffer.from(b.slice(13), 'base64').toString();

beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  (NativeModules as any).AtlasDevice = {
    encryptProtectedItem: async (_k: string, _i: string, plain: string) => enc(plain),
    decryptProtectedItem: async (_k: string, _i: string, blob: string) => dec(blob),
  };
  useProjectStore.setState({ projects: [{ id: 'therapy', name: 'Therapy', description: '', systemPrompt: 'Be kind.',
    pinVerifier: 'pin:v1:123456', protectedBlob: enc('{}'), createdAt: 'x', updatedAt: 'x' } as any] });
  await protectedVault.open('therapy', '123456', 'pin:v1:123456');
});

require('../../utils/registerStores').registerStoreRefs();

it('a document updated in one chat reaches another chat in the same protected project', async () => {
  const update = await executeToolCall({ id: 't1', name: 'update_project_document', context: { projectId: 'therapy' },
    arguments: { name: 'Current Progress', content: 'Week 3: sleeping better after the evening walk routine.', mode: 'append' } } as any);
  expect(update.error).toBeUndefined();
  expect(protectedVault.list('therapy').map((d) => d.name)).toEqual(['Current Progress']);

  // Session 2 (a different chat) asks about progress: the shared document is in its prompt.
  const prompt = await injectRagContext('therapy', 'How has my sleep been going?', 'Be kind.', ['update_project_document']);
  expect(prompt).toContain('Current Progress');
  expect(prompt).toContain('sleeping better after the evening walk routine');
  expect(prompt).toContain('update_project_document');
  expect(prompt).not.toContain('search_knowledge_base'); // not enabled this turn: never mentioned
});

it('appending keeps earlier notes, and nothing is written as a plain file', async () => {
  await executeToolCall({ id: 't2', name: 'update_project_document', context: { projectId: 'therapy' },
    arguments: { name: 'Current Progress', content: 'Week 4: fewer panic moments at work.' } } as any);
  const prompt = await injectRagContext('therapy', 'week 3 sleeping and week 4 work', 'Be kind.');
  expect(prompt).toContain('sleeping better');
  expect(prompt).toContain('fewer panic moments');
  expect(protectedVault.list('therapy')).toHaveLength(1);
  for (const [path, data] of mockFiles) {
    expect(data.startsWith('atlasitem:v1:')).toBe(true); // only the encrypted vault file exists
    expect(path).toMatch(/atlas-protected-docs/);
  }
});

it('a chat outside any project is told there is nothing to update', async () => {
  const r = await executeToolCall({ id: 't3', name: 'update_project_document', arguments: { name: 'x', content: 'y' } } as any);
  expect(r.content).toMatch(/not in a project/);
});
