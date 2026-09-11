/**
 * A completed model download remains installed after the Mobile application restarts.
 *
 * The real Models and Download Manager screens run over the real Mobile application
 * composition and Shared download owner. The test supplies only the remote catalog,
 * native transfer, and filesystem boundaries.
 */
import type { NativeBoundary } from '../../harness/nativeBoundary';
import {
  renderProductionApp,
  seedReturningUserWithTextModel,
} from '../../harness/productionNavigation';

jest.unmock('@react-navigation/native');

const MODEL_ID = 'offgrid/Durable-Demo-GGUF';
const FILE_NAME = 'durable-demo.Q4_K_M.gguf';
const FILE_SIZE = 1024;

let boundary: NativeBoundary;
let originalFetch: typeof global.fetch;

function catalogResponse(url: string): Response {
  if (url.includes('/models?')) {
    return new Response(
      JSON.stringify([
        {
          id: MODEL_ID,
          author: 'offgrid',
          downloads: 1,
          likes: 0,
          tags: ['gguf'],
          lastModified: '2026-01-01T00:00:00.000Z',
        },
      ]),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (url.includes(`/models/${MODEL_ID}/tree/`)) {
    return new Response(
      JSON.stringify([
        {
          type: 'file',
          path: FILE_NAME,
          size: FILE_SIZE,
          lfs: { size: FILE_SIZE },
        },
      ]),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const requestedId = decodeURIComponent(
    url.split('/models/')[1]?.split('?')[0] ?? MODEL_ID,
  );
  return new Response(
    JSON.stringify({
      id: requestedId,
      author: requestedId.split('/')[0],
      downloads: 1,
      likes: 0,
      tags: ['gguf'],
      lastModified: '2026-01-01T00:00:00.000Z',
      siblings:
        requestedId === MODEL_ID
          ? [
              {
                rfilename: FILE_NAME,
                lfs: { size: FILE_SIZE },
              },
            ]
          : [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('model download durability through the rendered Mobile journey', () => {
  beforeEach(async () => {
    const harness =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    boundary = harness.installNativeBoundary({ download: true, fs: true });
    const { doMockRealSqlite } =
      require('../../harness/sqliteFake') as typeof import('../../harness/sqliteFake');
    doMockRealSqlite();

    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await seedReturningUserWithTextModel(boundary, {
      id: 'baseline-model',
      name: 'Baseline Model',
      engine: 'llama',
      fileName: 'baseline-model.gguf',
    });

    originalFetch = global.fetch;
    global.fetch = jest.fn(async input =>
      catalogResponse(
        typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.href
          : input.url,
      ),
    );
  });

  afterEach(async () => {
    const { requireRTL } =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    requireRTL().cleanup();
    const { stopMobileApplication } =
      require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
    await stopMobileApplication();
    global.fetch = originalFetch;
  });

  function renderModelsJourney() {
    const { requireRTL } =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    const rtl = requireRTL();
    const view = renderProductionApp(rtl);
    return { rtl, view };
  }

  it('keeps one completed model and no active duplicate after restart', async () => {
    const first = renderModelsJourney();
    await first.rtl.waitFor(() => {
      expect(
        first.view.queryByTestId('models-tab') ??
          first.view.queryByTestId('error-boundary-fallback'),
      ).toBeTruthy();
    });
    if (first.view.queryByTestId('error-boundary-fallback')) {
      const { useDebugLogsStore } =
        require('../../../src/stores/debugLogsStore') as typeof import('../../../src/stores/debugLogsStore');
      const errors = useDebugLogsStore
        .getState()
        .logs.filter(entry => entry.level === 'error')
        .map(entry => entry.message)
        .join('\n');
      throw new Error(`Mobile startup reached the error boundary:\n${errors}`);
    }
    first.rtl.fireEvent.press(first.view.getByTestId('models-tab'));
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('models-tab')).toBeSelected(),
    );
    const search = await first.view.findByPlaceholderText(
      'Search Hugging Face models...',
    );
    first.rtl.fireEvent.changeText(search, 'durable demo');
    first.rtl.fireEvent(search, 'submitEditing');

    first.rtl.fireEvent.press(await first.view.findByTestId('model-card-0'));
    first.rtl.fireEvent.press(
      await first.view.findByTestId('file-card-0-download'),
    );

    await first.rtl.waitFor(() =>
      expect(boundary.download!.active()).toHaveLength(1),
    );
    const transferId = boundary.download!.active()[0].downloadId;

    await first.rtl.act(async () => {
      boundary.download!.progress(transferId, FILE_SIZE / 2, FILE_SIZE);
    });
    expect(await first.view.findByText('50%')).toBeTruthy();

    await first.rtl.act(async () => {
      boundary.download!.complete(transferId);
    });
    expect(await first.view.findByLabelText('Delete this model')).toBeTruthy();

    first.view.unmount();
    boundary.download!.simulateRelaunch();
    const { stopMobileApplication } =
      require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
    await stopMobileApplication();

    const relaunched = renderModelsJourney();
    relaunched.rtl.fireEvent.press(
      await relaunched.view.findByTestId('models-tab'),
    );
    await relaunched.rtl.waitFor(() =>
      expect(relaunched.view.getByTestId('models-tab')).toBeSelected(),
    );
    relaunched.rtl.fireEvent.press(
      await relaunched.view.findByTestId('downloads-icon'),
    );

    expect(await relaunched.view.findByText('Download Manager')).toBeVisible();
    expect(await relaunched.view.findByText(FILE_NAME)).toBeVisible();
    expect(relaunched.view.queryAllByText(FILE_NAME)).toHaveLength(1);
    expect(relaunched.view.queryByText('Active Downloads')).toBeNull();
    expect(boundary.download!.active()).toHaveLength(0);
  }, 30_000);
});
