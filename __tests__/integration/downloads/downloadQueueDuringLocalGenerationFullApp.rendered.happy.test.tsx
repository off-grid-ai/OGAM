/**
 * P1 #210 — a saturated three-transfer download queue must not block a resident
 * local chat turn or duplicate queued/download-manager rows.
 *
 * The real App, navigation, browse/search UI, admission queue, download store,
 * Download Manager, local generation service, and chat state stay real. HTTP,
 * native transfer, filesystem, RAM, and llama are external boundaries.
 */
import type { RenderedAppJourney } from '../../harness/appJourney';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const FILE_SIZE = 16 * 1024 * 1024;
const PARTIAL = 'Local generation remains responsive';
const REPLY = `${PARTIAL} while six downloads stay coherent.`;
const PROMPT = 'Answer while the download queue is saturated.';
const originalFetch = global.fetch;

const MODELS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map(
  name => ({
    id: `offgrid-tests/contention-${name}`,
    name: `contention-${name}`,
    fileName: `contention-${name}-Q4_K_M.gguf`,
  }),
);

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
                  lastModified: '2026-07-20T00:00:00.000Z',
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

afterEach(() => {
  global.fetch = originalFetch;
});

async function queueModelFromBrowse(
  app: RenderedAppJourney,
  model: (typeof MODELS)[number],
): Promise<void> {
  const { act, fireEvent, waitFor } = app.rtl;

  await act(async () => {
    fireEvent.changeText(app.view.getByTestId('search-input'), model.name);
    fireEvent(app.view.getByTestId('search-input'), 'submitEditing');
    await new Promise(resolve => setTimeout(resolve, 600));
  });
  fireEvent.press(await waitFor(() => app.view.getByText(model.name)));
  await waitFor(() =>
    expect(
      app.view.getByText(model.fileName.replace(/\.gguf$/, '')),
    ).toBeTruthy(),
  );
  await act(async () => {
    fireEvent.press(app.view.getByTestId('file-card-0-download'));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await waitFor(() =>
    expect(app.view.queryByTestId('file-card-0-download')).toBeNull(),
  );
  fireEvent.press(app.view.getByTestId('model-detail-back'));
  await waitFor(() =>
    expect(app.view.getByTestId('models-screen')).toBeTruthy(),
  );
}

async function assertSixUniqueRows(app: RenderedAppJourney): Promise<void> {
  await app.rtl.waitFor(() => {
    expect(
      app.view.getByTestId('dm-active-downloading-count'),
    ).toHaveTextContent('3');
    expect(app.view.getByTestId('dm-active-queued-count')).toHaveTextContent(
      '3 queued',
    );
    expect(app.view.getAllByTestId('remove-download-button')).toHaveLength(6);
    for (const model of MODELS) {
      expect(app.view.getAllByText(model.fileName)).toHaveLength(1);
    }
  });
}

describe('P1 #210 saturated downloads during local generation', () => {
  it('finishes one local reply while three transfers and three queued rows stay unique', async () => {
    installModelApiFixture();
    const app = await renderMainApp({
      boundary: {
        download: true,
        llama: true,
        ram: {
          platform: 'android',
          totalBytes: 8 * GB,
          availBytes: 6 * GB,
        },
      },
    });
    const { boundary, rtl, view } = app;

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    for (const model of MODELS) {
      await queueModelFromBrowse(app, model);
    }

    const activeRows = await rtl.waitFor(() => {
      const rows = boundary.download!.active();
      expect(rows).toHaveLength(3);
      return rows;
    });
    await rtl.act(async () => {
      for (const row of activeRows) {
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
    await assertSixUniqueRows(app);
    rtl.fireEvent.press(view.getByTestId('back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({ text: REPLY, pauseAfter: PARTIAL });
    sendChatMessage(rtl, view, PROMPT);
    await rtl.waitFor(
      () => {
        expect(view.getByText(PARTIAL)).toBeTruthy();
        expect(view.getByTestId('stop-button')).toBeTruthy();
      },
      { timeout: 8000 },
    );

    for (const fraction of [0.2, 0.4, 0.6]) {
      await rtl.act(async () => {
        for (const row of activeRows) {
          boundary.download!.events.emit('DownloadProgress', {
            ...row,
            bytesDownloaded: FILE_SIZE * fraction,
            totalBytes: FILE_SIZE,
            status: 'running',
          });
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    }

    await rtl.act(async () => boundary.llama!.releaseStream());
    await rtl.waitFor(
      () => {
        expect(view.getAllByText(REPLY)).toHaveLength(1);
        expect(view.getAllByText(PROMPT).length).toBeGreaterThan(0);
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.getByTestId('chat-input').props.editable).toBe(true);
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await assertSixUniqueRows(app);
    expect(boundary.download!.active()).toHaveLength(3);

    view.unmount();
  }, 60000);
});
