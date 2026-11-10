import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, NativeModules, Platform } from 'react-native';
import type { Project } from '../types';
import { protectedVault } from './protectedProjectVault';
import { protectedStudyVault } from './protectedStudyVault';
import logger from '../utils/logger';

/** Selective encryption of a project's metadata and its documents. Document text, names and
 * embeddings live in an encrypted per-project vault (protectedProjectVault), never in rag.db;
 * study outputs in protectedStudyVault; the project's chats are sealed with the same PIN. */
const KEY = 'local-llm-project-storage';
const pins = new Map<string, string>();
const blobs = new Map<string, string>();
const lastEncrypted = new Map<string, string>();
let pending: Promise<void> = Promise.resolve();
const queue = (job: () => Promise<void>): Promise<void> => {
  const current = pending.then(job);
  pending = current.catch(() => undefined);
  return current;
};
const native = () => {
  const mod = NativeModules.AtlasDevice;
  if (Platform.OS !== 'android' || !mod?.encryptProtectedItem || !mod?.decryptProtectedItem)
    throw new Error('Updated Android Atlas encryption is required.');
  return mod as {
    createChatPinVerifier(pin: string): Promise<string>;
    encryptProtectedItem(kind: string, id: string, plain: string, pin: string, verifier: string): Promise<string>;
    decryptProtectedItem(kind: string, id: string, blob: string, pin: string, verifier: string): Promise<string>;
    removeProtectedItemKey(kind: string, id: string, pin: string, verifier: string): Promise<boolean>;
    verifyChatPin(pin: string, verifier: string): Promise<boolean>;
    encryptPortableBackup(plain: string, passphrase: string): Promise<string>;
    decryptPortableBackup(blob: string, passphrase: string): Promise<string>;
  };
};
/** Portable (backup) ciphertext: sealed with a key derived from the project's PIN, not this phone. */
const PORTABLE = 'atlasbackup:v1:';
const portablePass = (pin: string, id: string) => `${pin}:atlas-protected-project:${id}`;
/** True while a protected project is open (its PIN is in memory this session). */
export const isProtectedProjectOpen = (id: string): boolean => pins.has(id);

