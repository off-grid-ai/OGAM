// Composition root: shared download services over Mobile's native transfer, file, and store ports.
//
// The download APPLICATION is not composed here. `@offgrid/application` owns the one download
// control plane, reached through `applicationFacade().models` - so this file holds the render-side
// projection controller and nothing that admits, queues, or retries a transfer.
import {
  ModelDownloadProjectionController,
  type DownloadProjectionEntry,
} from '@offgrid/models';

export const createModelDownloadProjection = <Entry extends DownloadProjectionEntry>(
  ...ports: ConstructorParameters<typeof ModelDownloadProjectionController<Entry>>
): ModelDownloadProjectionController<Entry> =>
  new ModelDownloadProjectionController<Entry>(...ports);
