import { installRealSqlite } from '../../harness/sqliteFake';

const SECRET = 'The vault code is purple-heron-4471 and must stay private.';
const FILE_TEXT = `${SECRET} `.repeat(30);

/** Fresh module graph with a real in-memory SQLite; only the device boundary is faked. */
function boot() {
  installRealSqlite();
  const files = new Map<string, string>();
  const asyncDisk = new Map<string, string>();
  const RNFS = require('react-native-fs');
  RNFS.exists.mockImplementation(async (p: string) => files.has(p));
  RNFS.mkdir.mockImplementation(async () => undefined);
  RNFS.writeFile.mockImplementation(async (p: string, d: string) => { files.set(p, d); });
  RNFS.readFile.mockImplementation(async (p: string) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p); });
  RNFS.unlink.mockImplementation(async (p: string) => { files.delete(p); });
  const AsyncStorage = require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage');
  AsyncStorage.getItem = jest.fn(async (k: string) => asyncDisk.get(k) ?? null);
  AsyncStorage.setItem = jest.fn(async (k: string, v: string) => { asyncDisk.set(k, v); });
  AsyncStorage.removeItem = jest.fn(async (k: string) => { asyncDisk.delete(k); });
  const { NativeModules, Platform } = require('react-native');
  Platform.OS = 'android';
  const enc = (t: string) => 'atlasitem:v1:' + Buffer.from(t).toString('base64');
  const dec = (b: string) => Buffer.from(b.slice('atlasitem:v1:'.length), 'base64').toString();
  NativeModules.AtlasDevice = {
    createChatPinVerifier: async (pin: string) => 'pin:v1:' + pin,
    encryptProtectedItem: async (_k: string, _i: string, plain: string, pin: string, v: string) => {
      if (v !== 'pin:v1:' + pin) throw new Error('Wrong PIN');
      return enc(plain);
    },
    decryptProtectedItem: async (_k: string, _i: string, blob: string, pin: string, v: string) => {
      if (v !== 'pin:v1:' + pin) throw new Error('Wrong PIN');
      return dec(blob);
    },
    removeProtectedItemKey: jest.fn(async () => true),
  };
  jest.doMock('../../../src/services/documentService', () => ({
    documentService: { processDocumentFromPath: async (_p: string, name: string) => ({ textContent: name.startsWith('diary') ? FILE_TEXT : `Other notes. ${'filler text. '.repeat(40)}` }) },
  }));
  jest.doMock('../../../src/services/rag/embedding', () => {
    const vec = (t: string) => new Array(8).fill(0).map((_, i) => Math.sin(i + t.length * 0.1));
    return { embeddingService: { load: async () => undefined, embed: async (t: string) => vec(t), embedBatch: async (ts: string[]) => ts.map(vec), isLoaded: () => true } };
  });
  require('../../utils/registerStores').registerStoreRefs();
  const rag = require('../../../src/services/rag');
  const db = require('../../../src/services/rag/database').ragDatabase;
  const storage = require('../../../src/stores/protectedProjectStorage');
  const { useProjectStore } = require('../../../src/stores/projectStore');
  return { files, asyncDisk, rag, db, storage, useProjectStore, NativeModules, RNFS };
}

const allPlainText = (env: ReturnType<typeof boot>) => [...env.files.values(), ...env.asyncDisk.values()].join('\n');
const sqliteHolds = (env: ReturnType<typeof boot>, text: string) => {
  const rows = env.db.getDb().executeSync('SELECT content FROM rag_chunks').rows as { content: string }[];
  const names = env.db.getDb().executeSync('SELECT name FROM rag_documents').rows as { name: string }[];
  return rows.some(r => r.content.includes(text)) || names.some(n => n.name.includes(text));
};

