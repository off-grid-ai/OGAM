import { prepareStreamingAnswerForSpeech } from '../../../pro/audio/streamingSpeechText';

describe('streaming speech text boundary', () => {
  it('keeps the answer from Core without running a second reasoning classifier', () => {
    const answer =
      'Thinking Process is the title of the book I recommend. The answer is complete.';

    expect(prepareStreamingAnswerForSpeech(answer)).toBe(answer);
  });

  it('withholds a control-token prefix that is not complete yet', () => {
    expect(prepareStreamingAnswerForSpeech('Ready to speak.<|tool')).toBe(
      'Ready to speak.',
    );
  });
});
