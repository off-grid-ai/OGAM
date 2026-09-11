import { getCuratedLiteRTEntry, LITERT_PARENT_ID, modelsFailureMessage } from '@offgrid/application';
import type { ModelFile } from '../types';
import { makeModelKey } from '../utils/modelKey';
import { applicationFacade } from './applicationFacade';

export interface StartModelDownloadOpts {
  onError?: (error: Error) => void;
}

/** Resolve a synthetic catalogue family to the repository that owns this artifact. */
export function modelDownloadRepositoryId(repositoryId: string, fileName: string): string {
  if (repositoryId !== LITERT_PARENT_ID) return repositoryId;
  return getCuratedLiteRTEntry(fileName)?.hfRepoId ?? repositoryId;
}

/** Queue one selected text artifact. Shared owns duplicate admission and completion. */
export async function startModelDownload(
  repositoryId: string,
  file: ModelFile,
  opts: StartModelDownloadOpts = {},
): Promise<void> {
  const sourceRepositoryId = modelDownloadRepositoryId(repositoryId, file.name);
  const outcome = await applicationFacade().models.control({
    type: 'queue-download',
    modelId: makeModelKey(sourceRepositoryId, file.name),
    selection: { repositoryId: sourceRepositoryId, fileName: file.name },
  });
  if (!outcome.ok) {
    opts.onError?.(new Error(modelsFailureMessage(outcome.failure)));
  }
}
