/** Kokoro download state projected by the Shared model-download owner. */
import type { PublicDownloadRequest } from '@offgrid/models';
import { installNativeBoundary } from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

const CORE = ['duration_predictor.pte', 'synthesizer.pte'];
const VOICE = ['af_heart.bin', 'tagger.pt', 'lexicon.json'];
const allOnDisk = () =>
  [...CORE, ...VOICE].map(file => `/cache/react-native-executorch/${file}`);

async function waitForState(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() >= deadline)
      throw new Error('Kokoro download state timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('Kokoro download-state consistency', () => {
  let fixture: MobileApplicationFixture;
  let request: PublicDownloadRequest;
  let fetchResources: jest.Mock;
  let listDownloadedFiles: jest.Mock;

  beforeEach(async () => {
    installNativeBoundary();
    const { BareResourceFetcher } =
      require('react-native-executorch-bare-resource-fetcher') as typeof import('react-native-executorch-bare-resource-fetcher');
    fetchResources = BareResourceFetcher.fetch as jest.Mock;
    listDownloadedFiles = BareResourceFetcher.listDownloadedFiles as jest.Mock;
    fetchResources.mockReset();
    listDownloadedFiles.mockReset().mockResolvedValue([]);
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture({ pro: true });
    const { kokoroPublicDownloadRequest } =
      require('../../../pro/audio/kokoroDownloadArtifactIO') as typeof import('../../../pro/audio/kokoroDownloadArtifactIO');
    request = kokoroPublicDownloadRequest();
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  const kokoroDownload = () =>
    fixture.application.models
      .snapshot()
      .downloads.find(download => download.modelId === request.modelId);

  const kokoroProgress = () => {
    const download = kokoroDownload();
    return download && download.totalBytes > 0
      ? download.bytesDownloaded / download.totalBytes
      : 0;
  };

  async function startHeldDownload(progress: number) {
    let releaseFetch: (() => void) | undefined;
    let reportProgress: ((value: number) => void) | undefined;
    fetchResources.mockImplementation(
      (onProgress: (value: number) => void) =>
        new Promise<void>(resolve => {
          reportProgress = onProgress;
          releaseFetch = resolve;
        }),
    );
    const result = fixture.application.models.downloadAndWait(request);
    await waitForState(() => !!reportProgress);
    reportProgress?.(progress);
    await waitForState(() => Math.abs(kokoroProgress() - progress) < 0.001);
    return { result, release: () => releaseFetch?.() };
  }

  it('does not project completed while every file exists but native fetch is active', async () => {
    listDownloadedFiles.mockResolvedValue(allOnDisk());
    const held = await startHeldDownload(0.61);
    expect(kokoroDownload()?.status).toBe('downloading');
    expect(kokoroProgress()).toBeCloseTo(0.61);
    held.release();
    await expect(held.result).resolves.toEqual({ ok: true, value: undefined });
  });

  it('projects completed only after the native fetch resolves', async () => {
    fetchResources.mockResolvedValue(undefined);
    await expect(
      fixture.application.models.downloadAndWait(request),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(kokoroDownload()?.status).toBe('completed');
    expect(kokoroProgress()).toBe(1);
  });

  it('keeps completed Kokoro installed after a Shared inventory refresh', async () => {
    fetchResources.mockResolvedValue(undefined);
    await fixture.application.models.downloadAndWait(request);
    const refreshed = await fixture.application.models.refresh();
    expect(refreshed.ok).toBe(true);
    expect(
      refreshed.ok &&
        refreshed.value.inventory.find(model => model.id === request.modelId)
          ?.installed,
    ).toBe(true);
    expect(kokoroDownload()?.status).toBe('completed');
  });

  it('removes completed Kokoro through the Shared model-library transaction', async () => {
    fetchResources.mockResolvedValue(undefined);
    await fixture.application.models.downloadAndWait(request);

    const removed = await fixture.application.models.remove(request.modelId);

    expect(removed).toEqual(expect.objectContaining({ ok: true }));
    expect(
      fixture.application.models
        .snapshot()
        .inventory.find(model => model.id === request.modelId)?.installed,
    ).not.toBe(true);
  });

  it('does not project a partial native fetch as completed', async () => {
    listDownloadedFiles.mockResolvedValue(
      CORE.map(file => `/cache/react-native-executorch/${file}`),
    );
    const held = await startHeldDownload(0.2);
    expect(kokoroDownload()?.status).not.toBe('completed');
    held.release();
    await expect(held.result).resolves.toEqual({ ok: true, value: undefined });
  });
});
