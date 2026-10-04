/**
 * Image recovery through the real Mobile composition and Shared download owner.
 *
 * The durable Shared journal says that the archive completed, but an app relaunch has pruned the
 * native transfer and only a partial extraction remains on disk. Shared recovers the package as
 * interrupted, and the real Download Manager keeps the image model visible with retry and remove.
 * Fakes stop at the native download and filesystem boundaries.
 */
import type { PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

const MODEL_ID = 'image:anythingv5';
const FILE_NAME = 'anythingv5.zip';
const DOWNLOAD_ID = `${MODEL_ID}/${FILE_NAME}`;
const TRANSFER_ID = 'dl-img';

let applicationFixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = null;
});

function completedImageDownload(): PersistedModelDownload {
  return {
    manifest: {
      id: DOWNLOAD_ID,
      modelId: MODEL_ID,
      kind: 'image',
      revision: 'main',
      artifacts: [
        {
          id: 'primary',
          name: FILE_NAME,
          role: 'primary',
          required: true,
          localName: FILE_NAME,
          url: `https://example.test/${FILE_NAME}`,
          sizeBytes: 900 * 1024 * 1024,
        },
      ],
      metadata: {
        displayName: 'Anything V5',
        catalogEntry: true,
        publicMetadataJson: JSON.stringify({
          imageDownloadType: 'zip',
          imageModelDownloadUrl: `https://example.test/${FILE_NAME}`,
          imageModelName: 'Anything V5',
          imageModelDescription: 'A local image model',
          imageModelSize: 900 * 1024 * 1024,
          imageModelBackend: 'mnn',
        }),
      },
    },
    phase: 'completed',
    artifacts: [
      {
        artifactId: 'primary',
        phase: 'completed',
        transferId: TRANSFER_ID,
        bytesDownloaded: 900 * 1024 * 1024,
        totalBytes: 900 * 1024 * 1024,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

describe('image extraction recovery after relaunch', () => {
  it('renders the incomplete image package with retry and remove actions', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });

    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { seedMobileDownloadJournal, startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    const {
      DownloadManagerScreen,
    } = require('../../../src/screens/DownloadManagerScreen');

    boundary.download!.seedActive({
      downloadId: TRANSFER_ID,
      fileName: FILE_NAME,
      modelId: MODEL_ID,
      modelType: 'image',
      status: 'completed',
      bytesDownloaded: 900 * 1024 * 1024,
      totalBytes: 900 * 1024 * 1024,
    });
    boundary.fs!.seedFile(
      '/docs/image_models/anythingv5/unet.bin',
      300 * 1024 * 1024,
    );
    await seedMobileDownloadJournal([completedImageDownload()]);

    // The OS prunes its completed row on relaunch. The durable Shared journal and partial package stay.
    boundary.download!.simulateRelaunch();
    applicationFixture = await startMobileApplicationFixture();
    await applicationFixture.refreshModels();

    const screen = render(React.createElement(DownloadManagerScreen, {}));

    await waitFor(() => {
      expect(screen.queryByText(FILE_NAME)).not.toBeNull();
    });
    expect(screen.queryByText('Interrupted')).not.toBeNull();
    expect(screen.queryByText('Retry')).not.toBeNull();
    expect(screen.queryByText('Remove')).not.toBeNull();
  });
});
