/**
 * Choosing the podcast and briefing voices: each host gets the voice tapped, it is heard
 * once, and the players use it (hostVoices). Fakes only the device boundary (the voice engine).
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockSpoken: string[] = [];
jest.mock('../../../src/atlasVoice/tts', () => ({
  listVoices: jest.fn(async () => Array.from({ length: 11 }, (_, i) => ({ name: `sid:${i}`, locale: 'en-US', quality: 500 }))),
  speakAndWait: jest.fn(async (_t: string, opts: { voice: string }) => { mockSpoken.push(opts.voice); return true; }),
  stop: jest.fn(),
}));

import { PodcastVoicePicker } from '../../../src/components/PodcastVoicePicker';
import { useAtlasVoiceStore } from '../../../src/atlasVoice/store';
import { hostVoices } from '../../../src/atlasVoice/neural';

it('lets each host have a chosen voice, used by the podcast players', async () => {
  useAtlasVoiceStore.setState({ neuralVoice: 'kokoro-en', neuralSid: 0, podcastVoices: [] });
  const screen = render(<PodcastVoicePicker hosts={2} />);
  expect(await screen.findByLabelText('Host B: George (UK)')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Host B: George (UK)'));
  // The button shows as picked at once; saving and the spoken preview follow a moment later.
  expect(screen.getByLabelText('Host B: George (UK)').props.accessibilityState.selected).toBe(true);
  await waitFor(() => expect(mockSpoken).toEqual(['sid:9']));
  const voices = Array.from({ length: 11 }, (_, i) => ({ name: `sid:${i}` }));
  expect(hostVoices(voices)[1]).toBe('sid:9');
  fireEvent.press(await screen.findByText('Use automatic voices'));
  expect(hostVoices(voices)[1]).not.toBe('sid:9');
});
