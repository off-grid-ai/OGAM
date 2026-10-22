/**
 * Speech model cards keep their place in the list (a65bff2de).
 *
 * On the Speech tab the picks row shows Fast, Balanced and Best once, and the list below leaves those
 * exact models out. Each card in the list is still the same model at the same place whatever the picks
 * are: its card number is its place in the speech catalog, so the card a person (or a screen reader, or
 * an automation) found as "card 7" is the multilingual Medium before, during and after its download.
 * Before the fix the remaining multilingual cards were renumbered around the picks, so card 5 meant
 * Base on one phone and Medium on another.
 *
 * The person opens Models, goes to Speech, downloads the multilingual Medium from its card, watches it
 * progress and finish. The cards never change order or number.
 *
 * Real ModelsScreen, Speech tab, ModelCard, picks rule, whisper store, background download service and
 * stores, with the app root's real download listeners (useDownloadListeners, which App.tsx mounts) so
 * native progress reaches the card the way it does in the app. Fakes only at the device boundary: the RAM sensor, the native download module, the file
 * system and the network (fetch).
 */
import { installNativeBoundary, requireRTL, GB, MB } from '../../harness/nativeBoundary';

const CARD_ID = /^transcription-model-card-(\d+)$/;

type Node = { props?: Record<string, unknown>; children?: unknown };

function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts((node as Node).children);
}

/** The speech cards the screen shows, top to bottom: their card id and the model name they show. */
function speechCards(tree: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node === 'string') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const testID = (node as Node).props?.testID;
    if (typeof testID === 'string' && CARD_ID.test(testID)) {
      if (!seen.has(testID)) {
        seen.add(testID);
        out.push(`${testID}: ${texts(node)[0]}`);
      }
      return;
    }
    walk((node as Node).children);
  };
  walk(tree);
  return out;
}

async function launchWithEmptyStorage() {
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.getDeviceInfo();
}

describe('Speech model cards keep their place', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('downloading the multilingual Medium does not move or renumber any card', async () => {
    const boundary = installNativeBoundary({
      download: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    // No remote catalog and no Hugging Face answers: the bundled speech catalog is what the phone shows.
    globalThis.fetch = (async () => new Response('[]', { status: 200 })) as typeof fetch;
    const React = require('react');
    const { render, fireEvent, waitFor, within, act } = requireRTL();
    await launchWithEmptyStorage();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    const { useDownloadListeners } = require('../../../src/hooks/useDownloads');
    // The app root's download listeners, as App.tsx mounts them above every screen.
    const AppRoot = ({ children }: { children: unknown }) => {
      useDownloadListeners();
      return children;
    };

    const models = render(React.createElement(AppRoot, null, React.createElement(ModelsScreen)));
    fireEvent.press(models.getByTestId('transcription-models-tab'));
    await waitFor(() => expect(models.getByTestId('speech-picks')).toBeTruthy());

    // The 12 GB phone's picks are the multilingual Tiny, Small and Large v3; the list leaves them out.
    expect(within(models.getByTestId('pick-fast')).getByText('Tiny')).toBeTruthy();
    expect(within(models.getByTestId('pick-balanced')).getByText('Small')).toBeTruthy();
    expect(within(models.getByTestId('pick-best')).getByText('Large v3')).toBeTruthy();

    // Each card's number is its place in the speech catalog: English 0-3, multilingual 4-9. The picked
    // multilingual Tiny (4), Small (6) and Large v3 (9) are not in the list, and the cards around them
    // keep their own numbers.
    const expected = [
      'transcription-model-card-0: Tiny',
      'transcription-model-card-1: Base',
      'transcription-model-card-2: Small',
      'transcription-model-card-3: Medium',
      'transcription-model-card-5: Base',
      'transcription-model-card-7: Medium',
      'transcription-model-card-8: Large v3 Turbo',
    ];
    expect(speechCards(models.toJSON())).toEqual(expected);
    const medium = () => models.getByTestId('transcription-model-card-7');
    expect(within(medium()).getByText('Near human-level, 99 languages, ~2 GB RAM')).toBeTruthy();

    // BEFORE: nothing downloading; the Medium card offers a download.
    expect(boundary.download!.active()).toHaveLength(0);
    expect(models.getByTestId('transcription-model-card-7-download')).toBeTruthy();
    expect(models.queryByTestId('transcription-model-card-7-cancel')).toBeNull();

    fireEvent.press(models.getByTestId('transcription-model-card-7-download'));

    // STARTED: the device is asked for the multilingual Medium file; the same card now shows the
    // transfer, and the list is in the same order with the same numbers.
    await waitFor(() =>
      expect(boundary.download!.active().map(row => row.fileName)).toEqual(['ggml-medium.bin']),
    );
    await waitFor(() => expect(models.getByTestId('transcription-model-card-7-cancel')).toBeTruthy());
    expect(models.queryByTestId('transcription-model-card-7-download')).toBeNull();
    expect(speechCards(models.toJSON())).toEqual(expected);

    // PROGRESS: the device reports half the file.
    const row = boundary.download!.active()[0];
    const total = 1500 * MB;
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
        bytesDownloaded: total / 2, totalBytes: total, status: 'running',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(within(medium()).getByText(/750(\.0)? MB/)).toBeTruthy());
    expect(speechCards(models.toJSON())).toEqual(expected);

    // FINISHED: the file lands on disk and the device reports completion.
    await act(async () => {
      boundary.fs!.seedFile('/docs/whisper-models/ggml-medium.bin', total);
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
        bytesDownloaded: total, totalBytes: total, status: 'completed',
        localUri: '/docs/whisper-models/ggml-medium.bin',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // AFTER: the Medium card is downloaded (it offers delete, not download or cancel), still at card 7,
    // and every other card is where it was.
    await waitFor(() => expect(models.getByTestId('transcription-model-card-7-delete')).toBeTruthy());
    expect(models.queryByTestId('transcription-model-card-7-download')).toBeNull();
    expect(models.queryByTestId('transcription-model-card-7-cancel')).toBeNull();
    expect(speechCards(models.toJSON())).toEqual(expected);
    expect(within(medium()).getByText('Near human-level, 99 languages, ~2 GB RAM')).toBeTruthy();
    // The cards on either side still offer their own download.
    expect(models.getByTestId('transcription-model-card-5-download')).toBeTruthy();
    expect(models.getByTestId('transcription-model-card-8-download')).toBeTruthy();
  });
});
