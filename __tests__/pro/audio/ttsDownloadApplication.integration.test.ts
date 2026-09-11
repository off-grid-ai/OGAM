import { installNativeBoundary } from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

describe('voice model download through the application', () => {
  let fixture: MobileApplicationFixture;
  let fetchResources: jest.Mock;
  let request: ReturnType<
    typeof import('../../../pro/audio/kokoroDownloadArtifactIO')['kokoroPublicDownloadRequest']
  >;

  beforeAll(async () => {
    installNativeBoundary();
    const { BareResourceFetcher } = require('react-native-executorch-bare-resource-fetcher') as typeof import('react-native-executorch-bare-resource-fetcher');
    fetchResources = BareResourceFetcher.fetch as jest.Mock;
    const { startMobileApplicationFixture } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture({ pro: true });
    const { kokoroPublicDownloadRequest } = require('../../../pro/audio/kokoroDownloadArtifactIO') as typeof import('../../../pro/audio/kokoroDownloadArtifactIO');
    request = kokoroPublicDownloadRequest();
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it('installs and removes the voice model through the public model facade', async () => {
    fetchResources.mockResolvedValue(undefined);
    expect(await fixture.application.models.downloadAndWait(request)).toEqual({
      ok: true,
      value: undefined,
    });
    const download = fixture.application.models.snapshot().downloads.find(
      item => item.modelId === request.modelId,
    );
    expect(download).toMatchObject({ status: 'completed' });
    const recovered = await fixture.application.models.refresh();
    expect(recovered.ok).toBe(true);
    expect(
      recovered.ok && recovered.value.inventory.find(
        model => model.id === request.modelId,
      )?.installed,
    ).toBe(true);
    expect(
      await fixture.application.models.removeDownload({
        downloadId: download!.downloadId,
      }),
    ).toEqual({ ok: true, value: true });
    const refreshed = await fixture.application.models.refresh();
    expect(refreshed.ok).toBe(true);
    expect(
      refreshed.ok && refreshed.value.inventory.find(
        model => model.id === request.modelId,
      )?.installed,
    ).toBe(false);
  });
});