describe('PIN-protected projects keep their documents encrypted', () => {
  it('moves existing documents into the vault, searches only while unlocked, and never writes plaintext', async () => {
    const env = boot();
    const { ragService } = env.rag;
    const project = env.useProjectStore.getState().createProject({ name: 'Locked project', description: '', systemPrompt: 'x' });
    await ragService.indexDocument({ projectId: project.id, filePath: '/mock/documents/diary.txt', fileName: 'diary.txt', fileSize: 100 });
    expect(sqliteHolds(env, 'purple-heron-4471')).toBe(true); // plain while the project is ordinary

    await env.storage.protectProject(project.id, '123456');
    expect(sqliteHolds(env, 'purple-heron-4471')).toBe(false);
    expect(sqliteHolds(env, 'diary.txt')).toBe(false);
    expect(allPlainText(env)).not.toContain('purple-heron-4471');
    expect(allPlainText(env)).not.toContain('diary.txt');
    expect([...env.files.keys()].some(k => k.includes('atlas-protected-docs'))).toBe(true);
    expect(await ragService.getDocumentsByProject(project.id)).toEqual([]); // locked: nothing listed
    expect((await ragService.searchProject(project.id, 'vault code')).chunks).toEqual([]);

    await env.storage.unlockProject(project.id, '123456');
    const docs = await ragService.getDocumentsByProject(project.id);
    expect(docs.map((d: any) => d.name)).toEqual(['diary.txt']);
    const found = await ragService.searchProject(project.id, 'vault code');
    expect(found.chunks[0].content).toContain('purple-heron-4471');

    // Adding another document while unlocked: encrypted file only, no rag.db rows, no plain copy.
    await ragService.indexDocument({ projectId: project.id, filePath: '/mock/documents/notes.txt', fileName: 'notes.txt', fileSize: 50 });
    expect(sqliteHolds(env, 'filler text')).toBe(false);
    expect(sqliteHolds(env, 'notes.txt')).toBe(false);
    expect(allPlainText(env)).not.toContain('filler text');
    expect(env.RNFS.unlink).toHaveBeenCalledWith('/mock/documents/notes.txt');
    expect((await ragService.getDocumentsByProject(project.id)).length).toBe(2);

    // Toggle and delete work through the same ids the screens use.
    const notes = (await ragService.getDocumentsByProject(project.id)).find((d: any) => d.name === 'notes.txt');
    await ragService.toggleDocument(notes.id, false);
    expect((await ragService.getDocumentsByProject(project.id)).find((d: any) => d.name === 'notes.txt').enabled).toBe(0);
    await ragService.deleteDocument(notes.id);
    expect((await ragService.getDocumentsByProject(project.id)).map((d: any) => d.name)).toEqual(['diary.txt']);

    // Re-locking forgets the decrypted copy.
    await env.storage.relockProjects();
    expect(await ragService.getDocumentsByProject(project.id)).toEqual([]);
    await expect(ragService.indexDocument({ projectId: project.id, filePath: '/mock/documents/diary2.txt', fileName: 'diary2.txt', fileSize: 1 }))
      .rejects.toThrow(/Unlock/);
  });

  it('puts documents back in the plain index only when protection is permanently removed', async () => {
    const env = boot();
    const { ragService } = env.rag;
    const project = env.useProjectStore.getState().createProject({ name: 'Temp', description: '', systemPrompt: 'x' });
    await ragService.indexDocument({ projectId: project.id, filePath: '/mock/documents/diary.txt', fileName: 'diary.txt', fileSize: 100 });
    await env.storage.protectProject(project.id, '123456');
    await env.storage.unlockProject(project.id, '123456');
    await env.storage.permanentlyUnprotectProject(project.id, '123456');
    expect(sqliteHolds(env, 'purple-heron-4471')).toBe(true);
    expect((await ragService.getDocumentsByProject(project.id)).map((d: any) => d.name)).toEqual(['diary.txt']);
    expect([...env.files.keys()].some(k => k.includes('atlas-protected-docs'))).toBe(false);
    expect(env.NativeModules.AtlasDevice.removeProtectedItemKey).toHaveBeenCalledTimes(3); // project, documents and study-outputs keys
  });

  it('does not unlock documents with a wrong PIN', async () => {
    const env = boot();
    const { ragService } = env.rag;
    const project = env.useProjectStore.getState().createProject({ name: 'Temp', description: '', systemPrompt: 'x' });
    await ragService.indexDocument({ projectId: project.id, filePath: '/mock/documents/diary.txt', fileName: 'diary.txt', fileSize: 100 });
    await env.storage.protectProject(project.id, '123456');
    await expect(env.storage.unlockProject(project.id, '000000')).rejects.toThrow();
    expect(await ragService.getDocumentsByProject(project.id)).toEqual([]);
  });
});
