/** APP-P2-001 — model search/filter/tab state stays coherent through download and deletion. */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const SMALL_ID = 'offgrid-tests/alpha-2B';
const LARGE_ID = 'offgrid-tests/alpha-9B';
const SMALL_FILE = 'alpha-2B-Q4_K_M.gguf';
const FILE_SIZE = 16 * 1024 * 1024;
const originalFetch = global.fetch;

function model(id: string) {
  return {
    id,
    author: 'offgrid-tests',
    downloads: id === SMALL_ID ? 20 : 10,
    likes: 1,
    tags: ['gguf'],
    lastModified: '2026-07-17T00:00:00.000Z',
    siblings: [
      {
        rfilename: id === SMALL_ID ? SMALL_FILE : 'alpha-9B-Q4_K_M.gguf',
        size: FILE_SIZE,
      },
    ],
  };
}

function installHuggingFaceBoundary(): void {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/models?')) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes('search=alpha')
            ? [model(SMALL_ID), model(LARGE_ID)]
            : [],
      } as Response;
    }
    if (url.endsWith(`/models/${SMALL_ID}/tree/main`)) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ type: 'file', path: SMALL_FILE, size: FILE_SIZE }],
      } as Response;
    }
    if (url.includes('/models/')) {
      const id = decodeURIComponent(
        url.split('/models/')[1].split('/tree/')[0],
      );
      return {
        ok: true,
        status: 200,
        json: async () => model(id),
      } as Response;
    }
    return { ok: true, status: 200, json: async () => [] } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('APP-P2-001 full-App model browse lifecycle', () => {
  it('keeps search and filters truthful across tabs, completion, and deletion', async () => {
    installHuggingFaceBoundary();
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    fireEvent.press(view.getByTestId('models-tab'));
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    expect(
      view.getByTestId('text-models-tab').props.accessibilityState.selected,
    ).toBe(true);

    await act(async () => {
      fireEvent.changeText(view.getByTestId('search-input'), 'alpha');
      fireEvent(view.getByTestId('search-input'), 'submitEditing');
      await new Promise(resolve => setTimeout(resolve, 600));
    });
    await waitFor(() => {
      expect(view.getByText('alpha-2B')).toBeTruthy();
      expect(view.getByText('alpha-9B')).toBeTruthy();
    });

    fireEvent.press(view.getByTestId('text-filter-toggle'));
    fireEvent.press(view.getByTestId('text-filter-size'));
    fireEvent.press(view.getByTestId('text-filter-size-small'));
    await waitFor(() => {
      expect(view.getByText('alpha-2B')).toBeTruthy();
      expect(view.queryByText('alpha-9B')).toBeNull();
      expect(
        view.getByTestId('text-filter-size').props.accessibilityState.selected,
      ).toBe(true);
    });

    // Changing categories intentionally resets text filters while preserving the
    // search, so returning to Text shows the complete matching result set.
    fireEvent.press(view.getByTestId('image-models-tab'));
    await waitFor(() => {
      expect(view.getByTestId('image-search-input')).toBeTruthy();
      expect(
        view.getByTestId('image-models-tab').props.accessibilityState.selected,
      ).toBe(true);
    });
    fireEvent.press(view.getByTestId('text-models-tab'));
    await waitFor(() => {
      expect(view.getByTestId('search-input').props.value).toBe('alpha');
      expect(view.getByText('alpha-2B')).toBeTruthy();
      expect(view.getByText('alpha-9B')).toBeTruthy();
    });

    // Reapply the user's small-model view, download its file, and prove the
    // catalogue projects the terminal state instead of showing a stale action.
    fireEvent.press(view.getByTestId('text-filter-toggle'));
    fireEvent.press(view.getByTestId('text-filter-size'));
    fireEvent.press(view.getByTestId('text-filter-size-small'));
    fireEvent.press(await waitFor(() => view.getByText('alpha-2B')));
    fireEvent.press(
      await waitFor(() => view.getByTestId('file-card-0-download')),
    );
    const nativeRow = await waitFor(() => {
      const row = boundary.download!.active()[0];
      expect(row).toBeTruthy();
      return row;
    });
    await act(async () => {
      boundary.fs!.seedFile(`/docs/models/${SMALL_FILE}`, FILE_SIZE);
      boundary.download!.events.emit('DownloadComplete', {
        ...nativeRow,
        bytesDownloaded: FILE_SIZE,
        totalBytes: FILE_SIZE,
        status: 'completed',
        localUri: `/docs/models/${SMALL_FILE}`,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(view.queryByTestId('file-card-0-download')).toBeNull(),
    );
    fireEvent.press(view.getByTestId('model-detail-back'));
    await waitFor(() =>
      expect(view.getByTestId('model-card-0-downloaded')).toBeTruthy(),
    );

    fireEvent.press(view.getByTestId('downloads-icon'));
    const completed = await waitFor(() =>
      view.getByTestId(`completed-download-${SMALL_ID}/${SMALL_FILE}`),
    );
    fireEvent.press(rtl.within(completed).getByTestId('delete-model-button'));
    await waitFor(() => expect(view.getByText('Delete Model')).toBeTruthy());
    fireEvent.press(view.getByText('Delete'));
    await waitFor(
      () =>
        expect(
          view.queryByTestId(`completed-download-${SMALL_ID}/${SMALL_FILE}`),
        ).toBeNull(),
      { timeout: 5000 },
    );

    fireEvent.press(view.getByTestId('back-button'));
    await waitFor(() => {
      expect(view.getByTestId('search-input').props.value).toBe('alpha');
      expect(view.getByText('alpha-2B')).toBeTruthy();
      expect(view.queryByText('alpha-9B')).toBeNull();
      expect(view.queryByTestId('model-card-0-downloaded')).toBeNull();
    });

    view.unmount();
  }, 40000);
});
