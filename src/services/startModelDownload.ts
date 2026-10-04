import { modelsFailureMessage } from '@offgrid/application';
import type { ModelFile } from '../types';
import { makeModelKey } from '../utils/modelKey';
import { applicationFacade } from './applicationFacade';

export interface StartModelDownloadOpts {
  onError?: (error: Error) => void;
}

/** Queue one selected text artifact. Shared owns duplicate admission and completion. */
export async function startModelDownload(
  repositoryId: string,
  file: ModelFile,
  opts: StartModelDownloadOpts = {},
): Promise<void> {
  const outcome = await applicationFacade().models.control({
    type: 'queue-download',
    modelId: makeModelKey(repositoryId, file.name),
    selection: { repositoryId, fileName: file.name },
  });
  if (!outcome.ok) {
    opts.onError?.(new Error(modelsFailureMessage(outcome.failure)));
  }
}
