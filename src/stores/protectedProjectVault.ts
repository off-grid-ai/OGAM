import RNFS from 'react-native-fs';
import { NativeModules, Platform } from 'react-native';
import logger from '../utils/logger';
import type { RagDocument } from '../services/rag/database';

/**
 * Encrypted document vault for a PIN-protected project.
 *
 * A normal project keeps its knowledge base (document names, text chunks, embeddings) in the
 * plain rag.db. A protected project keeps all of it here instead: one JSON file per project,
 * encrypted as a whole with the project's PIN-bound key (kind "project", id "<projectId>-docs").
 * Nothing about its documents is written to rag.db or AsyncStorage. The decrypted copy lives in
 * memory only while the project is unlocked and is dropped when it re-locks.
 */
export interface VaultChunk { content: string; position: number; embedding: number[] }
export interface VaultDoc {
  id: number; name: string; path: string; size: number; createdAt: string; enabled: number; chunks: VaultChunk[];
  /** Exact text of a note written in Atlas (chunks alone drop spacing and overlap long paragraphs). */
  text?: string;
}
export interface VaultEmbeddingRow {
  chunk_rowid: number; doc_id: number; name: string; content: string; position: number; embedding: number[];
}
export type NewVaultDoc = Pick<VaultDoc, 'name' | 'path' | 'size' | 'chunks' | 'text'>;

const open = new Map<string, VaultDoc[]>();
let seq = 0;
/** Vault documents get negative ids so they can never collide with rag.db row ids. */
export const newVaultDocId = (): number => -(Date.now() * 1000 + (seq++ % 1000));
export const isVaultDocId = (id: number): boolean => id < 0;

const dir = () => `${RNFS.DocumentDirectoryPath}/atlas-protected-docs`;
const filePath = (projectId: string) => `${dir()}/${projectId.replace(/[^A-Za-z0-9_-]/g, '_')}.vault`;
const itemId = (projectId: string) => `${projectId.replace(/[^A-Za-z0-9_-]/g, '_')}-docs`;

const native = () => {
  const mod = NativeModules.AtlasDevice;
  if (Platform.OS !== 'android' || !mod?.encryptProtectedItem || !mod?.decryptProtectedItem)
    throw new Error('Updated Android Atlas encryption is required.');
  return mod as {
    encryptProtectedItem(kind: string, id: string, plain: string, pin: string, verifier: string): Promise<string>;
    decryptProtectedItem(kind: string, id: string, blob: string, pin: string, verifier: string): Promise<string>;
    removeProtectedItemKey(kind: string, id: string, pin: string, verifier: string): Promise<boolean>;
  };
};

let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
};

function credentials(projectId: string): { pin: string; verifier: string } {
  const { useProjectStore } = require('./projectStore');
  const { unlockedProjectPin } = require('./protectedProjectStorage');
  const project = useProjectStore.getState().projects.find((p: any) => p.id === projectId);
  const pin: string | undefined = unlockedProjectPin(projectId);
  if (!project?.pinVerifier || !pin) throw new Error('Unlock this project first.');
  return { pin, verifier: project.pinVerifier };
}

const round = (v: number[]) => v.map(x => Math.round(x * 1e5) / 1e5);

async function writeFile(projectId: string, docs: VaultDoc[], key: { pin: string; verifier: string }): Promise<void> {
  const { pin, verifier } = key;
  const plain = JSON.stringify({ v: 1, docs: docs.map(d => ({ ...d, chunks: d.chunks.map(c => ({ ...c, embedding: round(c.embedding) })) })) });
  const blob = await native().encryptProtectedItem('project', itemId(projectId), plain, pin, verifier);
  await RNFS.mkdir(dir());
  await RNFS.writeFile(filePath(projectId), blob, 'utf8');
  if (await RNFS.readFile(filePath(projectId), 'utf8') !== blob) throw new Error('Could not verify the protected document write.');
}

async function readFile(projectId: string, pin: string, verifier: string): Promise<VaultDoc[]> {
  if (!await RNFS.exists(filePath(projectId))) return [];
  const blob = await RNFS.readFile(filePath(projectId), 'utf8');
  const plain = await native().decryptProtectedItem('project', itemId(projectId), blob, pin, verifier);
  const parsed = JSON.parse(plain);
  if (parsed?.v !== 1 || !Array.isArray(parsed.docs)) throw new Error('Protected documents are damaged.');
  return parsed.docs as VaultDoc[];
}

const asRag = (projectId: string, d: VaultDoc): RagDocument => ({
  id: d.id, project_id: projectId, name: d.name, path: d.path, size: d.size, created_at: d.createdAt, enabled: d.enabled,
});

