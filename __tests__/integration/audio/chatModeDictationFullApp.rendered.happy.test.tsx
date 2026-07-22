/** P0 #53/#54/#55 — chat dictation reaches the composer and sends only reviewed text. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
const RESPONDER_EVENT = {
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
};

async function selectWhisperAndOpenChat(
  journey: Awaited<ReturnType<typeof renderMainApp>>,
): Promise<void> {
  const { rtl, view } = journey;
  rtl.fireEvent.press(view.getByTestId('models-tab'));
  await rtl.waitFor(() =>
    expect(view.getByTestId('models-screen')).toBeTruthy(),
  );
  rtl.fireEvent.press(view.getByTestId('transcription-models-tab'));
  const whisper = await rtl.waitFor(() =>
    view.getByTestId('transcription-model-card-0'),
  );
  expect(view.queryByTestId('transcription-model-card-0-download')).toBeNull();
  rtl.fireEvent.press(whisper);

  rtl.fireEvent.press(view.getByTestId('home-tab'));
  await rtl.waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
  await openChatWithJourneyModel(rtl, view);
}

describe('P0 full-App chat-mode dictation', () => {
  it('puts GGUF dictation in the composer for review, then sends it as text', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true, whisper: true },
      beforeRender: ({ boundary }) => {
        boundary.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
      },
    });
    const { boundary, rtl, view } = journey;
    await selectWhisperAndOpenChat(journey);

    boundary.whisper!.setFileTranscript('review this spoken GGUF draft');
    const mic = view.getByTestId('voice-record-button');
    rtl.fireEvent(mic, 'responderGrant', RESPONDER_EVENT);
    await rtl.waitFor(() =>
      expect(boundary.whisper!.hasRealtimeSubscriber()).toBe(true),
    );
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({ isCapturing: true, noData: true });
      boundary.whisper!.emitRealtime({ isCapturing: false, noData: true });
    });

    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-input').props.value).toContain(
        'review this spoken GGUF draft',
      ),
    );
    expect(view.queryByTestId('user-message')).toBeNull();

    boundary.llama!.scriptCompletion({ text: 'GGUF heard reviewed text.' });
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(() => {
      expect(
        view.getAllByText('review this spoken GGUF draft').length,
      ).toBeGreaterThan(0);
      expect(view.getByText('GGUF heard reviewed text.')).toBeTruthy();
      expect(view.queryByText(/\.wav|file:\/\//i)).toBeNull();
      expect(view.queryByTestId('stop-button')).toBeNull();
    });
    view.unmount();
  }, 30000);

  it('puts audio-capable LiteRT dictation in the composer, then sends only its transcript', async () => {
    const liteRTModel: DownloadedModel = {
      id: 'test/gemma-audio/gemma-audio.litertlm',
      name: 'Gemma Audio',
      author: 'test',
      fileName: 'gemma-audio.litertlm',
      filePath: '/docs/models/gemma-audio.litertlm',
      fileSize: 128 * 1024 * 1024,
      quantization: 'LiteRT',
      downloadedAt: '2026-07-17T00:00:00.000Z',
      engine: 'litert',
      liteRTAudio: true,
    };
    const journey = await renderMainApp({
      boundary: { whisper: true },
      downloadedModels: [liteRTModel],
      beforeRender: ({ boundary }) => {
        boundary.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
      },
    });
    const { boundary, rtl, view } = journey;
    await selectWhisperAndOpenChat(journey);

    boundary.litert.scriptTurn({ content: 'LiteRT is ready.' });
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'Start LiteRT');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(() => {
      expect(view.getByText('LiteRT is ready.')).toBeTruthy();
      expect(view.queryByTestId('stop-button')).toBeNull();
    });
    const sentMessageCount = view.getAllByTestId('user-message').length;

    boundary.whisper!.setFileTranscript('review this LiteRT transcript');
    const mic = view.getByTestId('voice-record-button');
    rtl.fireEvent(mic, 'responderGrant', RESPONDER_EVENT);
    await rtl.waitFor(() =>
      expect(view.getByText('Slide to cancel')).toBeTruthy(),
    );
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderRelease',
      RESPONDER_EVENT,
    );
    await rtl.waitFor(
      () =>
        expect(view.getByTestId('chat-input').props.value).toContain(
          'review this LiteRT transcript',
        ),
      { timeout: 5000 },
    );
    expect(view.getAllByTestId('user-message')).toHaveLength(sentMessageCount);

    boundary.litert.scriptTurn({ content: 'LiteRT received text only.' });
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(() => {
      expect(
        view.getAllByText('review this LiteRT transcript').length,
      ).toBeGreaterThan(0);
      expect(view.getByText('LiteRT received text only.')).toBeTruthy();
      expect(view.queryByText(/\.wav|file:\/\//i)).toBeNull();
      expect(view.queryByTestId('stop-button')).toBeNull();
      expect(view.queryByTestId('voice-loading')).toBeNull();
      expect(view.getByTestId('chat-input').props.value).toBe('');
    });
    view.unmount();
  }, 30000);

  it('runs realtime Whisper dictation while a text-only LiteRT model is active, then completes cleanly', async () => {
    const liteRTModel: DownloadedModel = {
      id: 'test/gemma-text/gemma-text.litertlm',
      name: 'Gemma Text',
      author: 'test',
      fileName: 'gemma-text.litertlm',
      filePath: '/docs/models/gemma-text.litertlm',
      fileSize: 128 * 1024 * 1024,
      quantization: 'LiteRT',
      downloadedAt: '2026-07-17T00:00:00.000Z',
      engine: 'litert',
      liteRTAudio: false,
    };
    const journey = await renderMainApp({
      boundary: { whisper: true },
      downloadedModels: [liteRTModel],
      beforeRender: ({ boundary }) => {
        boundary.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
      },
    });
    const { boundary, rtl, view } = journey;
    await selectWhisperAndOpenChat(journey);

    const transcript = 'send this realtime LiteRT draft';
    const mic = view.getByTestId('voice-record-button');
    rtl.fireEvent(mic, 'responderGrant', RESPONDER_EVENT);
    await rtl.waitFor(() =>
      expect(boundary.whisper!.hasRealtimeSubscriber()).toBe(true),
    );
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({
        text: transcript,
        isCapturing: true,
      });
    });
    await rtl.waitFor(() => expect(view.getByText(transcript)).toBeTruthy());

    rtl.fireEvent(
      view.getByTestId('voice-record-button'),
      'responderRelease',
      RESPONDER_EVENT,
    );
    await rtl.waitFor(
      () => expect(boundary.whisper!.realtimeActive()).toBe(false),
      { timeout: 4000 },
    );
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({
        text: transcript,
        isCapturing: false,
      });
    });
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-input').props.value).toBe(transcript),
    );
    expect(view.queryByTestId('user-message')).toBeNull();

    boundary.litert.scriptTurn({
      content: 'LiteRT completed the dictated request.',
    });
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(() => {
      expect(view.getAllByText(transcript).length).toBeGreaterThan(0);
      expect(
        view.getByText('LiteRT completed the dictated request.'),
      ).toBeTruthy();
      expect(view.queryByTestId('stop-button')).toBeNull();
      expect(view.queryByTestId('voice-loading')).toBeNull();
      expect(view.getByTestId('chat-input').props.value).toBe('');
    });
    view.unmount();
  }, 30000);
});
