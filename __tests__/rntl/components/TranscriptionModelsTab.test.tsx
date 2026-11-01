/**
 * TranscriptionModelsTab tests
 *
 * The Models > Speech tab (speech-to-text / Whisper). It supports MULTIPLE downloaded models (every
 * model file on disk) with one active. Verifies:
 *  - the built-in catalogue renders as model cards + the privacy banner, with this phone's picks
 *  - tapping a model that is not on the phone downloads it on the native downloader
 *  - every on-disk model shows as downloaded, not just the active one
 *  - tapping an on-disk but inactive model makes it the active one, with no new download
 *  - per-model delete removes that model's file
 *  - a download the native downloader failed is offered again; a running one is not
 *  - a queued download reads as queued, not as 0%
 *  - the tab re-reads the disk when it regains focus
 *
 * Real TranscriptionModelsTab, ModelCard, picks rule, whisper store, background download service and
 * stores, on a real navigation stack, with the app root's real download listeners (useDownloadListeners)
 * so native progress reaches the cards as in the app. Fakes only at the device boundary: the RAM sensor
 * (a 12 GB Android phone), the native download module, the file system and the network (fetch).
 */
jest.unmock('@react-navigation/native');

import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const DIR = '/docs/whisper-models';

type Rtl = ReturnType<typeof requireRTL>;

