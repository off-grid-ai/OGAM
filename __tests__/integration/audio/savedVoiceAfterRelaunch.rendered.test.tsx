/**
 * The voice the person picked is the voice the app speaks with after a relaunch. They choose a voice
 * other than the default in the voice picker; after the app restarts, tapping Speak on a reply plays
 * it in that voice, and the picker still shows that voice as the selected one. It must not fall back
 * to the default voice (Heart) because the engine started before the saved settings were read.
 *
 * Launch 1: pick the text model on Home and chat (real send), download the voice model on the real
 * Models > Voice panel, enter Voice mode with the real chat header toggle, open the real voice picker
 * and choose Michael, then return to Text mode.
 * Relaunch the way the harness models it: a fresh module graph over the same persisted AsyncStorage,
 * so every store rehydrates and Pro activates again, then the chat is opened and mounted anew.
 * Launch 2: tap Speak on the reply from launch 1, then open Voice mode's picker.
 *
 * Fakes only at the device boundary: the LiteRT engine, the RAM sensor, the filesystem, and the
 * executorch TTS runtime. What the runtime was loaded with and asked to speak is AUDIO content with no
 * rendered surface, so this test reads it off the native useTextToSpeech leaf (the sanctioned audio
 * exception): each load records the voice file it was configured with, each stream the text it spoke.
 */
import { launchVoiceApp } from '../../harness/proHarness';

jest.unmock('@react-navigation/native');
// Each test boots the whole app twice; on a busy machine the first one runs past the 10 s default.
jest.setTimeout(30000);

interface TtsRuntimeRecord {
  /** Voice file each live (preventLoad=false) runtime load was configured with, e.g. "am_michael". */
  loads: string[];
  /** Each synthesis request: the voice the runtime was loaded with and the text it was asked to speak. */
  spoken: Array<{ voice: string; text: string }>;
}

/**
 * Record what reaches the executorch TTS runtime. Same device-shaped answer as the jest.setup stub
 * (ready, fully downloaded, a stream that resolves), plus a record of what it was given. It decides
 * nothing.
 */
function recordTtsRuntime(): TtsRuntimeRecord {
  const record: TtsRuntimeRecord = { loads: [], spoken: [] };
  const executorch = require('react-native-executorch');
  executorch.useTextToSpeech =
    (config: { voiceSource?: string }, opts?: { preventLoad?: boolean }) => {
      const voice = /\/([^/]+)\.[^/.]+$/.exec(String(config.voiceSource))?.[1] ?? String(config.voiceSource);
      if (!opts?.preventLoad && record.loads[record.loads.length - 1] !== voice) record.loads.push(voice);
      return {
        isReady: !opts?.preventLoad,
        downloadProgress: opts?.preventLoad ? 0 : 1,
        error: null,
        stream: async ({ text }: { text: string }) => { record.spoken.push({ voice, text }); },
        streamStop: () => {},
      };
    };
  return record;
}

