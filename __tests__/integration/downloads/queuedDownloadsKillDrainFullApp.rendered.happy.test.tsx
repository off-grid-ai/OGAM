/** P0 #187 — UI-queued downloads survive process death and drain after a real App relaunch. */
import {
  installNativeBoundary,
  requireRTL,
  type DownloadRow,
} from '../../harness/nativeBoundary';
import { renderMainApp } from '../../harness/appJourney';

const FILE_SIZE = 16 * 1024 * 1024;
const ACTIVE_DOWNLOADS_KEY = '@offgrid/active_downloads';
const QUEUED_DOWNLOADS_KEY = '@offgrid/queued_downloads';
const originalFetch = global.fetch;

const MODELS = ['alpha', 'bravo', 'charlie', 'delta'].map(name => ({
  id: `offgrid-tests/queue-${name}`,
  name: `queue-${name}`,
  fileName: `queue-${name}-Q4_K_M.gguf`,
}));

type JourneyRtl = ReturnType<
  typeof import('../../harness/nativeBoundary').requireRTL
>;
type JourneyView = ReturnType<JourneyRtl['render']>;

function installModelApiFixture(): void {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const fixture = MODELS.find(model => url.includes(model.name));

    if (url.includes('/models?')) {
      return {
        ok: true,
        json: async () =>
          fixture
            ? [
                {
                  id: fixture.id,
                  author: 'offgrid-tests',
                  downloads: 1,
                  likes: 1,
                  tags: ['gguf'],
                  lastModified: '2026-07-17T00:00:00.000Z',
                  siblings: [],
                },
              ]
            : [],
      } as Response;
    }

    if (fixture && url.endsWith(`/models/${fixture.id}/tree/main`)) {
      return {
        ok: true,
        json: async () => [
          { type: 'file', path: fixture.fileName, size: FILE_SIZE },
        ],
      } as Response;
    }

    return { ok: true, json: async () => ({}) } as Response;
  }) as typeof fetch;
}