export const isPortableProjectBlob = (blob: unknown): boolean => typeof blob === 'string' && blob.startsWith(PORTABLE);
const clearSecurity = (p: Project): Project => {
  const { pinVerifier: _pinVerifier, protectedBlob: _protectedBlob, ...rest } = p;
  return rest as Project;
};
const stub = (p: Project, blob: string): Project => ({
  id: p.id, name: 'Locked project', description: '',
  systemPrompt: '', createdAt: p.createdAt, updatedAt: p.updatedAt,
  pinVerifier: p.pinVerifier, protectedBlob: blob,
});
const seal = async (raw: string, reencryptUnlocked = true): Promise<string> => {
  const root = JSON.parse(raw);
  if (!Array.isArray(root?.state?.projects)) throw new Error('Invalid project persistence data.');
  const projects: Project[] = [];
  for (const p of root.state.projects as Project[]) {
    if (!p.pinVerifier) { projects.push(clearSecurity(p)); continue; }
    let blob = blobs.get(p.id) || p.protectedBlob;
    const pin = pins.get(p.id);
    const plain = JSON.stringify(clearSecurity(p));
    if (pin && reencryptUnlocked && (!blob || lastEncrypted.get(p.id) !== plain)) {
      blob = await native().encryptProtectedItem('project', p.id, plain, pin, p.pinVerifier);
      blobs.set(p.id, blob); lastEncrypted.set(p.id, plain);
    }
    if (!blob) throw new Error('Project is PIN-marked but not encrypted. Refusing plaintext persistence.');
    projects.push(stub(p, blob));
  }
  root.state.projects = projects;
  return JSON.stringify(root);
};
async function writeReplacement(id: string, project: Project): Promise<void> {
  return queue(async () => {
    const text = await AsyncStorage.getItem(KEY);
    if (!text) throw new Error('Project is not saved yet. Retry when saving finishes.');
    const root = JSON.parse(text);
    const index = root.state.projects.findIndex((p: Project) => p.id === id);
    if (index < 0) throw new Error('Project was not found in saved data.');
    root.state.projects[index] = project;
    const protectedText = await seal(JSON.stringify(root), false);
    await AsyncStorage.setItem(KEY, protectedText);
    if (await AsyncStorage.getItem(KEY) !== protectedText) throw new Error('Could not verify protected project write.');
  });
}
export function isProtectedProjectUnlocked(id: string): boolean {
  return pins.has(id);
}
/** The PIN of an unlocked project, kept in memory only. For the document vault. */
export function unlockedProjectPin(id: string): string | undefined {
  return pins.get(id);
}
export async function protectProject(id: string, pin: string): Promise<void> {
  const { useProjectStore } = require('./projectStore');
  const { useChatStore } = require('./chatStore');
  const { useStudyStore } = require('../study/engine');
  const { ragService } = require('../services/rag');
  await pending;
  const project: Project | undefined = useProjectStore.getState().projects.find((p: Project) => p.id === id);
  if (!project || project.pinVerifier) throw new Error('Choose an existing unprotected project.');
  // The project's chats are encrypted with the same PIN first (each write is verified), so
  // nothing in the project stays readable once it locks. A chat that already has its own PIN
  // stays sealed under it. If one fails, the project is not locked; protecting again resumes.
  const { protectChat } = require('./encryptedChatStorage');
  const chats = useChatStore.getState().conversations
    .filter((c: any) => c.projectId === id && !c.isPrivate && !c.pinVerifier);
  for (const chat of chats) await protectChat(chat.id, pin);
  const api = native();
  const verifier = await api.createChatPinVerifier(pin);
  const plain = JSON.stringify(clearSecurity(project));
  const blob = await api.encryptProtectedItem('project', id, plain, pin, verifier);
  if (await api.decryptProtectedItem('project', id, blob, pin, verifier) !== plain) throw new Error('Project encryption verification failed.');
  // Existing documents move into the encrypted vault first; the plain index is erased only after
  // the vault is written, read back and the project record is saved as locked.
  const docs = await ragService.exportProjectDocuments(id);
  if (docs.length) await protectedVault.seal(id, { pin, verifier }, docs);
  // Study outputs move into their own encrypted file the same way, verified before locking.
  const study = useStudyStore.getState().saved[id] || [];
  if (study.length) await protectedStudyVault.seal(id, { pin, verifier }, study);
  const locked = stub({ ...project, pinVerifier: verifier }, blob);
  try {
    await writeReplacement(id, locked);
  } catch (e) {
    await protectedVault.destroy(id, pin, verifier);
    await protectedStudyVault.destroy(id, pin, verifier);
    throw e;
  }
  blobs.set(id, blob); pins.delete(id); lastEncrypted.delete(id);
  useProjectStore.setState((s: any) => ({ projects: s.projects.map((p: Project) => p.id === id ? locked : p) }));
  // The project is now PIN-marked, so this write drops its outputs from plain study storage.
  dropStudyFromMemory([id]);
  // The project is locked and its vault verified; now erase the plain index. If this fails the
  // user is told, and protecting again retries the erase (the vault is rewritten from rag.db).
  try { await ragService.eraseProjectDocumentsFromIndex(id); }
  catch (e) { throw new Error(`The project is protected, but its old plain document index could not be erased (${e instanceof Error ? e.message : e}). Unlock and protect it again to retry.`); }
}
/** Removes protected projects' study outputs from memory (their encrypted files stay). */
function dropStudyFromMemory(ids: string[]): void {
  const { useStudyStore } = require('../study/engine');
  useStudyStore.setState((s: any) => {
    const saved = { ...s.saved };
    ids.forEach((pid) => { delete saved[pid]; });
    return { saved };
  });
}

let studySealer: (() => void) | null = null;
/** While a protected project is unlocked, every change to its study outputs is re-encrypted. */
function watchProtectedStudy(): void {
  if (studySealer) return;
  const { useStudyStore } = require('../study/engine');
  const { useProjectStore } = require('./projectStore');
  studySealer = useStudyStore.subscribe((state: any, prev: any) => {
    for (const [pid, pin] of pins) {
      if (state.saved[pid] === prev.saved[pid]) continue;
      const verifier = useProjectStore.getState().projects.find((p: Project) => p.id === pid)?.pinVerifier;
      if (!verifier) continue;
      protectedStudyVault.seal(pid, { pin, verifier }, state.saved[pid] || [])
        .catch((e) => logger.error('[ProtectedProject] study outputs could not be saved', e));
    }
  });
}

/** Decrypts the project's study outputs into memory (never into plain storage). */
async function openProjectStudy(id: string, pin: string, verifier: string): Promise<void> {
  try {
    const results = await protectedStudyVault.open(id, pin, verifier);
    if (pins.get(id) !== pin) return; // re-locked while decrypting
    const { useStudyStore } = require('../study/engine');
    // Set before watching, so opening the outputs does not re-encrypt them.
    useStudyStore.setState((s: any) => ({ saved: { ...s.saved, [id]: results } }));
    watchProtectedStudy();
  } catch (e) { logger.error('[ProtectedProject] study outputs could not be opened', e); }
}

