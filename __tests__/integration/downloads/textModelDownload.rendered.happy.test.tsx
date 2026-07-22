/**
 * P0 #4 — download a text GGUF through the real Models screen.
 *
 * The test drives the user-visible screen actions (open Models, search, select a
 * result, press Download) and keeps every Off Grid owner above the external
 * boundaries real: Hugging Face service, ModelsScreen hooks, startModelDownload,
 * modelManager, download/app stores, persistence, and rendered card state. Only
 * HTTP, the native background downloader, filesystem, and device RAM are faked.
 */
import { relaunchMainApp, renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'offgrid-tests/downloadable-model';
const FILE_NAME = 'downloadable-model-Q4_K_M.gguf';
const FILE_SIZE = 16 * 1024 * 1024;
const originalFetch = global.fetch;

function installModelApiFixture(): void {
  const model = {
    id: MODEL_ID,
    author: 'offgrid-tests',
    downloads: 1,
    likes: 1,
    tags: ['gguf'],
    lastModified: '2026-07-16T00:00:00.000Z',
    siblings: [],
  };

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/models?')) {
      return {
        ok: true,
        json: async () => (url.includes('search=downloadable') ? [model] : []),
      } as Response;
    }
    if (url.endsWith(`/models/${MODEL_ID}/tree/main`)) {
      return {
        ok: true,
        json: async () => [{ type: 'file', path: FILE_NAME, size: FILE_SIZE }],
      } as Response;
    }
    return { ok: true, json: async () => model } as Response;
  }) as typeof fetch;
}

type JourneyRtl = ReturnType<
  typeof import('../../harness/nativeBoundary').requireRTL
>;
type JourneyView = ReturnType<JourneyRtl['render']>;

async function searchForDownloadableModel(
  rtl: JourneyRtl,
  view: JourneyView,
): Promise<void> {
  const { act, fireEvent, waitFor } = rtl;
  await act(async () => {
    fireEvent.press(view.getByTestId('models-tab'));
  });
  await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());

  await act(async () => {
    fireEvent.changeText(view.getByTestId('search-input'), 'downloadable');
    fireEvent(view.getByTestId('search-input'), 'submitEditing');
    await new Promise(resolve => setTimeout(resolve, 600));
  });
  await waitFor(() =>
    expect(view.getByText('downloadable-model')).toBeTruthy(),
  );
}

async function openDownloadableModel(
  rtl: JourneyRtl,
  view: JourneyView,
): Promise<void> {
  const { act, fireEvent, waitFor } = rtl;
  await searchForDownloadableModel(rtl, view);
  await act(async () => {
    fireEvent.press(view.getByText('downloadable-model'));
  });
  await waitFor(() =>
    expect(view.getByText('downloadable-model-Q4_K_M')).toBeTruthy(),
  );
}

