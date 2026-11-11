import RNFS from 'react-native-fs';
import { NativeModules, Platform } from 'react-native';
import logger from '../utils/logger';

/**
 * Encrypted study outputs (guides, quizzes, games, podcasts...) of a PIN-protected project.
 *
 * Ordinary projects keep study outputs in the plain "atlas-study" store. A protected project
 * keeps them here instead: one file per project, encrypted as a whole with the project's
 * PIN-bound key (kind "project", id "<projectId>-study"). While the project is unlocked they
 * are held in memory in the study store, which never persists protected projects' entries;
 * every change is sealed back into this file. They are dropped from memory on re-lock.
 */
const dir = () => `${RNFS.DocumentDirectoryPath}/atlas-protected-docs`;
const safe = (projectId: string) => projectId.replace(/[^A-Za-z0-9_-]/g, '_');
export const studyVaultPath = (projectId: string) => `${dir()}/${safe(projectId)}.study`;
const itemId = (projectId: string) => `${safe(projectId)}-study`;

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

async function read(projectId: string, pin: string, verifier: string): Promise<any[]> {
  if (!await RNFS.exists(studyVaultPath(projectId))) return [];
  const blob = await RNFS.readFile(studyVaultPath(projectId), 'utf8');
  const parsed = JSON.parse(await native().decryptProtectedItem('project', itemId(projectId), blob, pin, verifier));
  if (parsed?.v !== 1 || !Array.isArray(parsed.results)) throw new Error('Protected study outputs are damaged.');
  return parsed.results;
}

export const protectedStudyVault = {
  /** Encrypts the project's study outputs and verifies the file reads back. */
  seal(projectId: string, key: { pin: string; verifier: string }, results: any[]): Promise<void> {
    const { pin, verifier } = key;
    return serial(async () => {
      const plain = JSON.stringify({ v: 1, results });
      const blob = await native().encryptProtectedItem('project', itemId(projectId), plain, pin, verifier);
      await RNFS.mkdir(dir());
      await RNFS.writeFile(studyVaultPath(projectId), blob, 'utf8');
      if ((await read(projectId, pin, verifier)).length !== results.length)
        throw new Error('Could not verify the protected study output write.');
    });
  },

  /** Decrypts the project's study outputs (empty when it has none). */
  open(projectId: string, pin: string, verifier: string): Promise<any[]> {
    return serial(() => read(projectId, pin, verifier));
  },

  /** Deletes the file and, with the PIN, revokes its key. */
  destroy(projectId: string, pin?: string, verifier?: string): Promise<void> {
    return serial(async () => {
      await RNFS.unlink(studyVaultPath(projectId)).catch(() => undefined);
      if (pin && verifier) {
        await native().removeProtectedItemKey('project', itemId(projectId), pin, verifier)
          .catch((e: unknown) => logger.warn('[StudyVault] could not revoke key', e));
      }
    });
  },
};