describe('the saved voice survives a relaunch', () => {
  it('speaks with the voice picked before the relaunch and shows it selected in the picker', async () => {
    // ── Launch 1: chat, download the voice model, pick Michael ─────────────────────────────────
    const first = await launchVoiceApp();
    {
      const { rtl, view } = first;
      await first.voicePanel();
      await first.downloadVoice();
      await first.chat();
      await first.send('what is the capital of France?', 'The capital of France is Paris.');

      rtl.fireEvent.press(view.getByTestId('chat-mode-toggle'));
      await rtl.waitFor(() => expect(view.getByLabelText('Switch to Text mode')).toBeTruthy());

      // The picker starts on the default voice; the person chooses Michael.
      rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('Heart')));
      await rtl.waitFor(() => expect(view.getByRole('button', { name: 'Heart', selected: true })).toBeTruthy());
      rtl.fireEvent.press(view.getByRole('button', { name: 'Michael' }));
      await rtl.waitFor(() => expect(view.queryByRole('button', { name: 'Adam' })).toBeNull());
      await rtl.waitFor(() => expect(view.getByText('Michael')).toBeTruthy(), { timeout: 8000 });

      rtl.fireEvent.press(view.getByTestId('chat-mode-toggle'));
      await rtl.waitFor(() => expect(view.getByLabelText('Switch to Voice mode')).toBeTruthy());
      await first.close();
    }

    // ── Relaunch: fresh module graph, same persisted storage, back into the same chat ───────────
    let runtime!: TtsRuntimeRecord;
    const next = await launchVoiceApp({
      files: first.cache.files, preserveStorage: true, delayedStorage: true,
      configureRuntime: () => { runtime = recordTtsRuntime(); },
    });
    const { rtl, view } = next;
    rtl.fireEvent.press(await view.findByText('what is the capital of France?'));
    await view.findByText('The capital of France is Paris.');

    // Before: nothing has been spoken in this launch.
    expect(runtime.spoken).toHaveLength(0);

    // The person opens the reply's actions and taps Speak.
    const replies = view.getAllByTestId('assistant-message');
    rtl.fireEvent.press(rtl.within(replies[replies.length - 1]).getByText('•••'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('action-speak')));

    // The reply was spoken by a runtime loaded with the saved voice, never the default one.
    await rtl.waitFor(() => expect(runtime.spoken.length).toBeGreaterThan(0), { timeout: 8000 });
    expect(runtime.spoken[0].text).toContain('The capital of France is Paris.');
    expect(runtime.spoken.map(s => s.voice)).toEqual(runtime.spoken.map(() => 'am_michael'));
    expect(runtime.loads).toEqual(['am_michael']);

    // The picker shows the saved voice as the selected one.
    await rtl.waitFor(() => expect(view.queryByTestId('action-menu')).toBeNull());
    rtl.fireEvent.press(view.getByTestId('chat-mode-toggle'));
    await rtl.waitFor(() => expect(view.getByLabelText('Switch to Text mode')).toBeTruthy());
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('Michael')));
    await rtl.waitFor(() => expect(view.getByRole('button', { name: 'Michael', selected: true })).toBeTruthy());
    expect(view.queryByRole('button', { name: 'Heart', selected: true })).toBeNull();
    expect(view.getByRole('button', { name: 'Heart' })).toBeTruthy();

    await next.close();
  });
});

/**
 * A downloaded voice stays downloaded when the app cannot read its folder at startup. The person
 * downloads Kokoro on Models > Voice; on the next launch the device's read of the voice folder fails
 * (readDir throws). A failed read does not prove the files are gone, so the voice still shows as
 * downloaded, with no Download button asking for it again. A read that succeeds and finds the folder
 * empty is different: then the voice is gone and the Download button is offered.
 */
describe('a downloaded voice when its folder cannot be read', () => {
  async function downloadThenRelaunch(relaunchWith: (files: Set<string>) => {
    files: Set<string>; failReads?: boolean;
  }) {
    const first = await launchVoiceApp();
    await first.voicePanel();
    // Before: the voice is not downloaded, so the panel offers the download.
    expect(first.view.getByTestId('voice-model-kokoro-download')).toBeTruthy();
    expect(first.view.queryByTestId('voice-model-kokoro-delete')).toBeNull();
    await first.downloadVoice();
    expect(first.view.queryByTestId('voice-model-kokoro-download')).toBeNull();
    await first.close();

    const device = relaunchWith(first.cache.files);
    const next = await launchVoiceApp({
      files: device.files, preserveStorage: true,
      configureRuntime: () => {
        if (device.failReads) {
          require('../../harness/kokoroResourceBoundary').currentKokoroResourceBoundary()
            .failReads(new Error('ENOENT: no such file or directory, scandir'));
        }
      },
    });
    await next.voicePanel();
    return next;
  }

  it('still shows the voice as downloaded, with no download offered, when readDir throws', async () => {
    const next = await downloadThenRelaunch(files => ({ files, failReads: true }));
    const { rtl, view } = next;
    await rtl.waitFor(() => expect(view.getByTestId('voice-model-kokoro-delete')).toBeTruthy());
    expect(view.queryByTestId('voice-model-kokoro-download')).toBeNull();
    // It stays that way once the panel's disk check has settled.
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(view.getByTestId('voice-model-kokoro-delete')).toBeTruthy();
    expect(view.queryByTestId('voice-model-kokoro-download')).toBeNull();
    await next.close();
  });

  it('offers the download again when the folder reads fine but the voice files are gone', async () => {
    const next = await downloadThenRelaunch(() => ({ files: new Set<string>() }));
    const { rtl, view } = next;
    await rtl.waitFor(() => expect(view.getByTestId('voice-model-kokoro-download')).toBeTruthy());
    expect(view.queryByTestId('voice-model-kokoro-delete')).toBeNull();
    await next.close();
  });
});
