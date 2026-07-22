/** P1 #95 — blocked Whisper automatically frees Text, retries, and completes dictation. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB, MB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-small.en.bin';
const DICTATION = 'What is the capital of France?';

const tightDeviceModel: DownloadedModel = {
  id: 'test/tight-device/tight-device-Q4_K_M.gguf',
  name: 'Journey Model',
  author: 'test',
  filePath: '/docs/models/tight-device-Q4_K_M.gguf',
  fileName: 'tight-device-Q4_K_M.gguf',
  fileSize: 750 * MB,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

const holdGesture = () => ({
  nativeEvent: {
    touches: [],
    changedTouches: [],
    identifier: 1,
    pageX: 0,
    pageY: 0,
    timestamp: 0,
  },
  touchHistory: {
    touchBank: [],
    numberActiveTouches: 0,
    indexOfSingleActiveTouch: -1,
    mostRecentTimeStamp: 0,
  },
});

describe('P1 full-app blocked Whisper recovery', () => {
  it('frees the resident text model, retries dictation, then lazy-loads text for the reply', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        whisper: true,
        ram: {
          platform: 'android',
          totalBytes: 3 * GB,
          availBytes: 2560 * MB,
        },
      },
      downloadedModels: [tightDeviceModel],
      beforeRender: ({ boundary: native }) => {
        native.fs!.seedFile(WHISPER_PATH, 466 * MB);
      },
    });

    // Select the on-disk Speech model through Models. On this device the real
    // residency budget is 1536 MB: Small Whisper (466 MB) and Text (1125 MB)
    // each fit alone, but their 1591 MB combined footprint cannot co-reside.
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('transcription-models-tab'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('transcription-model-card-2')).toBeTruthy();
      expect(
        view.queryByTestId('transcription-model-card-2-download'),
      ).toBeNull();
    });
    rtl.fireEvent.press(view.getByTestId('transcription-model-card-2'));

    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('models-summary'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-speech-ram')).toBeTruthy();
      expect(view.queryByTestId('models-row-text-ram')).toBeNull();
    });
    rtl.fireEvent.press(view.getByText('Done'));

    // A normal typed turn loads Text and, because the two footprints do not fit,
    // evicts idle Speech through the production residency policy.
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: 'The text model is ready.' });
    sendChatMessage(rtl, view, 'Warm up the text model');
    await rtl.waitFor(
      () => expect(view.getByText('The text model is ready.')).toBeTruthy(),
      { timeout: 8000 },
    );
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.queryByTestId('models-row-speech-ram')).toBeNull();
    });
    rtl.fireEvent.press(view.getByText('Done'));

    // Holding the real Chat mic first attempts the blocked sidecar load. The app
    // must automatically free Text and retry; otherwise realtime never starts.
    const mic = await rtl.waitFor(() =>
      view.getByTestId('voice-record-button'),
    );
    rtl.fireEvent(mic, 'responderGrant', holdGesture());
    await rtl.waitFor(
      () => expect(boundary.whisper!.realtimeActive()).toBe(true),
      { timeout: 8000 },
    );
    rtl.fireEvent(
      await rtl.waitFor(() => view.getByTestId('voice-record-button')),
      'responderRelease',
      holdGesture(),
    );
    await rtl.waitFor(
      () => expect(boundary.whisper!.realtimeActive()).toBe(false),
      { timeout: 5000 },
    );
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({
        text: DICTATION,
        isCapturing: false,
      });
      await new Promise(resolve => setTimeout(resolve, 800));
    });
    await rtl.waitFor(
      () => expect(view.getByTestId('chat-input').props.value).toBe(DICTATION),
      { timeout: 8000 },
    );

    // The terminal transcript state exposes the automatic swap: Speech is now
    // resident and Text is not. There is no manual memory action in this journey.
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.queryByTestId('models-row-text-ram')).toBeNull();
      expect(view.getByTestId('models-row-speech-ram')).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByText('Done'));

    // Sending the recovered transcript reclaims Speech, lazy-loads the selected
    // Text model, and completes the reply without leaving a ghost loading/error.
    boundary.llama!.scriptCompletion({
      text: 'Paris is the capital of France.',
    });
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(
      () => {
        expect(view.getByText(DICTATION)).toBeTruthy();
        expect(view.getByText('Paris is the capital of France.')).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('voice-loading')).toBeNull();
        expect(view.queryByText(/Couldn't load the voice model/i)).toBeNull();
        expect(view.getByTestId('voice-record-button')).toBeTruthy();
      },
      { timeout: 8000 },
    );
    expect(boundary.whisper!.realtimeActive()).toBe(false);

    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.queryByTestId('models-row-speech-ram')).toBeNull();
    });

    view.unmount();
  }, 30000);
});
