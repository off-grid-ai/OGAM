/** P1 #154/#155 — speak a rendered reply through the real Pro TTS path. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const PROMPT = 'Give me one markdown-rich fact about Paris.';
const MARKDOWN_REPLY =
  '## Travel answer\n\n**Paris** uses the `Métro`.\n\n| City | Country |\n| --- | --- |\n| Paris | France |';

type StreamOptions = {
  text: string;
  onNext: (chunk: Float32Array) => Promise<void>;
  onEnd?: () => Promise<void>;
};

describe('P1 full-App assistant Speak journey', () => {
  it('speaks clean prose, exposes playback, stops and completes without changing chat', async () => {
    const spoken: string[] = [];
    let nativeStream: jest.Mock;
    let nativeStop: jest.Mock;

    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
      beforeRender: () => {
        // Native boundary: ExecuTorch owns synthesis and AudioContext owns sound.
        // Keep one native buffer in flight so the real playback state is visible
        // until the test either stops it or delivers the native onEnded event.
        const { useTextToSpeech } = require('react-native-executorch') as {
          useTextToSpeech: jest.Mock;
        };
        nativeStop = jest.fn();
        nativeStream = jest.fn(async (options: StreamOptions) => {
          spoken.push(options.text);
          await options.onNext(new Float32Array(8));
          await options.onEnd?.();
        });
        useTextToSpeech.mockReturnValue({
          isReady: true,
          downloadProgress: 1,
          error: null,
          stream: nativeStream,
          streamStop: nativeStop,
        });
      },
    });

    // Reach and load the real Kokoro feature through the Models UI.
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('voice-models-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Download voice')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('voice-af_heart')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: MARKDOWN_REPLY });
    sendChatMessage(rtl, view, PROMPT);

    await rtl.waitFor(
      () => {
        expect(view.getAllByTestId('user-message')).toHaveLength(1);
        expect(view.getAllByTestId('assistant-message')).toHaveLength(1);
        expect(view.getByText('Travel answer')).toBeTruthy();
        expect(view.getAllByText('Paris').length).toBeGreaterThan(0);
        expect(view.getByText('Métro')).toBeTruthy();
        expect(view.getAllByTestId(/^tts-button-/)).toHaveLength(1);
      },
      { timeout: 8000 },
    );

    // Speak from the real assistant action menu and observe the active speaker.
    rtl.fireEvent(view.getByTestId('assistant-message'), 'longPress');
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('action-speak')),
    );
    await rtl.waitFor(() => {
      expect(nativeStream).toHaveBeenCalledTimes(1);
      expect(view.queryByTestId('action-menu')).toBeNull();
      expect(
        rtl
          .within(view.getAllByTestId(/^tts-button-/)[0])
          .UNSAFE_getByProps({ name: 'volume-2' }),
      ).toBeTruthy();
    });

    // #155: the native TTS boundary receives prose, while the rendered markdown
    // remains visible in the one unchanged assistant bubble.
    expect(spoken[0]).toContain('Travel answer');
    expect(spoken[0]).toContain('Paris uses the Métro');
    expect(spoken[0]).not.toMatch(/[*#`|]/);
    expect(view.getByText('Travel answer')).toBeTruthy();
    expect(view.getAllByTestId('assistant-message')).toHaveLength(1);

    // Stop through the active message's visible TTS control.
    const stopsBeforeTap = nativeStop.mock.calls.length;
    rtl.fireEvent.press(view.getAllByTestId(/^tts-button-/)[0]);
    await rtl.waitFor(() => {
      expect(nativeStop.mock.calls.length).toBeGreaterThan(stopsBeforeTap);
      expect(
        rtl
          .within(view.getAllByTestId(/^tts-button-/)[0])
          .UNSAFE_getByProps({ name: 'volume-1' }),
      ).toBeTruthy();
    });

    // Replay from the same real action and let the native audio buffer end.
    rtl.fireEvent(view.getByTestId('assistant-message'), 'longPress');
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('action-speak')),
    );
    await rtl.waitFor(() => expect(nativeStream).toHaveBeenCalledTimes(2));
    const { AudioContext } = require('react-native-audio-api') as {
      AudioContext: jest.Mock;
    };
    const context = AudioContext.mock.results.at(-1)?.value;
    const source = context.createBufferSource.mock.results.at(-1)?.value;
    await rtl.act(async () => {
      source.onEnded?.();
      await Promise.resolve();
    });

    await rtl.waitFor(() => {
      expect(
        rtl
          .within(view.getAllByTestId(/^tts-button-/)[0])
          .UNSAFE_getByProps({ name: 'volume-1' }),
      ).toBeTruthy();
      expect(view.getAllByTestId('user-message')).toHaveLength(1);
      expect(view.getAllByTestId('assistant-message')).toHaveLength(1);
      expect(
        rtl.within(view.getByTestId('user-message')).getAllByText(PROMPT)
          .length,
      ).toBeGreaterThan(0);
      expect(view.getByText('Travel answer')).toBeTruthy();
      expect(view.queryByTestId('stop-button')).toBeNull();
      expect(view.queryByTestId('send-button')).toBeNull();
      expect(view.getByTestId('chat-input').props.value).toBe('');
    });
    expect(spoken).toHaveLength(2);
    expect(spoken[1]).toBe(spoken[0]);

    view.unmount();
  }, 30000);
});