async function mount(opts: { onDisk?: string[] } = {}) {
  const boundary = installNativeBoundary({
    download: true,
    fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  // No remote catalog and no Hugging Face answers: the bundled speech catalog is what the phone shows.
  globalThis.fetch = (async () => new Response('[]', { status: 200 })) as typeof fetch;
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  for (const id of opts.onDisk ?? []) boundary.fs!.seedFile(`${DIR}/ggml-${id}.bin`, 200 * 1024 * 1024);
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.getDeviceInfo();

  const React = require('react');
  const rtl: Rtl = requireRTL();
  const nav = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { Text } = require('react-native');
  const { TranscriptionModelsTab } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
  const { useDownloadListeners } = require('../../../src/hooks/useDownloads');
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  const { useWhisperStore } = require('../../../src/stores/whisperStore');
  const AppRoot = ({ children }: { children: unknown }) => {
    useDownloadListeners();
    return children;
  };
  const Stack = createNativeStackNavigator();
  const ref = nav.createNavigationContainerRef();
  const Other = () => React.createElement(Text, null, 'Download manager');
  const view = rtl.render(
    React.createElement(
      AppRoot,
      null,
      React.createElement(
        nav.NavigationContainer,
        { ref },
        React.createElement(
          Stack.Navigator,
          null,
          React.createElement(Stack.Screen, { name: 'Speech', component: TranscriptionModelsTab }),
          React.createElement(Stack.Screen, { name: 'DownloadManager', component: Other }),
        ),
      ),
    ),
  );
  await rtl.waitFor(() => expect(view.getByTestId('speech-picks')).toBeTruthy());
  return { boundary, rtl, view, ref, useDownloadStore, useWhisperStore };
}

const settle = async (rtl: Rtl) => {
  await rtl.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

describe('TranscriptionModelsTab', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows the speech catalogue, this phone\'s picks and the privacy banner', async () => {
    const { rtl, view } = await mount();

    expect(rtl.within(view.getByTestId('transcription-model-card-0')).getByText('Tiny')).toBeTruthy();
    expect(rtl.within(view.getByTestId('pick-fast')).getByText('Tiny')).toBeTruthy();
    expect(rtl.within(view.getByTestId('pick-balanced')).getByText('Small')).toBeTruthy();
    expect(rtl.within(view.getByTestId('pick-best')).getByText('Large v3')).toBeTruthy();
    // A pick shows once, in the picks row; the list leaves that model out.
    expect(view.queryByTestId('transcription-model-card-6')).toBeNull();
    expect(view.getByText(/audio is never sent anywhere/)).toBeTruthy();
  });

  it('tapping a model that is not on the phone downloads it, and the card shows the transfer', async () => {
    const { boundary, rtl, view } = await mount();
    expect(boundary.download!.active()).toHaveLength(0);

    rtl.fireEvent.press(view.getByTestId('transcription-model-card-0'));

    await rtl.waitFor(() => expect(boundary.download!.active().map(row => row.fileName)).toEqual(['ggml-tiny.en.bin']));
    await rtl.waitFor(() => expect(view.queryByTestId('transcription-model-card-0-download')).toBeNull());
    expect(view.getByTestId('transcription-model-card-0-cancel')).toBeTruthy();
  });

  it('marks every model on disk as downloaded; using one makes it the active pick without a download', async () => {
    const { boundary, rtl, view } = await mount({ onDisk: ['tiny.en', 'small'] });

    await rtl.waitFor(() => expect(view.getByTestId('transcription-model-card-0-delete')).toBeTruthy());
    expect(view.queryByTestId('transcription-model-card-0-download')).toBeNull();
    expect(view.queryByTestId('pick-balanced-download')).toBeNull();
    expect(view.getByTestId('pick-balanced-select')).toBeTruthy();

    rtl.fireEvent.press(view.getByTestId('pick-balanced-select'));

    await rtl.waitFor(() => expect(view.getByTestId('pick-balanced-active')).toBeTruthy());
    expect(view.queryByTestId('pick-balanced-select')).toBeNull();
    expect(boundary.download!.active()).toHaveLength(0);
  });

  it('tapping an on-disk but inactive card makes it the active model, with no download', async () => {
    const { boundary, rtl, view, useWhisperStore } = await mount({ onDisk: ['tiny.en', 'small'] });
    await rtl.waitFor(() => expect(view.getByTestId('pick-balanced-select')).toBeTruthy());
    rtl.fireEvent.press(view.getByTestId('pick-balanced-select'));
    await rtl.waitFor(() => expect(view.getByTestId('pick-balanced-active')).toBeTruthy());

    rtl.fireEvent.press(view.getByTestId('transcription-model-card-0'));

    await rtl.waitFor(() => expect(view.getByTestId('pick-balanced-select')).toBeTruthy());
    expect(useWhisperStore.getState().downloadedModelId).toBe('tiny.en');
    expect(boundary.download!.active()).toHaveLength(0);
  });

  it('the active model offers no download and no Use', async () => {
    const { rtl, view } = await mount({ onDisk: ['small'] });
    await rtl.waitFor(() => expect(view.getByTestId('pick-balanced-select')).toBeTruthy());

    rtl.fireEvent.press(view.getByTestId('pick-balanced-select'));

    await rtl.waitFor(() => expect(view.getByTestId('pick-balanced-active')).toBeTruthy());
    expect(view.queryByTestId('pick-balanced-download')).toBeNull();
    expect(view.queryByTestId('pick-balanced-select')).toBeNull();
  });

  it('per-model delete asks first, then removes that model\'s file', async () => {
    const { boundary, rtl, view } = await mount({ onDisk: ['tiny.en'] });
    await rtl.waitFor(() => expect(view.getByTestId('transcription-model-card-0-delete')).toBeTruthy());

    rtl.fireEvent.press(view.getByTestId('transcription-model-card-0-delete'));
    expect(view.getByText('Remove Transcription Model')).toBeTruthy();
    await rtl.act(async () => { rtl.fireEvent.press(view.getByText('Remove')); });

    await rtl.waitFor(() => expect(view.getByTestId('transcription-model-card-0-download')).toBeTruthy());
    expect(await boundary.fs!.module.exists(`${DIR}/ggml-tiny.en.bin`)).toBe(false);
  });

  it('a download the native downloader failed is offered again, not stuck downloading', async () => {
    const { boundary, rtl, view } = await mount();
    rtl.fireEvent.press(view.getByTestId('transcription-model-card-0'));
    await rtl.waitFor(() => expect(boundary.download!.active()).toHaveLength(1));
    await rtl.waitFor(() => expect(view.queryByTestId('transcription-model-card-0-download')).toBeNull());
    const row = boundary.download!.active()[0];

    await rtl.act(async () => {
      boundary.download!.events.emit('DownloadError', { downloadId: row.downloadId, status: 'failed', reason: 'Network lost' });
    });
    await settle(rtl);

    await rtl.waitFor(() => expect(view.getByTestId('transcription-model-card-0-download')).toBeTruthy());
  });

  it('a queued download reads as queued, not as 0%', async () => {
    const { rtl, view, useDownloadStore } = await mount();

    // The background download service registers a download waiting for a slot.
    rtl.act(() => {
      useDownloadStore.getState().add({
        modelKey: 'whisper-tiny.en', downloadId: 'dl-whisper-tiny.en', modelId: 'whisper-tiny.en',
        fileName: 'ggml-tiny.en.bin', quantization: '', modelType: 'stt', status: 'pending',
        bytesDownloaded: 0, totalBytes: 75 * 1024 * 1024, combinedTotalBytes: 75 * 1024 * 1024, progress: 0, createdAt: 0,
      });
    });

    await rtl.waitFor(() => expect(rtl.within(view.getByTestId('transcription-model-card-0')).getByText(/Queued/)).toBeTruthy());
    expect(rtl.within(view.getByTestId('transcription-model-card-0')).queryByText('0%')).toBeNull();
    expect(view.queryByTestId('transcription-model-card-0-download')).toBeNull();
  });

  it('re-reads the disk when the tab regains focus', async () => {
    const { boundary, rtl, view, ref } = await mount();
    expect(view.getByTestId('transcription-model-card-0-download')).toBeTruthy();

    rtl.act(() => { ref.navigate('DownloadManager'); });
    // Meanwhile the model lands on disk (downloaded from the Download Manager).
    boundary.fs!.seedFile(`${DIR}/ggml-tiny.en.bin`, 75 * 1024 * 1024);
    rtl.act(() => { ref.goBack(); });

    await rtl.waitFor(() => expect(view.getByTestId('transcription-model-card-0-delete')).toBeTruthy());
    expect(view.queryByTestId('transcription-model-card-0-download')).toBeNull();
  });
});
