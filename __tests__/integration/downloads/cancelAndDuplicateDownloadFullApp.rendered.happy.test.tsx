/** APP-P1-001 / APP-P1-003 — cancel isolation, retry affordance, and duplicate-tap coalescing. */
import { renderMainApp } from '../../harness/appJourney';

const FILE_SIZE = 16 * 1024 * 1024;
const MODELS = ['alpha', 'bravo'].map(name => ({
  id: `offgrid-tests/lifecycle-${name}`,
  name: `lifecycle-${name}`,
  fileName: `lifecycle-${name}-Q4_K_M.gguf`,
}));
const originalFetch = global.fetch;

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

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P1 download cancellation and duplicate-tap lifecycle', () => {
  it('coalesces repeated taps, cancels only the chosen transfer, and restores its Download action', async () => {
    installModelApiFixture();
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { download: true },
    });
    const { act, fireEvent, waitFor } = rtl;

    fireEvent.press(view.getByTestId('models-tab'));
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());

    for (const [index, model] of MODELS.entries()) {
      await act(async () => {
        fireEvent.changeText(view.getByTestId('search-input'), model.name);
        fireEvent(view.getByTestId('search-input'), 'submitEditing');
        await new Promise(resolve => setTimeout(resolve, 600));
      });
      fireEvent.press(await waitFor(() => view.getByText(model.name)));
      await waitFor(() =>
        expect(
          view.getByText(model.fileName.replace(/\.gguf$/, '')),
        ).toBeTruthy(),
      );

      const download = view.getByTestId('file-card-0-download');
      await act(async () => {
        // The first model deliberately receives the same rapid double gesture
        // observed when a user taps before the card can redraw.
        fireEvent.press(download);
        if (index === 0) fireEvent.press(download);
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      const nativeRow = await waitFor(() => {
        const row = boundary
          .download!.active()
          .find(candidate => candidate.fileName === model.fileName);
        expect(row).toBeTruthy();
        return row!;
      });
      await act(async () => {
        boundary.download!.events.emit('DownloadProgress', {
          ...nativeRow,
          bytesDownloaded: FILE_SIZE / 4,
          totalBytes: FILE_SIZE,
          status: 'running',
        });
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      await waitFor(() =>
        expect(view.getByTestId('file-card-0-cancel')).toBeTruthy(),
      );
      fireEvent.press(view.getByTestId('model-detail-back'));
      await waitFor(() =>
        expect(view.getByTestId('models-screen')).toBeTruthy(),
      );
    }

    // One row per logical model proves the rapid duplicate tap did not create a
    // duplicate product state. The native boundary independently has two transfers.
    fireEvent.press(view.getByTestId('downloads-icon'));
    await waitFor(() => {
      expect(view.getByTestId('dm-active-downloading-count')).toHaveTextContent(
        '2',
      );
      expect(view.getAllByText(MODELS[0].fileName)).toHaveLength(1);
      expect(view.getAllByText(MODELS[1].fileName)).toHaveLength(1);
    });
    expect(boundary.download!.active()).toHaveLength(2);

    fireEvent.press(view.getByTestId('back-button'));
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('search-input'), MODELS[0].name);
      fireEvent(view.getByTestId('search-input'), 'submitEditing');
      await new Promise(resolve => setTimeout(resolve, 600));
    });
    fireEvent.press(await waitFor(() => view.getByText(MODELS[0].name)));
    fireEvent.press(
      await waitFor(() => view.getByTestId('file-card-0-cancel')),
    );

    // Cancellation returns the exact model to a visible, retriable state.
    await waitFor(() =>
      expect(view.getByTestId('file-card-0-download')).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId('model-detail-back'));
    fireEvent.press(await waitFor(() => view.getByTestId('downloads-icon')));
    await waitFor(() => {
      expect(view.getByTestId('dm-active-downloading-count')).toHaveTextContent(
        '1',
      );
      expect(view.queryByText(MODELS[0].fileName)).toBeNull();
      expect(view.getByText(MODELS[1].fileName)).toBeTruthy();
    });
    expect(boundary.download!.active()).toHaveLength(1);
    expect(boundary.download!.active()[0].fileName).toBe(MODELS[1].fileName);

    view.unmount();
  }, 40000);
});
