/**
 * TTSSection tests: the pro TTS settings section (How-replies-arrive picker, Read-replies-aloud toggle,
 * Voice picker, Speed slider).
 *
 * Everything that is ours runs for real: the component, the real useTTSStore, the real Kokoro
 * engine from the real registry with its executorch bridge mounted beside the section (as the app
 * mounts it), the residency manager and the playback module. Each test starts a fresh module graph
 * (installNativeBoundary), so the store starts from its real defaults, and state reaches it the way
 * it does in the app: setEngine('kokoro'), downloadModels(), setVoice(), updateSettings().
 *
 * Faked: only the device edges. ExecuTorch's resource cache (installKokoroResourceBoundary) holds,
 * fails or completes the file transfers a voice needs; the executorch speech hook (jest.setup)
 * reports the model ready; RAM comes from installNativeBoundary. The icon font renders its name.
 */
import type React from 'react';
import { installNativeBoundary, requireRTL } from '../../../harness/nativeBoundary';
import { installKokoroResourceBoundary } from '../../../harness/kokoroResourceBoundary';

// Render each Feather icon as a Text carrying its name, so a test can assert
// which glyph shows (check / check-circle / external-link) without reaching into
// the vector-icons internals.
jest.mock('react-native-vector-icons/Feather', () => {
  const RC = require('react');
  const { Text } = require('react-native');
  return (props: { name: string }) => RC.createElement(Text, { testID: `icon-${props.name}` }, props.name);
});

type Store = typeof import('@offgrid/pro/audio/ttsStore').useTTSStore;

/** A fresh app module graph: the real store at its defaults, the real Kokoro registry. */
function launch() {
  installNativeBoundary();
  const cache = installKokoroResourceBoundary();
  const React = require('react');
  const rtl = requireRTL();
  const { TTSSection } = require('@offgrid/pro/audio/ui/TTSSection');
  const { useTTSStore } = require('@offgrid/pro/audio/ttsStore') as { useTTSStore: Store };
  const { ttsRegistry, KOKORO_VOICES } = require('@offgrid/pro/audio/engine');
  const voice = (id: string) => KOKORO_VOICES.find((v: { id: string }) => v.id === id);
  const store = () => useTTSStore.getState();

  return {
    rtl,
    cache,
    store,
    voice,
    /** The Kokoro engine is chosen, as the voice settings screen does on open. */
    async chooseKokoro() {
      await rtl.act(async () => { await store().setEngine('kokoro'); });
    },
    /** The Kokoro model is downloaded through the store's own download action. */
    async downloadKokoro() {
      await rtl.act(async () => {
        await store().setEngine('kokoro');
        await store().downloadModels();
      });
    },
    /**
     * Render the section. With `bridge`, the active engine's executorch bridge is mounted beside it
     * (the engine warms up and reads ready); without it the engine stays cold.
     */
    render(props: Record<string, unknown> = {}, opts: { bridge?: boolean } = { bridge: true }) {
      const Bridge = opts.bridge ? (ttsRegistry.getActiveEngine()?.getBridgeComponent() as React.FC | undefined) : undefined;
      return rtl.render(
        React.createElement(React.Fragment, null,
          Bridge ? React.createElement(Bridge) : null,
          React.createElement(TTSSection, props)),
      );
    },
  };
}

type App = ReturnType<typeof launch>;
let app: App;

beforeEach(() => {
  app = launch();
});

afterEach(async () => {
  await app.rtl.act(async () => { app.store().stop(); });
});

