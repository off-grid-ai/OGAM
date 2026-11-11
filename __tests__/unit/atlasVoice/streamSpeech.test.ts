/**
 * Call mode speaks the reply sentence by sentence while the AI is still writing it. Fakes only the
 * device boundary: the native voice module.
 */
import { NativeModules, Platform } from 'react-native';

const native = {
  setRate: jest.fn(async () => true),
  speakStreamStart: jest.fn(async () => true),
  speakStreamAppend: jest.fn(async () => true),
  speakStreamEnd: jest.fn(async () => true),
  stop: jest.fn(async () => true),
  addListener: jest.fn(), removeListeners: jest.fn(),
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(extra: Partial<typeof native> | Record<string, unknown> = {}) {
  Platform.OS = 'android';
  NativeModules.AtlasTts = { ...native, ...extra };
  const { useUiModeStore } = require('../../../src/stores/uiModeStore');
  const { useChatStore } = require('../../../src/stores/chatStore');
  const { useAtlasVoiceStore } = require('../../../src/atlasVoice/store');
  useUiModeStore.setState({ interfaceMode: 'audio' });
  useChatStore.setState({
    conversations: [{ id: 'c1', title: 'Call', messages: [{ id: 'u1', role: 'user', content: 'hi' }], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }],
    streamingForConversationId: 'c1',
  });
  useAtlasVoiceStore.getState().setSpeaking(null);
  require('../../../src/atlasVoice/streamSpeech').resetStreamSpeech();
  return { useAtlasVoiceStore, stream: require('../../../src/atlasVoice/streamSpeech') };
}

beforeEach(() => { jest.resetModules(); Object.values(native).forEach((f) => (f as jest.Mock).mockClear()); });

it('speaks each sentence as soon as it is written, then the rest and the end when the reply finishes', async () => {
  const { stream } = setup();
  stream.onStreamToken('Sure, I can help');
  await flush();
  expect(native.speakStreamStart).toHaveBeenCalledTimes(1);
  expect(native.speakStreamAppend).not.toHaveBeenCalled(); // no sentence is complete yet

  stream.onStreamToken('Sure, I can help. The answer is four. And ');
  await flush();
  expect(native.speakStreamAppend.mock.calls.map((c: any[]) => c[0].trim())).toEqual(['Sure, I can help. The answer is four.']);

  stream.onStreamToken('Sure, I can help. The answer is four. And that is all');
  const whole = jest.fn();
  expect(stream.finishStreamSpeech('c1', whole)).toBe(true);
  await flush();
  expect(native.speakStreamAppend.mock.calls.map((c: any[]) => c[0].trim())).toEqual(['Sure, I can help. The answer is four.', 'And that is all']);
  expect(native.speakStreamEnd).toHaveBeenCalledTimes(1);
  expect(whole).not.toHaveBeenCalled();
});

it('leaves a reply to the old whole-reply speech when the phone voice cannot take streamed text', async () => {
  const { stream } = setup({ speakStreamStart: undefined });
  stream.onStreamToken('Hello there. How are you? ');
  await flush();
  expect(native.speakStreamAppend).not.toHaveBeenCalled();
  expect(stream.finishStreamSpeech('c1', jest.fn())).toBe(false);
});

it('goes quiet when the person talks over it, and does not speak the rest of that reply', async () => {
  const { stream, useAtlasVoiceStore } = setup();
  stream.onStreamToken('First sentence here. Second one is');
  await flush();
  useAtlasVoiceStore.getState().setSpeaking(null); // barge-in / a tap stops the voice
  stream.onStreamToken('First sentence here. Second one is long. Third one follows. ');
  await flush();
  expect(native.speakStreamAppend).toHaveBeenCalledTimes(1); // only the sentence from before the interruption
  // The finished reply has been added to the chat by the time the end is reported.
  const { useChatStore } = require('../../../src/stores/chatStore');
  useChatStore.setState((st: any) => ({ conversations: st.conversations.map((c: any) => ({ ...c, messages: [...c.messages, { id: 'a1', role: 'assistant', content: 'First sentence here.' }] })) }));
  expect(stream.finishStreamSpeech('c1', jest.fn())).toBe(true); // handled: nothing else is spoken
  expect(native.speakStreamEnd).not.toHaveBeenCalled();
});

it('finds where complete sentences end, and starts a long first sentence at a comma', () => {
  const { sentenceEnd } = require('../../../src/atlasVoice/streamSpeech');
  expect(sentenceEnd('One. Two. Thr', 0)).toBe('One. Two. '.length);
  expect(sentenceEnd('Pi is 3.14 roughly', 0)).toBe(0); // a decimal point is not a sentence end
  const long = `${'word '.repeat(12)}and then some more words, ${'filler '.repeat(14)}`;
  expect(sentenceEnd(long, 0)).toBeGreaterThan(40);
});