export const protectedVault = {
  isOpen: (projectId: string): boolean => open.has(projectId),

  /** Decrypts the project's documents into memory. Called when the project is unlocked. */
  async open(projectId: string, pin: string, verifier: string): Promise<void> {
    await serial(async () => {
      const docs = await readFile(projectId, pin, verifier);
      // The project may have re-locked while the file was being decrypted: keep nothing in memory then.
      const { unlockedProjectPin } = require('./protectedProjectStorage');
      if (unlockedProjectPin(projectId) === pin) open.set(projectId, docs);
    });
  },

  /** Forgets every decrypted document (the encrypted files stay). Called when projects re-lock. */
  closeAll(): void { open.clear(); },

  list(projectId: string): RagDocument[] {
    return (open.get(projectId) ?? []).map(d => asRag(projectId, d)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  /** The exact text of a note written in Atlas, if this document is one. */
  noteText(docId: number): string | undefined {
    for (const docs of open.values()) {
      const d = docs.find(x => x.id === docId);
      if (d) return d.text;
    }
    return undefined;
  },

  ownerOf(docId: number): string | undefined {
    for (const [pid, docs] of open) if (docs.some(d => d.id === docId)) return pid;
    return undefined;
  },

  async addDocument(projectId: string, doc: NewVaultDoc): Promise<number> {
    return serial(async () => {
      const { pin, verifier } = credentials(projectId);
      const docs = open.get(projectId);
      if (!docs) throw new Error('This project\'s documents are not open. Lock and unlock the project, then try again.');
      const added: VaultDoc = { ...doc, id: newVaultDocId(), createdAt: new Date().toISOString(), enabled: 1 };
      const next = [...docs, added];
      await writeFile(projectId, next, { pin, verifier }); // on disk first, then in memory
      open.set(projectId, next);
      return added.id;
    });
  },

  async setEnabled(docId: number, enabled: boolean): Promise<void> {
    await serial(async () => {
      const projectId = protectedVault.ownerOf(docId);
      if (!projectId) throw new Error('Unlock this project first.');
      const { pin, verifier } = credentials(projectId);
      const next = open.get(projectId)!.map(d => (d.id === docId ? { ...d, enabled: enabled ? 1 : 0 } : d));
      await writeFile(projectId, next, { pin, verifier });
      open.set(projectId, next);
    });
  },

  /** Removes one document; resolves it so the caller can delete its on-phone copy. */
  async remove(docId: number): Promise<VaultDoc | undefined> {
    return serial(async () => {
      const projectId = protectedVault.ownerOf(docId);
      if (!projectId) throw new Error('Unlock this project first.');
      const { pin, verifier } = credentials(projectId);
      const docs = open.get(projectId)!;
      const gone = docs.find(d => d.id === docId);
      const next = docs.filter(d => d.id !== docId);
      await writeFile(projectId, next, { pin, verifier });
      open.set(projectId, next);
      return gone;
    });
  },

  /** Same shape as ragDatabase.getEmbeddingsByProject, from memory. Empty while locked. */
  getEmbeddingsByProject(projectId: string): VaultEmbeddingRow[] {
    const out: VaultEmbeddingRow[] = [];
    for (const d of open.get(projectId) ?? []) {
      if (!d.enabled) continue;
      d.chunks.forEach((c, i) => out.push({ chunk_rowid: i, doc_id: d.id, name: d.name, content: c.content, position: c.position, embedding: c.embedding }));
    }
    return out;
  },

  getChunksByProject(projectId: string, topK = 5) {
    const out: { doc_id: number; name: string; content: string; position: number; score: number }[] = [];
    for (const d of open.get(projectId) ?? []) {
      if (!d.enabled) continue;
      for (const c of d.chunks) out.push({ doc_id: d.id, name: d.name, content: c.content, position: c.position, score: 0 });
    }
    return out.sort((a, b) => a.position - b.position).slice(0, topK);
  },

  /** Writes documents moved in from rag.db (protecting a project that already has some) and proves they decrypt. */
  async seal(projectId: string, key: { pin: string; verifier: string }, docs: VaultDoc[]): Promise<void> {
    await serial(async () => {
      await writeFile(projectId, docs, key);
      const back = await readFile(projectId, key.pin, key.verifier);
      if (back.length !== docs.length) throw new Error('Protected document verification failed.');
    });
  },

  /** Decrypts everything (removing protection moves it back into rag.db). */
  readAll(projectId: string, pin: string, verifier: string): Promise<VaultDoc[]> {
    return serial(() => readFile(projectId, pin, verifier));
  },

  /** Erases the vault file, forgets it, and revokes its key. */
  async destroy(projectId: string, pin?: string, verifier?: string): Promise<void> {
    await serial(async () => {
      open.delete(projectId);
      await RNFS.unlink(filePath(projectId)).catch(() => undefined);
      if (pin && verifier) {
        await native().removeProtectedItemKey('project', itemId(projectId), pin, verifier).catch((e: unknown) => logger.warn('[Vault] could not revoke key', e));
      }
    });
  },
};
