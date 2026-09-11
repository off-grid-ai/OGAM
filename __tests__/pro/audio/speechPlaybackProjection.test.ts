import {
  projectSpeechPlayback,
  STREAMING_SPEECH_MESSAGE_ID,
} from '../../../pro/audio/speechPlaybackProjection';

const idleShared = {
  status: 'idle' as const,
  activeOperationId: null,
};

const idleNative = {
  status: 'idle' as const,
  messageId: null,
  audioPath: null,
};

describe('speech playback projection', () => {
  it('uses Shared as the only lifecycle owner for streamed speech', () => {
    const playback = projectSpeechPlayback(
      {
        status: 'synthesizing',
        activeOperationId: 'mobile-stream-1',
      },
      {
        status: 'playing',
        messageId: 'saved-message',
        audioPath: '/saved/reply.wav',
      },
    );

    expect(playback).toEqual({
      owner: 'shared',
      status: 'preparing',
      messageId: STREAMING_SPEECH_MESSAGE_ID,
      audioPath: null,
      synth: true,
      stopDisabled: false,
    });
  });

  it('returns to idle after Shared ends a failed streamed operation', () => {
    const playback = projectSpeechPlayback(idleShared, {
      status: 'playing',
      messageId: STREAMING_SPEECH_MESSAGE_ID,
      audioPath: null,
    });

    expect(playback).toEqual({
      owner: 'none',
      status: 'idle',
      messageId: null,
      audioPath: null,
      synth: false,
      stopDisabled: false,
    });
  });

  it('keeps native state for manual saved-message playback', () => {
    const playback = projectSpeechPlayback(idleShared, {
      status: 'playing',
      messageId: 'saved-message',
      audioPath: '/saved/reply.wav',
    });

    expect(playback).toEqual({
      owner: 'native',
      status: 'playing',
      messageId: 'saved-message',
      audioPath: '/saved/reply.wav',
      synth: false,
      stopDisabled: false,
    });
  });

  it('does not expose a playback owner while both sources are idle', () => {
    expect(projectSpeechPlayback(idleShared, idleNative).owner).toBe('none');
  });
});
