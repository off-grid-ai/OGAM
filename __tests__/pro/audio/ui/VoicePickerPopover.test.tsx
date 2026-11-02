/**
 * VoicePickerPopover tests
 *
 * The TTS voice selector popover shown from the audio-mode input row. It runs on the real TTS
 * stack: the real useTTSStore, the real Kokoro engine from the real registry, and its real
 * executorch bridge, mounted beside the popover as the app mounts it. Voices reach the store the
 * way they do in the app, through setEngine('kokoro') and a model download.
 *
 * Faked: only the device edges. ExecuTorch's resource cache (installKokoroResourceBoundary) holds
 * the files a voice needs; the executorch speech hook (jest.setup) reports the model ready; the
 * haptic engine records what it was asked to play. The icon font renders its name.
 *
 * Asserted: what the user sees (voice labels, personas, which row is selected) and what pressing
 * a row does (the store's active voice changes, the new voice's file reaches the device cache, a
 * running playback is stopped first, the popover closes).
 */
import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import HapticFeedback from 'react-native-haptic-feedback';
import { useTextToSpeech } from 'react-native-executorch/legacy';

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name, color }: any) => <Text testID={`feather-${name}`} style={{ color }}>{name}</Text>;
});

import { VoicePickerPopover } from '@offgrid/pro/audio/ui/VoicePickerPopover';
import { useTTSStore } from '@offgrid/pro/audio/ttsStore';
import { ttsRegistry, KOKORO_VOICES } from '@offgrid/pro/audio/engine';
import { getTheme } from '@offgrid/core/theme';
import { installKokoroResourceBoundary } from '../../../harness/kokoroResourceBoundary';

const voice = (id: string) => KOKORO_VOICES.find(v => v.id === id)!;
const HEART = voice('af_heart');
const MICHAEL = voice('am_michael');
const { colors } = getTheme('light');

const baseProps = { visible: true, onClose: jest.fn(), anchorY: 0, anchorX: 0 };

let cache: ReturnType<typeof installKokoroResourceBoundary>;
const speechHook = useTextToSpeech as jest.Mock;
const readySpeechHook = speechHook.getMockImplementation();

/** The Kokoro engine is chosen and its model downloaded, as the voice settings screen does it. */
async function kokoroReady(): Promise<void> {
  await act(async () => {
    await useTTSStore.getState().setEngine('kokoro');
    await useTTSStore.getState().downloadModels();
  });
}

/** The popover, with the active engine's executorch bridge mounted beside it as the app mounts it. */
function renderPicker(props: Partial<typeof baseProps> = {}) {
  const Bridge = ttsRegistry.getActiveEngine()?.getBridgeComponent() as React.FC | undefined;
  return render(
    <>
      {Bridge ? <Bridge /> : null}
      <VoicePickerPopover {...baseProps} {...props} />
    </>,
  );
}

beforeEach(() => {
  cache = installKokoroResourceBoundary();
  (HapticFeedback.trigger as jest.Mock).mockClear();
});

afterEach(async () => {
  speechHook.mockImplementation(readySpeechHook);
  await act(async () => {
    useTTSStore.getState().stop();
  });
});

describe('VoicePickerPopover', () => {
  it('renders an empty popover (no rows) before any engine has published voices', () => {
    // First in the file: the store starts with no voices until setEngine runs.
    const { queryAllByTestId } = render(<VoicePickerPopover {...baseProps} />);
    expect(queryAllByTestId('feather-user')).toHaveLength(0);
  });

  it('renders nothing when not visible', async () => {
    await kokoroReady();
    const { queryByText } = renderPicker({ visible: false });
    expect(queryByText(HEART.label)).toBeNull();
  });

  it('renders the voices of the active voice language with their persona', async () => {
    await kokoroReady();
    const { getByText } = renderPicker();
    expect(getByText(HEART.label)).toBeTruthy();
    expect(getByText(HEART.persona)).toBeTruthy();
    expect(getByText(MICHAEL.label)).toBeTruthy();
    expect(getByText(MICHAEL.persona)).toBeTruthy();
  });

  it('marks only the active voice selected, with a check and the primary colour', async () => {
    await kokoroReady();
    const { getByText, getAllByTestId, getByRole } = renderPicker();

    expect(getByRole('button', { name: HEART.label }).props.accessibilityState).toEqual({ selected: true });
    expect(getByRole('button', { name: MICHAEL.label }).props.accessibilityState).toEqual({ selected: false });
    // Exactly one check icon (the active row).
    expect(getAllByTestId('feather-check')).toHaveLength(1);
    expect(getByText(HEART.label).props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: colors.primary })]),
    );
    expect(getByText(MICHAEL.label).props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: colors.text })]),
    );
  });

  it('pressing a voice switches the real store to it and fetches its voice file', async () => {
    await kokoroReady();
    const onClose = jest.fn();
    const { getByRole } = renderPicker({ onClose });

    await act(async () => {
      fireEvent.press(getByRole('button', { name: MICHAEL.label }));
    });

    await waitFor(() => expect(useTTSStore.getState().activeVoiceId).toBe(MICHAEL.id));
    expect([...cache.files].some(path => path.includes('am_michael'))).toBe(true);
    expect(useTTSStore.getState().settings.voiceByEngine.kokoro).toBe(MICHAEL.id);
    expect(HapticFeedback.trigger).toHaveBeenCalledWith('impactLight', expect.anything());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops playback first when speaking, then switches voice', async () => {
    await kokoroReady();
    // The executorch runtime accepts the text and keeps streaming: speech is in flight.
    speechHook.mockImplementation(() => ({
      isReady: true,
      downloadProgress: 1,
      error: null,
      stream: () => new Promise<void>(() => {}),
      streamStop: jest.fn(),
    }));
    const { getByRole } = renderPicker();
    await waitFor(() => expect(ttsRegistry.getActiveEngine()?.getPhase()).toBe('ready'));
    act(() => {
      useTTSStore.getState().speak('Hello there, this is a long answer.', 'm1');
    });
    await waitFor(() => expect(useTTSStore.getState().playbackStatus).not.toBe('idle'));

    await act(async () => {
      fireEvent.press(getByRole('button', { name: MICHAEL.label }));
    });

    // The switch still happens, and the store is no longer left in a playing state.
    await waitFor(() => expect(useTTSStore.getState().activeVoiceId).toBe(MICHAEL.id));
    expect(useTTSStore.getState().playbackStatus).toBe('idle');
  });
});
