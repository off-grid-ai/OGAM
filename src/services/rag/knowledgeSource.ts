import { ragDatabase } from './database';
import { protectedVault } from '../../stores/protectedProjectVault';

/** True when the project's documents live in its encrypted vault instead of rag.db. */
export function isProtectedProject(projectId: string): boolean {
  try {
    const useProjectStore = require('../../stores/storeRefs').projectStoreRef();
    return !!useProjectStore.getState().getProject?.(projectId)?.pinVerifier;
  } catch { return false; }
}

/**
 * Where a project's document chunks are read from: rag.db for a normal project, the in-memory
 * decrypted vault for a protected one (empty while it is locked). One place decides, so retrieval
 * and the study tools never touch rag.db for a protected project.
 */
export function knowledgeSource(projectId: string): Pick<typeof ragDatabase, 'getEmbeddingsByProject' | 'getChunksByProject'> {
  return isProtectedProject(projectId)
    ? (protectedVault as unknown as Pick<typeof ragDatabase, 'getEmbeddingsByProject' | 'getChunksByProject'>)
    : ragDatabase;
}
