// Composition root: shared download services over Mobile's native transfer, file, and store ports.
import {
  ModelDownloadProjectionController,
  type DownloadProjectionEntry,
} from '@offgrid/models';

export const createModelDownloadProjection = <Entry extends DownloadProjectionEntry>(
  ...ports: ConstructorParameters<typeof ModelDownloadProjectionController<Entry>>
): ModelDownloadProjectionController<Entry> =>
  new ModelDownloadProjectionController<Entry>(...ports);