// ── Not-ready (empty) branch ─────────────────────────────────────────────
describe('when no voice model is ready', () => {
  it('shows the "download in TTS Settings" empty state and none of the controls', () => {
    const { getByText, queryByTestId } = app.render();
    expect(getByText(/No voice models downloaded/)).toBeTruthy();
    // The ready-only controls are absent.
    expect(queryByTestId('tts-speed')).toBeNull();
    expect(queryByTestId('icon-check-circle')).toBeNull();
  });

  it('renders the TTS Settings link only when the navigate callback is provided, and pressing it calls back', () => {
    const onNavigate = jest.fn();
    const { getByText, getByTestId } = app.render({ onNavigateToTTSSettings: onNavigate });
    // The link row shows the external-link icon + label.
    expect(getByTestId('icon-external-link')).toBeTruthy();
    app.rtl.fireEvent.press(getByText('TTS Settings'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('omits the link entirely when no navigate callback is given', () => {
    const { queryByText, queryByTestId } = app.render();
    expect(queryByText('TTS Settings')).toBeNull();
    expect(queryByTestId('icon-external-link')).toBeNull();
  });
});

describe('when the voice model is downloaded but the engine is cold', () => {
  it('shows the voice controls instead of the download empty state', async () => {
    await app.downloadKokoro();
    // No bridge mounted: the model is on disk but not loaded.
    const { getByText, getByTestId, queryByText } = app.render({}, { bridge: false });

    expect(app.store().isReady).toBe(false);
    expect(queryByText(/No voice models downloaded/)).toBeNull();
    expect(getByText('How replies arrive')).toBeTruthy();
    expect(getByTestId('tts-speed-slider')).toBeTruthy();
  });
});

// ── Ready branch ─────────────────────────────────────────────────────────
describe('when a voice model is ready', () => {
  beforeEach(async () => {
    await app.downloadKokoro();
    app.store().updateSettings({ interfaceMode: 'chat' });
  });

  /** Render with the bridge mounted and wait for the engine to read ready. */
  async function renderReady(props: Record<string, unknown> = {}) {
    const view = app.render(props);
    await app.rtl.waitFor(() => expect(app.store().isReady).toBe(true));
    return view;
  }

  it('shows the interface-mode picker, the voice list and the speed slider (not the empty state)', async () => {
    const { getByText, getByTestId, queryByText } = await renderReady();
    expect(queryByText(/No voice models downloaded/)).toBeNull();
    expect(getByText('How replies arrive')).toBeTruthy();
    expect(getByText('Chat')).toBeTruthy();
    expect(getByText('Audio')).toBeTruthy();
    // Voices of the active language only (US English), not the British ones.
    expect(getByText(app.voice('af_heart').label)).toBeTruthy();
    expect(queryByText(app.voice('bf_emma').label)).toBeNull();
    expect(getByTestId('chat-tts-language')).toBeTruthy();
    expect(getByTestId('tts-speed-slider')).toBeTruthy();
  });

  it('shows the chat-mode description and the Read-replies-aloud toggle while in chat mode', async () => {
    const { getByText } = await renderReady();
    expect(getByText('As text, with a play button.')).toBeTruthy();
    expect(getByText('Read replies aloud')).toBeTruthy();
  });

  it('hides the Read-replies-aloud toggle and shows the audio-mode description while in audio mode', async () => {
    await app.rtl.act(async () => { app.store().updateSettings({ interfaceMode: 'audio' }); });
    const { getByText, queryByText } = await renderReady();
    expect(getByText('As voice notes you can play.')).toBeTruthy();
    expect(queryByText('Read replies aloud')).toBeNull();
  });

  // ── Voice picker interaction (real store action) ───────────────────────
  it('marks the active voice with a check and renders per-voice metadata', async () => {
    const { getAllByTestId, getAllByText } = await renderReady();
    // Exactly one row (the active af_heart) shows the check glyph; metadata joins accent + gender.
    expect(getAllByTestId('icon-check')).toHaveLength(1);
    const heart = app.voice('af_heart');
    expect(getAllByText(`${heart.accent} · ${heart.gender}`).length).toBeGreaterThan(0);
  });

  it('shows the language download until the requested voice is ready', async () => {
    const { getByText, getByTestId, queryByTestId } = await renderReady();
    expect(app.store().activeVoiceId).toBe('af_heart');
    // The voice file transfer reports 42% and then waits.
    const finishSwitch = app.cache.holdNext(0.42);
    app.rtl.fireEvent.press(getByTestId('chat-tts-language'));
    await app.rtl.act(async () => { app.rtl.fireEvent.press(getByTestId('chat-tts-language-en-GB')); });

    // The current voice stays active while the requested one is prepared.
    expect(app.store().activeVoiceId).toBe('af_heart');
    await app.rtl.waitFor(() => expect(app.store().pendingVoiceId).toBe('bf_emma'));
    expect(getByTestId('chat-tts-language-download-status')).toBeTruthy();
    expect(queryByTestId('icon-check-circle')).toBeNull();
    // The fetcher reports a fraction only (no byte counts), so no rate shows.
    await app.rtl.waitFor(() =>
      expect(getByText('Downloading English (UK) voice - 42%')).toBeTruthy(),
    );

    // A second selection cannot start while one voice is still being prepared.
    expect(getByTestId('chat-tts-language')).toBeDisabled();
    expect(queryByTestId('chat-tts-language-en-US')).toBeNull();

    await app.rtl.act(async () => { finishSwitch(); });
    await app.rtl.waitFor(() => expect(getByTestId('chat-tts-language-ready-status')).toBeTruthy());
    expect(app.store().activeVoiceId).toBe('bf_emma');
    expect(app.store().settings.voiceByEngine.kokoro).toBe('bf_emma');
    expect([...app.cache.files].some(path => path.includes('bf_emma'))).toBe(true);
    expect(getByText(app.voice('bf_emma').label)).toBeTruthy();
  });

  it('prepares a voice from cache when that voice completed before', async () => {
    const { getByText, getByTestId, queryByText } = await renderReady();
    // British English was used before, then the user went back to US English.
    for (const id of ['bf_emma', 'af_heart']) {
      app.rtl.act(() => { app.store().setVoice(id); });
      await app.rtl.waitFor(() => expect(app.store().activeVoiceId).toBe(id));
      await app.rtl.waitFor(() => expect(app.store().isSwitchingVoice).toBe(false));
    }
    expect(app.store().settings.voiceAssetsDownloaded?.kokoro).toContain('bf_emma');

    const finishSwitch = app.cache.holdNext(0);
    app.rtl.fireEvent.press(getByTestId('chat-tts-language'));
    await app.rtl.act(async () => { app.rtl.fireEvent.press(getByTestId('chat-tts-language-en-GB')); });

    expect(getByText('Preparing English (UK) voice')).toBeTruthy();
    expect(queryByText(/Downloading English \(UK\) voice/)).toBeNull();

    await app.rtl.act(async () => { finishSwitch(); });
    await app.rtl.waitFor(() => expect(getByTestId('chat-tts-language-ready-status')).toBeTruthy());
  });

  it('shows a failed language download and retries it', async () => {
    const { getByText, getByTestId } = await renderReady();

    app.cache.failFetch(new Error('network down'));
    app.rtl.fireEvent.press(getByTestId('chat-tts-language'));
    await app.rtl.act(async () => { app.rtl.fireEvent.press(getByTestId('chat-tts-language-en-GB')); });
    await app.rtl.waitFor(() => expect(getByTestId('chat-tts-language-download-error')).toBeTruthy());
    expect(getByText('Could not download the English (UK) voice. Check your connection and retry.')).toBeTruthy();
    expect(app.store().activeVoiceId).toBe('af_heart');

    // The network is back: retry fetches the voice and switches to it.
    app.cache.failFetch(undefined);
    await app.rtl.act(async () => { app.rtl.fireEvent.press(getByTestId('chat-tts-language-download-retry')); });
    await app.rtl.waitFor(() => expect(app.store().activeVoiceId).toBe('bf_emma'));
    expect([...app.cache.files].some(path => path.includes('bf_emma'))).toBe(true);
  });

  // ── Mode picker interaction (real store action) ────────────────────────
  it('tapping the Audio chip flips interfaceMode to "audio" in the REAL store', async () => {
    const { getByText } = await renderReady();
    expect(app.store().settings.interfaceMode).toBe('chat');
    await app.rtl.act(async () => { app.rtl.fireEvent.press(getByText('Audio')); });
    expect(app.store().settings.interfaceMode).toBe('audio');
  });

  it('tapping the Chat chip from audio mode flips interfaceMode back to "chat"', async () => {
    await app.rtl.act(async () => { app.store().updateSettings({ interfaceMode: 'audio' }); });
    const { getByText } = await renderReady();
    await app.rtl.act(async () => { app.rtl.fireEvent.press(getByText('Chat')); });
    expect(app.store().settings.interfaceMode).toBe('chat');
  });

  // ── Read-replies-aloud toggle interaction (real store action) ──────────────────
  it('toggling the Enable switch flips settings.enabled in the REAL store', async () => {
    const { UNSAFE_getByType } = await renderReady();
    const { Switch } = require('react-native');
    expect(app.store().settings.enabled).toBe(true);
    await app.rtl.act(async () => { app.rtl.fireEvent(UNSAFE_getByType(Switch), 'valueChange', false); });
    expect(app.store().settings.enabled).toBe(false);
  });

  // ── Speed slider interaction (real store action) ───────────────────────
  it('committing the speed slider updates settings.speed in the REAL store', async () => {
    const { getByTestId } = await renderReady();
    await app.rtl.act(async () => { app.rtl.fireEvent(getByTestId('tts-speed-slider'), 'slidingComplete', 1.5); });
    expect(app.store().settings.speed).toBe(1.5);
  });
});

// ── Voice-picker header status (downloading vs not-ready vs ready) ────────
describe('voice-picker header status', () => {
  it('shows the download percentage while downloading', async () => {
    // The model was downloaded before (the flag is saved), and a fresh download now reports 42%
    // and waits - the re-download of a model whose files went missing.
    await app.downloadKokoro();
    const finish = app.cache.holdNext(0.42);
    let download!: Promise<void>;
    await app.rtl.act(async () => { download = app.store().downloadModels(); });
    const { getByText } = app.render({}, { bridge: false });
    expect(app.store().isDownloading).toBe(true);
    await app.rtl.waitFor(() => expect(getByText('42%')).toBeTruthy());
    await app.rtl.act(async () => { finish(); await download; });
  });

  it('shows the ready check-circle when ready and not downloading', async () => {
    await app.downloadKokoro();
    const { getByTestId, queryByText } = app.render();
    await app.rtl.waitFor(() => expect(getByTestId('icon-check-circle')).toBeTruthy());
    expect(queryByText('42%')).toBeNull();
  });
});
