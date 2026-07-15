/**
 * RED-FLOW (integration) — Q19: tapping "speak" on a chat bubble reads RAW markdown aloud.
 *
 * MessageRenderer feeds the Speak button `stripControlTokens(msg.content)` (MessageRenderer.tsx:73) —
 * markdown syntax (**, ##, backticks, table pipes) is NOT removed — while voice mode cleans with
 * stripMarkdownForSpeech (turnSpeech.ts:24). So the manual speaker voices "star star", "hash hash", etc.
 *
 * We render the REAL MessageRenderer and capture the exact text handed to the Speak slot (the slot is the
 * real extension seam; a recording slot stands in for the TTS button). No source change; asserts the text
 * that would reach the TTS engine.
 *
 * UI-driven note: Q19's symptom is AUDIO (what TTS voices), not a rendered pixel — you cannot assert on
 * sound in jest. The faithful surface is therefore the text-fed-to-TTS seam: the real MessageRenderer
 * computes and hands that text to the speak slot on render (the same value the Speak tap would voice). So
 * the render seam IS the correct altitude for this audio symptom (per the standard's audio-boundary rule);
 * the actual voicing is a Provit/on-device check.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { MessageRenderer } from '../../../src/screens/ChatScreen/MessageRenderer';
import { registerSlot, SLOTS } from '../../../src/bootstrap/slotRegistry';
import { useUiModeStore } from '../../../src/stores/uiModeStore';
import { createMessage } from '../../utils/factories';

describe('Q19 — manual speak reads raw markdown (red-flow)', () => {
  it('hands the TTS button markdown-stripped text, not raw markdown', () => {
    let spokenText = '';
    registerSlot(SLOTS.messageSpeakButton, ({ text }: { text: string }) => { spokenText = text; return null; });
    useUiModeStore.setState({ interfaceMode: 'text' as never }); // chat mode (speaker shows in the meta row)

    const message = createMessage({
      role: 'assistant',
      content: '## Heading\n\n**bold** text with `code` and a table: | a | b |',
      isStreaming: false,
    });

    render(
      <MessageRenderer
        item={message as never}
        index={0} displayMessagesLength={1} animateLastN={0} imageModelLoaded={false}
        isStreaming={false} isGeneratingImage={false} showGenerationDetails={false}
        onCopy={() => {}} onRetry={() => {}} onEdit={() => {}} onGenerateImage={() => {}} onImagePress={() => {}}
      />,
    );

    // Correct: what reaches the speaker is clean prose. Today it still contains markdown control chars,
    // so TTS voices "star star", "hash hash", backticks, pipes → RED.
    expect(spokenText).not.toMatch(/[*#`|]/);
  });
});
