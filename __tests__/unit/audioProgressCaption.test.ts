/**
 * The audio in-progress caption labels (shown beside the loader dots): the two
 * states the user asked for — "Waiting for {model}" and "Streaming voice
 * response" — plus the thinking + silent-during-playback cases.
 */
import { captionFor, AUDIO_PHASE } from '../../pro/audio/ui/AudioMessageBubble/useAudioProgressCaption';

describe('audio progress caption', () => {
  it('shows "Waiting for {model}" while waiting, naming the active model', () => {
    expect(captionFor(AUDIO_PHASE.WAITING, 'Gemma 4 E4B')).toBe('Waiting for Gemma 4 E4B');
  });

  it('falls back to a generic wait label when no model name is known', () => {
    expect(captionFor(AUDIO_PHASE.WAITING)).toBe('Waiting for response');
  });

  it('shows Thinking while the model reasons', () => {
    expect(captionFor(AUDIO_PHASE.THINKING)).toBe('Thinking…');
  });

  it('shows "Streaming voice response" while answering', () => {
    expect(captionFor(AUDIO_PHASE.ANSWERING)).toBe('Streaming voice response');
  });

  it('is silent during playback — the audio itself is the feedback', () => {
    expect(captionFor(AUDIO_PHASE.PLAYING)).toBe('');
  });
});
