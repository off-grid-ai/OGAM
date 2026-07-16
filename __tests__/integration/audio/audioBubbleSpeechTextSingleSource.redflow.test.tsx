/**
 * RED-FLOW (integration) — the audio bubble's Play button must speak the SINGLE-SOURCE speech text.
 *
 * commit 592bc456 made prepareMessageForSpeech (= stripMarkdownForSpeech(stripControlTokens(content)))
 * the ONE transform every speech caller routes through, so the spoken text can never diverge. The audio
 * bubble's Play/re-synth handler instead hand-composed its own transform — stripMarkdownForSpeech(transcript)
 * ONLY, skipping stripControlTokens. So a transcript that still carries control/reasoning tokens (a raw
 * <think>…</think> block, a tool-call block) would be spoken aloud with those tokens, and the transform is
 * defined twice (drift risk) instead of once.
 *
 * This mounts the REAL AudioMessageBubble, arrives at the Play control via a real tap, and asserts the text
 * the bubble DISPATCHES to the TTS service equals prepareMessageForSpeech(transcript) for a markdown +
 * control-token input — the single source of truth.
 *
 * RED on HEAD: the bubble dispatches stripMarkdownForSpeech(transcript), which leaves the <think> block in
 * → ≠ prepareMessageForSpeech(transcript).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AudioMessageBubble } from '@offgrid/pro/audio/ui/AudioMessageBubble';
import { useTTSStore } from '@offgrid/pro/audio/ttsStore';
import { prepareMessageForSpeech } from '@offgrid/core/utils/messageContent';

// The file player decodes real audio off a native module — the one genuine IO boundary. Stub the decode.
jest.mock('@offgrid/pro/audio/audioFilePlayer', () => ({
  decodeFileWaveform: jest.fn(async () => [] as number[]),
}));

const initialTTSState = useTTSStore.getState();
afterEach(() => {
  jest.clearAllMocks();
  useTTSStore.setState(initialTTSState, true);
});

describe('audio bubble Play speaks the single-source speech text (red-flow)', () => {
  it('dispatches prepareMessageForSpeech(transcript) — control tokens stripped, not just markdown', () => {
    // A raw transcript with a reasoning block AND markdown — exactly the content a speech caller must
    // never voice verbatim.
    const transcript = '<think>internal reasoning the user must not hear</think>\n## Answer\nThe **capital** is `Paris`.';

    // Capture what the bubble DISPATCHES to the TTS service (the intent the View hands the store).
    let dispatchedText: string | undefined;
    useTTSStore.setState({
      play: async (_messageId: string, opts: { text: string }) => { dispatchedText = opts.text; },
    } as never);

    // No audioPath → the fileless synth (re-synth) path: tapping Play calls play(id, { text: <speech text> }).
    const { getByLabelText } = render(
      <AudioMessageBubble messageId="m1" audioPath="" waveformData={[]} durationSeconds={0} transcript={transcript} />,
    );

    fireEvent.press(getByLabelText('Play'));

    // The bubble must speak the SINGLE-SOURCE output. RED on HEAD: it dispatched stripMarkdownForSpeech only,
    // so the <think> block is still present → ≠ prepareMessageForSpeech(transcript).
    expect(dispatchedText).toBe(prepareMessageForSpeech(transcript));
    expect(dispatchedText).not.toMatch(/internal reasoning/); // the reasoning block must be gone
  });
});
