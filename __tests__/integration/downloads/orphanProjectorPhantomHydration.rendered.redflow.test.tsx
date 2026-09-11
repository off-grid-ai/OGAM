/**
 * A projector sidecar is an artifact of a vision-model download. It must not
 * become a standalone card when Mobile recovers native work after relaunch.
 *
 * The durable Shared journal is the lifecycle source of truth. Native rows are
 * platform facts, and the rendered Mobile screen consumes the Shared projection.
 */
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary, MB, requireRTL} from '../../harness/nativeBoundary';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

describe('orphaned projector sidecar recovery', () => {
  it('does not render a projector sidecar as a model download card', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    const React = require('react');
    const {render, waitFor} = requireRTL();
    const {DownloadManagerScreen} = require('../../../src/screens/DownloadManagerScreen');
    const {
      seedMobileDownloadJournal,
      startMobileApplicationFixture,
    } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');

    const modelFileName = 'gemma-4-E2B-it-Q4_K_M.gguf';
    const projectorFileName = 'gemma-4-E2B-it-projector.gguf';

    boundary.download!.seedActive({
      downloadId: 'dl-model',
      fileName: modelFileName,
      modelId: 'unsloth/gemma-4-E2B-it-GGUF',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 500 * MB,
      totalBytes: 1000 * MB,
    });
    // This native task has no durable Shared owner. A retry left it without a
    // parent link, so it must not become an independent model download.
    boundary.download!.seedActive({
      downloadId: 'dl-projector',
      fileName: projectorFileName,
      modelId: 'unsloth/gemma-4-E2B-it-GGUF',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 100 * MB,
      totalBytes: 200 * MB,
    });

    await seedMobileDownloadJournal([{
      manifest: {
        id: 'unsloth/gemma-4-E2B-it-GGUF',
        modelId: 'unsloth/gemma-4-E2B-it-GGUF',
        kind: 'text',
        revision: 'main',
        artifacts: [{
          id: 'primary',
          name: modelFileName,
          role: 'primary',
          required: true,
          localName: modelFileName,
          url: `https://example.test/${modelFileName}`,
        }],
      },
      phase: 'downloading',
      artifacts: [{
        artifactId: 'primary',
        phase: 'downloading',
        transferId: 'dl-model',
        bytesDownloaded: 500 * MB,
        totalBytes: 1000 * MB,
      }],
      createdAt: 1,
      updatedAt: 1,
      attempt: 1,
    }]);

    fixture = await startMobileApplicationFixture();
    await fixture.refreshModels();

    const view = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => {
      expect(view.queryByText('Download Manager')).not.toBeNull();
      expect(view.queryByText(modelFileName)).not.toBeNull();
    });
    expect(view.queryByText(projectorFileName)).toBeNull();
  });
});