/**
 * Opens the project's locked chats that use the same PIN (chats with their own PIN stay
 * locked), and seals any of its chats that are still plain (e.g. the app closed before a
 * new chat was sealed) so they are encrypted from now on.
 */
async function unlockProjectChats(id: string, pin: string): Promise<void> {
  const { useChatStore } = require('./chatStore');
  const { unlockChat, isChatUnlocked, protectChat } = require('./encryptedChatStorage');
  const chats = useChatStore.getState().conversations.filter((c: any) => c.projectId === id && !c.isPrivate);
  for (const chat of chats) {
    try {
      if (!chat.pinVerifier) await protectChat(chat.id, pin);
      else if (isChatUnlocked(chat.id)) continue;
      await unlockChat(chat.id, pin);
    } catch { /* different PIN, or not saved yet: left as it is */ }
  }
}

const SEAL_RETRIES = 20;
const SEAL_RETRY_MS = 250;
/**
 * Seals a chat just created inside an unlocked protected project with the project PIN, then
 * reopens it for this session. Retries while the new chat is still being saved.
 */
export async function sealNewProjectChat(chatId: string, projectId: string): Promise<void> {
  const { protectChat, unlockChat } = require('./encryptedChatStorage');
  for (let attempt = 0; attempt < SEAL_RETRIES; attempt++) {
    const pin = pins.get(projectId);
    if (!pin) return; // project re-locked: sealed on the next unlock instead
    try {
      await protectChat(chatId, pin);
      await unlockChat(chatId, pin);
      return;
    } catch (e) {
      if (!/not yet saved|missing from saved data/i.test(String((e as Error)?.message))) {
        logger.error('[ProtectedProject] new chat could not be sealed', e);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, SEAL_RETRY_MS));
    }
  }
}
async function decryptProject(p: Project, pin: string): Promise<Project> {
  if (!p.pinVerifier || !p.protectedBlob) throw new Error('Project is not protected.');
  const blob = blobs.get(p.id) || p.protectedBlob;
  const text = await native().decryptProtectedItem('project', p.id, blob, pin, p.pinVerifier);
  const decrypted = JSON.parse(text) as Project;
  if (decrypted.id !== p.id || typeof decrypted.systemPrompt !== 'string') throw new Error('Protected project data is invalid.');
  return decrypted;
}
/**
 * Unlocked protected projects sealed for an encrypted backup: record, documents and study
 * outputs in one blob keyed by the project's PIN, so they open on a new phone with that PIN.
 * Projects still locked are skipped (there is no PIN in memory to seal them with).
 */
export async function openProtectedProjectsForBackup(): Promise<Project[]> {
  await pending;
  const { useProjectStore } = require('./projectStore');
  const out: Project[] = [];
  for (const [id, pin] of pins) {
    const p: Project | undefined = useProjectStore.getState().projects.find((x: Project) => x.id === id);
    if (!p?.pinVerifier) continue;
    const docs = await protectedVault.readAll(id, pin, p.pinVerifier);
    const study = await protectedStudyVault.open(id, pin, p.pinVerifier);
    const plain = JSON.stringify({ v: 1, project: clearSecurity(p), docs, study });
    out.push(stub(p, await native().encryptPortableBackup(plain, portablePass(pin, id))));
  }
  return out;
}

/** First unlock of a project restored from a backup: move it from PIN-derived to on-phone keys. */
async function adoptPortableProject(p: Project, pin: string): Promise<void> {
  const api = native();
  if (!p.pinVerifier || !await api.verifyChatPin(pin, p.pinVerifier)) throw new Error('Incorrect PIN.');
  const payload = JSON.parse(await api.decryptPortableBackup(p.protectedBlob!, portablePass(pin, p.id)));
  if (payload?.v !== 1 || payload.project?.id !== p.id) throw new Error('Protected project backup is damaged.');
  if (Array.isArray(payload.docs) && payload.docs.length) await protectedVault.seal(p.id, { pin, verifier: p.pinVerifier }, payload.docs);
  if (Array.isArray(payload.study) && payload.study.length) await protectedStudyVault.seal(p.id, { pin, verifier: p.pinVerifier }, payload.study);
  const plain = JSON.stringify(clearSecurity(payload.project));
  const blob = await api.encryptProtectedItem('project', p.id, plain, pin, p.pinVerifier);
  await writeReplacement(p.id, stub(p, blob));
  blobs.set(p.id, blob);
}