async function queueModelFromBrowse(
  rtl: JourneyRtl,
  view: JourneyView,
  model: (typeof MODELS)[number],
): Promise<void> {
  const { act, fireEvent, waitFor } = rtl;

  await act(async () => {
    fireEvent.changeText(view.getByTestId('search-input'), model.name);
    fireEvent(view.getByTestId('search-input'), 'submitEditing');
    await new Promise(resolve => setTimeout(resolve, 600));
  });
  await waitFor(() => expect(view.getByText(model.name)).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByText(model.name));
  });
  await waitFor(() =>
    expect(view.getByText(model.fileName.replace(/\.gguf$/, ''))).toBeTruthy(),
  );
  await act(async () => {
    fireEvent.press(view.getByTestId('file-card-0-download'));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await waitFor(() =>
    expect(view.queryByTestId('file-card-0-download')).toBeNull(),
  );
  await act(async () => {
    fireEvent.press(view.getByTestId('model-detail-back'));
  });
  await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
}

async function relaunchWithSurvivingNativeRows(rows: DownloadRow[]) {
  jest.resetModules();
  const boundary = installNativeBoundary({
    download: true,
    fs: true,
    ram: {
      platform: 'android',
      totalBytes: 8 * 1024 ** 3,
      availBytes: 6 * 1024 ** 3,
    },
  });
  rows.forEach(row => boundary.download!.seedActive(row));
  boundary.fs!.seedFile(
    '/docs/models/journey-model-Q4_K_M.gguf',
    128 * 1024 * 1024,
  );

  const React = require('react');
  const rtl = requireRTL();
  const App = require('../../../App').default;
  const view = rtl.render(React.createElement(App));
  await rtl.waitFor(
    () => {
      expect(view.queryByTestId('app-loading')).toBeNull();
      expect(view.getByTestId('home-screen')).toBeTruthy();
    },
    { timeout: 15000 },
  );
  return { boundary, rtl, view };
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P0 queued-download process-death recovery', () => {
  it('restores the UI-created queue once and drains every item without stale active rows', async () => {
    installModelApiFixture();
    const first = await renderMainApp({
      boundary: {
        download: true,
        ram: {
          platform: 'android',
          totalBytes: 8 * 1024 ** 3,
          availBytes: 6 * 1024 ** 3,
        },
      },
    });
    const { asyncStorage, boundary, rtl, view } = first;

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );

    for (const model of MODELS) {
      await queueModelFromBrowse(rtl, view, model);
    }

    await rtl.waitFor(() =>
      expect(boundary.download!.active()).toHaveLength(3),
    );
    await rtl.act(async () => {
      for (const row of boundary.download!.active()) {
        boundary.download!.events.emit('DownloadProgress', {
          ...row,
          bytesDownloaded: FILE_SIZE / 10,
          totalBytes: FILE_SIZE,
          status: 'running',
        });
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('dm-active-downloading-count')).toHaveTextContent(
        '3',
      );
      expect(view.getByTestId('dm-active-queued-count')).toHaveTextContent(
        '1 queued',
      );
      for (const model of MODELS) {
        expect(view.getByText(model.fileName)).toBeTruthy();
      }
    });
    await rtl.waitFor(async () => {
      const active = await asyncStorage.getItem(ACTIVE_DOWNLOADS_KEY);
      const queued = await asyncStorage.getItem(QUEUED_DOWNLOADS_KEY);
      expect(JSON.parse(active ?? '[]')).toHaveLength(3);
      expect(JSON.parse(queued ?? '[]')).toHaveLength(1);
    });

    const survivingRows = boundary.download!.active().map(row => ({
      ...row,
      status: 'running',
    }));
    view.unmount();

    const relaunched = await relaunchWithSurvivingNativeRows(survivingRows);
    const nextBoundary = relaunched.boundary;
    const nextRtl = relaunched.rtl;
    const nextView = relaunched.view;

    nextRtl.fireEvent.press(nextView.getByTestId('models-tab'));
    await nextRtl.waitFor(() =>
      expect(nextView.getByTestId('models-screen')).toBeTruthy(),
    );
    nextRtl.fireEvent.press(nextView.getByTestId('downloads-icon'));
    await nextRtl.waitFor(() => {
      expect(
        nextView.getByTestId('dm-active-downloading-count'),
      ).toHaveTextContent('3');
      expect(nextView.getByTestId('dm-active-queued-count')).toHaveTextContent(
        '1 queued',
      );
      for (const model of MODELS) {
        expect(nextView.getAllByText(model.fileName)).toHaveLength(1);
      }
    });

    for (const model of MODELS) {
      const nativeRow = await nextRtl.waitFor(() => {
        const row = nextBoundary
          .download!.active()
          .find(candidate => candidate.fileName === model.fileName);
        expect(row).toBeTruthy();
        return row!;
      });
      await nextRtl.act(async () => {
        nextBoundary.fs!.seedFile(`/docs/models/${model.fileName}`, FILE_SIZE);
        nextBoundary.download!.events.emit('DownloadProgress', {
          ...nativeRow,
          bytesDownloaded: FILE_SIZE,
          totalBytes: FILE_SIZE,
          status: 'running',
        });
        nextBoundary.download!.events.emit('DownloadComplete', {
          ...nativeRow,
          bytesDownloaded: FILE_SIZE,
          totalBytes: FILE_SIZE,
          status: 'completed',
          localUri: `/docs/models/${model.fileName}`,
        });
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      await nextRtl.waitFor(
        () => expect(nextView.getAllByText(model.fileName)).toHaveLength(1),
        { timeout: 8000 },
      );
    }

    await nextRtl.waitFor(
      () => {
        expect(nextView.queryByText('Active Downloads')).toBeNull();
        expect(
          nextView.queryByTestId('dm-active-downloading-count'),
        ).toBeNull();
        expect(nextView.queryByTestId('dm-active-queued-count')).toBeNull();
        for (const model of MODELS) {
          expect(nextView.getAllByText(model.fileName)).toHaveLength(1);
        }
      },
      { timeout: 8000 },
    );

    nextView.unmount();
  }, 45000);

  it('APP-P1-002 removes a user-cancelled queued item from UI and persistence across relaunch', async () => {
    installModelApiFixture();
    const first = await renderMainApp({
      boundary: {
        download: true,
        ram: {
          platform: 'android',
          totalBytes: 8 * 1024 ** 3,
          availBytes: 6 * 1024 ** 3,
        },
      },
    });
    const { asyncStorage, boundary, rtl, view } = first;

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    for (const model of MODELS) {
      await queueModelFromBrowse(rtl, view, model);
    }

    await rtl.waitFor(() =>
      expect(boundary.download!.active()).toHaveLength(3),
    );
    await rtl.act(async () => {
      for (const row of boundary.download!.active()) {
        boundary.download!.events.emit('DownloadProgress', {
          ...row,
          bytesDownloaded: FILE_SIZE / 10,
          totalBytes: FILE_SIZE,
          status: 'running',
        });
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('dm-active-queued-count')).toHaveTextContent(
        '1 queued',
      );
      expect(view.getAllByTestId('remove-download-button')).toHaveLength(4);
      expect(view.getByText(MODELS[3].fileName)).toBeTruthy();
    });

    const queuedCard = view.getByTestId(
      `active-download-${MODELS[3].id}/${MODELS[3].fileName}`,
    );
    rtl.fireEvent.press(
      rtl.within(queuedCard).getByTestId('remove-download-button'),
    );
    await rtl.waitFor(() =>
      expect(view.getByText('Remove Download')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Yes'));
    await rtl.waitFor(() => {
      expect(view.queryByText(MODELS[3].fileName)).toBeNull();
      expect(view.queryByTestId('dm-active-queued-count')).toBeNull();
      expect(view.getAllByTestId('remove-download-button')).toHaveLength(3);
    });
    await rtl.waitFor(async () => {
      const queued = await asyncStorage.getItem(QUEUED_DOWNLOADS_KEY);
      expect(JSON.parse(queued ?? '[]')).toHaveLength(0);
    });

    const survivingRows = boundary.download!.active().map(row => ({
      ...row,
      status: 'running',
    }));
    view.unmount();

    const relaunched = await relaunchWithSurvivingNativeRows(survivingRows);
    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('models-tab'));
    await relaunched.rtl.waitFor(() =>
      expect(relaunched.view.getByTestId('models-screen')).toBeTruthy(),
    );
    relaunched.rtl.fireEvent.press(
      relaunched.view.getByTestId('downloads-icon'),
    );
    await relaunched.rtl.waitFor(() => {
      expect(
        relaunched.view.getByTestId('dm-active-downloading-count'),
      ).toHaveTextContent('3');
      expect(
        relaunched.view.queryByTestId('dm-active-queued-count'),
      ).toBeNull();
      expect(relaunched.view.queryByText(MODELS[3].fileName)).toBeNull();
      for (const model of MODELS.slice(0, 3)) {
        expect(relaunched.view.getByText(model.fileName)).toBeTruthy();
      }
    });
    relaunched.view.unmount();
  }, 45000);
});
