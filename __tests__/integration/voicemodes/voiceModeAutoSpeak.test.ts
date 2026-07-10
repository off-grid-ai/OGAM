/**
 * VOICE MODE auto-speak terminal-artifact guards.
 *
 * The bug hunt target: the EXACT text handed to the TTS engine's speak() when an
 * assistant turn completes in voice mode. We drive the REAL chatStore (a real
 * conversation + a real finalized assistant message) and the REAL turnSpeech
 * owner (speakCompletedTurn), mocking ONLY the TTS store boundary so we can
 * capture what text reaches speak(). Deleting turnSpeech's stripping (or the
 * mode gate) must fail these — they assert the spoken string, never "was called".
 *
 * Cross: content {plain, inline-<think>, tool-call, empty/thinking-only} × the
 * mode gate (audio vs chat). The engine layer itself is exercised by the pro
 * audio suites; here the assertion is the terminal artifact (spoken text).
 */
import { useChatStore } from '@offgrid/core/stores';

// Capture the text handed to TTS.speak — the terminal artifact of voice-mode auto-speak.
// Prefixed `mock*` so jest's hoisted factory may reference them.
const mockSpeakSpy = jest.fn();
const mockUpdateAudioSpy = jest.fn();
let mockTtsState: Record<string, unknown>;

jest.mock('../../../pro/audio/ttsStore', () => ({
  useTTSStore: { getState: jest.fn(() => mockTtsState) },
}));
// streamingSpeech: force the non-streaming branch (speak the whole message) so the
// assertion targets turnSpeech's own stripping, not the streaming coordinator.
jest.mock('../../../pro/audio/streamingSpeech', () => ({
  isStreamingSpeechActive: jest.fn(() => false),
  finishStreamingText: jest.fn(),
}));
jest.mock('../../../pro/audio/ttsLog', () => ({ smLog: jest.fn() }));
jest.mock('@offgrid/core/services/imageGenerationService', () => ({
  imageGenerationService: { subscribe: jest.fn(() => () => {}) },
}));

import { speakCompletedTurn } from '../../../pro/audio/turnSpeech';

const CONV = 'conv-voice';

function seedAssistant(content: string, extra: Record<string, unknown> = {}): string {
  const store = useChatStore.getState();
  const id = store.createConversation('model-x', 'test');
  // Overwrite the fixed conv id so tests are deterministic.
  const conv = useChatStore.getState().conversations.find((c) => c.id === id)!;
  useChatStore.setState({
    conversations: useChatStore.getState().conversations.map((c) =>
      c.id === id ? { ...conv, id: CONV } : c
    ),
  });
  const msg = useChatStore.getState().addMessage(CONV, { role: 'assistant', content, ...extra });
  return msg.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({ conversations: [], activeConversationId: null });
  mockTtsState = {
    settings: { interfaceMode: 'audio', speed: 1 },
    isReady: true,
    speak: mockSpeakSpy,
    updateMessageAudio: mockUpdateAudioSpy,
  };
  // updateMessageAudio is a chat-store action; turnSpeech calls the REAL one.
});

describe('voice-mode auto-speak: terminal spoken text', () => {
  it('plain answer → speaks the answer verbatim (markdown stripped)', () => {
    seedAssistant('Here is **bold** and a `code` word.');
    speakCompletedTurn(CONV);
    expect(mockSpeakSpy).toHaveBeenCalledTimes(1);
    // stripMarkdownForSpeech removes ** and ` — no literal markdown reaches TTS.
    expect(mockSpeakSpy.mock.calls[0][0]).toBe('Here is bold and a code word.');
  });

  it('inline <think> left in content → thinking is NOT spoken', () => {
    // A message whose stored content still carries inline reasoning (e.g. a
    // non-streamed add / restored message). The answer only must be spoken.
    seedAssistant('<think>secret plan the user must not hear</think>The final answer.');
    speakCompletedTurn(CONV);
    expect(mockSpeakSpy).toHaveBeenCalledTimes(1);
    const spoken = mockSpeakSpy.mock.calls[0][0] as string;
    expect(spoken).toBe('The final answer.');
    expect(spoken).not.toContain('secret');
  });

  it('answer with an embedded tool-call block → tool markup is NOT spoken', () => {
    seedAssistant('Let me check. <tool_call>{"name":"search"}</tool_call> Done looking.');
    speakCompletedTurn(CONV);
    const spoken = mockSpeakSpy.mock.calls[0][0] as string;
    expect(spoken).not.toContain('tool_call');
    expect(spoken).not.toContain('search');
    expect(spoken).toContain('Done looking.');
  });

  it('thinking-only content (empty answer) → speak NOT called (nothing to say)', () => {
    seedAssistant('<think>only reasoning, no answer</think>');
    speakCompletedTurn(CONV);
    expect(mockSpeakSpy).not.toHaveBeenCalled();
  });

  it('mode gate: chat mode → speak NOT called even for a speakable message', () => {
    mockTtsState.settings = { interfaceMode: 'chat', speed: 1 };
    seedAssistant('A perfectly speakable answer.');
    speakCompletedTurn(CONV);
    expect(mockSpeakSpy).not.toHaveBeenCalled();
  });

  it('last message already has audioPath (a played voice note) → not re-spoken', () => {
    seedAssistant('some content', { audioPath: '/tmp/a.wav' });
    speakCompletedTurn(CONV);
    expect(mockSpeakSpy).not.toHaveBeenCalled();
  });
});