async function startDownloadFromModels(
  rtl: ReturnType<typeof import('../../harness/nativeBoundary').requireRTL>,
  view: ReturnType<
    ReturnType<
      typeof import('../../harness/nativeBoundary').requireRTL
    >['render']
  >,
): Promise<void> {
  const { act, fireEvent } = rtl;
  await openDownloadableModel(rtl, view);

  await act(async () => {
    fireEvent.press(view.getByTestId('file-card-0-download'));
  });
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P0 text-model download journey', () => {
  it('shows meaningful source, author, size, and format information', async () => {
    installModelApiFixture();
    const { rtl, view } = await renderMainApp({
      boundary: {
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
    });

    await searchForDownloadableModel(rtl, view);
    const catalogueCard = view.getByTestId('model-card-0');
    expect(rtl.within(catalogueCard).getByText('offgrid-tests')).toBeTruthy();
    expect(rtl.within(catalogueCard).getByText('Community')).toBeTruthy();

    await rtl.act(async () => {
      rtl.fireEvent.press(view.getByText('downloadable-model'));
    });
    await rtl.waitFor(() =>
      expect(view.getByTestId('model-detail-screen')).toBeTruthy(),
    );
    const fileCard = view.getByTestId('file-card-0');
    expect(rtl.within(fileCard).getByText('offgrid-tests')).toBeTruthy();
    expect(rtl.within(fileCard).getByText('Community')).toBeTruthy();
    expect(rtl.within(fileCard).getByText('16.00 MB')).toBeTruthy();
    expect(rtl.within(fileCard).getByText('Q4_K_M')).toBeTruthy();
    view.unmount();
  }, 30000);

  it('downloads a GGUF from its model detail and renders it as downloaded', async () => {
    installModelApiFixture();

    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    await startDownloadFromModels(rtl, view);
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));
    await waitFor(() => expect(view.getByText('Queued')).toBeTruthy());

    const nativeRow = boundary.download!.active()[0];
    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: nativeRow.downloadId,
        fileName: FILE_NAME,
        modelId: MODEL_ID,
        bytesDownloaded: FILE_SIZE / 2,
        totalBytes: FILE_SIZE,
        status: 'running',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(view.getByTestId('file-card-0-cancel')).toBeTruthy(),
    );

    await act(async () => {
      boundary.fs!.seedFile(`/docs/models/${FILE_NAME}`, FILE_SIZE);
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: nativeRow.downloadId,
        fileName: FILE_NAME,
        modelId: MODEL_ID,
        bytesDownloaded: FILE_SIZE,
        totalBytes: FILE_SIZE,
        status: 'running',
      });
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: nativeRow.downloadId,
        fileName: FILE_NAME,
        modelId: MODEL_ID,
        bytesDownloaded: FILE_SIZE,
        totalBytes: FILE_SIZE,
        status: 'completed',
        localUri: `/docs/models/${FILE_NAME}`,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(view.getAllByText('Success').length).toBeGreaterThan(0);
      expect(
        view.getAllByText(/downloaded successfully/i).length,
      ).toBeGreaterThan(0);
    });
    expect(view.queryByTestId('file-card-0-download')).toBeNull();
    expect(view.queryByTestId('file-card-0-cancel')).toBeNull();

    // P2 #5: returning to the model list projects the completed download as the
    // stable Downloaded check indicator. Revisit the detail and return once more
    // so this cannot pass on a transient completion toast or stale local state.
    await act(async () => {
      fireEvent.press(view.getByTestId('model-detail-back'));
    });
    await waitFor(() =>
      expect(view.getByTestId('model-card-0-downloaded')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByText('downloadable-model'));
    });
    await waitFor(() => {
      expect(view.getByTestId('model-detail-screen')).toBeTruthy();
      expect(view.queryByTestId('file-card-0-download')).toBeNull();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('model-detail-back'));
    });
    await waitFor(() =>
      expect(view.getByTestId('model-card-0-downloaded')).toBeTruthy(),
    );

    view.unmount();
    const relaunched = await relaunchMainApp({ boundary: { download: true } });
    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('models-tab'));
    await relaunched.rtl.waitFor(() =>
      expect(relaunched.view.getByTestId('models-screen')).toBeTruthy(),
    );
    relaunched.rtl.fireEvent.press(
      relaunched.view.getByTestId('downloads-icon'),
    );
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getByText('Downloaded Models')).toBeTruthy();
      expect(relaunched.view.getByText(FILE_NAME)).toBeTruthy();
    });
    relaunched.view.unmount();
  }, 30000);

  it('keeps an iOS download retriable when the app is killed mid-transfer', async () => {
    installModelApiFixture();
    const { boundary, asyncStorage, rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
    });
    const { act, waitFor } = rtl;

    await startDownloadFromModels(rtl, view);
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));
    const nativeRow = boundary.download!.active()[0];
    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: nativeRow.downloadId,
        fileName: FILE_NAME,
        modelId: MODEL_ID,
        bytesDownloaded: FILE_SIZE / 2,
        totalBytes: FILE_SIZE,
        status: 'running',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(view.getByTestId('file-card-0-cancel')).toBeTruthy(),
    );
    await waitFor(async () => {
      const persisted = await asyncStorage.getItem('@offgrid/active_downloads');
      expect(persisted).toContain(FILE_NAME);
      expect(persisted).toContain('running');
    });

    view.unmount();
    const relaunched = await relaunchMainApp({
      boundary: {
        download: true,
        ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
    });
    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('models-tab'));
    await relaunched.rtl.waitFor(() =>
      expect(relaunched.view.getByTestId('models-screen')).toBeTruthy(),
    );
    relaunched.rtl.fireEvent.press(
      relaunched.view.getByTestId('downloads-icon'),
    );
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getByText(FILE_NAME)).toBeTruthy();
      expect(relaunched.view.getByTestId('failed-retry-button')).toBeTruthy();
      expect(relaunched.view.getByTestId('failed-remove-button')).toBeTruthy();
    });
    relaunched.view.unmount();
  }, 30000);
});