export async function unlockProject(id: string, pin: string): Promise<void> {
  await pending;
  const { useProjectStore } = require('./projectStore');
  const p: Project | undefined = useProjectStore.getState().projects.find((x: Project) => x.id === id);
  if (!p) throw new Error('Project not found.');
  // A record restored from a backup wins over any cached on-phone ciphertext of an older copy.
  if (isPortableProjectBlob(p.protectedBlob)) { blobs.delete(id); await adoptPortableProject(p, pin); }
  const original = await decryptProject(p, pin);
  pins.set(id, pin); lastEncrypted.set(id, JSON.stringify(clearSecurity(original)));
  try { await protectedVault.open(id, pin, p.pinVerifier!); }
  catch (e) { logger.error('[ProtectedProject] documents could not be opened', e); } // the project still opens; its documents stay hidden
  await unlockProjectChats(id, pin);
  await openProjectStudy(id, pin, p.pinVerifier!);
  useProjectStore.setState((s: any) => ({ projects: s.projects.map((x: Project) => x.id === id
    ? { ...original, pinVerifier: p.pinVerifier, protectedBlob: blobs.get(id) || p.protectedBlob } : x) }));
}
export async function permanentlyUnprotectProject(id: string, pin: string): Promise<void> {
  await pending;
  const { useProjectStore } = require('./projectStore');
  const p: Project | undefined = useProjectStore.getState().projects.find((x: Project) => x.id === id);
  if (!p || !p.pinVerifier) throw new Error('Project is not protected.');
  const decrypted = await decryptProject(p, pin);
  const { ragService } = require('../services/rag');
  const docs = await protectedVault.readAll(id, pin, p.pinVerifier);
  await ragService.importProjectDocuments(id, docs); // back into the plain index, before the project is opened up
  try {
    await writeReplacement(id, clearSecurity(decrypted));
  } catch (e) {
    await ragService.eraseProjectDocumentsFromIndex(id).catch(() => undefined); // still protected: no plain copies
    throw e;
  }
  const study = await protectedStudyVault.open(id, pin, p.pinVerifier);
  await protectedVault.destroy(id, pin, p.pinVerifier);
  pins.delete(id); blobs.delete(id); lastEncrypted.delete(id);
  useProjectStore.setState((s: any) => ({ projects: s.projects.map((x: Project) => x.id === id ? decrypted : x) }));
  // No longer protected: its outputs go back to ordinary study storage, then the vault goes.
  const { useStudyStore } = require('../study/engine');
  useStudyStore.setState((s: any) => ({ saved: { ...s.saved, [id]: study } }));
  await protectedStudyVault.destroy(id, pin, p.pinVerifier);
  await native().removeProtectedItemKey('project', id, pin, p.pinVerifier);
}
export async function relockProjects(): Promise<void> {
  await pending;
  const { useProjectStore } = require('./projectStore');
  if (useProjectStore.persist?.hasHydrated?.() === false) return;
  const projects = useProjectStore.getState().projects;
  await protectedProjectStorage.setItem(KEY, JSON.stringify({ state: { projects }, version: 0 }));
  const unlocked = [...pins.keys()];
  pins.clear(); lastEncrypted.clear();
  protectedVault.closeAll();
  dropStudyFromMemory(unlocked);
  useProjectStore.setState((s: any) => ({ projects: s.projects.map((p: Project) => p.pinVerifier
    ? stub(p, blobs.get(p.id) || p.protectedBlob || '') : p) }));
}
if (Platform.OS === 'android') AppState.addEventListener('change', state => {
  if (state !== 'active') void relockProjects().catch(() => undefined);
});
export const protectedProjectStorage = {
  async getItem(key: string): Promise<string | null> {
    if (key !== KEY) throw new Error('Unexpected project storage key.');
    await pending;
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const safe = await seal(raw, false);
    if (safe !== raw) await AsyncStorage.setItem(KEY, safe);
    const parsed = JSON.parse(safe);
    parsed.state.projects.forEach((p: Project) => { if (p.protectedBlob) blobs.set(p.id, p.protectedBlob); });
    return safe;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (key !== KEY) throw new Error('Unexpected project storage key.');
    return queue(async () => {
      const safe = await seal(value);
      if (await AsyncStorage.getItem(KEY) !== safe) await AsyncStorage.setItem(KEY, safe);
    });
  },
  async removeItem(key: string): Promise<void> {
    if (key !== KEY) throw new Error('Unexpected project storage key.');
    return queue(async () => {
      await AsyncStorage.removeItem(KEY);
      pins.clear(); blobs.clear(); lastEncrypted.clear();
    });
  },
};
