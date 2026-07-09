/**
 * turnSpeech — the single "speak a completed assistant turn" owner. Verifies it
 * speaks the final assistant message in voice mode (warming the engine via the
 * store's speak, never pre-gating on isReady), flushes the streamed partial when
 * streaming was active, bails outside audio mode / on non-speakable messages, and
 * that the image-generation state machine drives it on the transition to 'done'.
 */
jest.mock('@offgrid/core/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../../pro/audio/ttsLog', () => ({ smLog: jest.fn() }));
jest.mock('@offgrid/core/utils/messageContent', () => ({
  stripControlTokens: (s: string) => s,
  stripMarkdownForSpeech: (s: string) => s,
}));

const mockSpeak = jest.fn().mockResolvedValue(undefined);
const mockUpdateMessageAudio = jest.fn();
let mockConversations: any[] = [];
let mockTtsState: any;

jest.mock('../../../pro/audio/ttsStore', () => ({
  useTTSStore: { getState: jest.fn(() => mockTtsState) },
}));
jest.mock('@offgrid/core/stores', () => ({
  useChatStore: { getState: jest.fn(() => ({ conversations: mockConversations, updateMessageAudio: mockUpdateMessageAudio })) },
}));

const mockIsStreamingActive = jest.fn(() => false);
const mockFinishStreaming = jest.fn();
jest.mock('../../../pro/audio/streamingSpeech', () => ({
  isStreamingSpeechActive: () => mockIsStreamingActive(),
  finishStreamingText: (...a: any[]) => mockFinishStreaming(...a),
}));

let mockImageListener: ((state: any) => void) | null = null;
jest.mock('@offgrid/core/services/imageGenerationService', () => ({
  imageGenerationService: {
    subscribe: (listener: (s: any) => void) => { mockImageListener = listener; listener({ phase: 'idle', conversationId: null }); return () => { mockImageListener = null; }; },
  },
}));

import { speakCompletedTurn, initTurnSpeech } from '../../../pro/audio/turnSpeech';

const assistantMsg = (content: string, extra: any = {}) => ({ id: 'm1', role: 'assistant', content, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  mockIsStreamingActive.mockReturnValue(false);
  mockTtsState = { settings: { interfaceMode: 'audio', speed: 1 }, isReady: false, speak: mockSpeak };
  mockConversations = [{ id: 'c1', messages: [{ id: 'u1', role: 'user', content: 'draw a horse' }, assistantMsg('Generated image for: draw a horse')] }];
});

describe('speakCompletedTurn', () => {
  it('speaks the final assistant message in audio mode even when the engine is cold (no isReady pre-gate)', () => {
    speakCompletedTurn('c1');
    expect(mockSpeak).toHaveBeenCalledWith('Generated image for: draw a horse', 'm1');
    expect(mockUpdateMessageAudio).toHaveBeenCalledWith('c1', 'm1', expect.objectContaining({ isAudioModeMessage: true }));
  });

  it('bails when not in audio mode', () => {
    mockTtsState.settings.interfaceMode = 'chat';
    speakCompletedTurn('c1');
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('flushes the streamed partial (does not re-speak) when streaming was active', () => {
    mockIsStreamingActive.mockReturnValue(true);
    speakCompletedTurn('c1');
    expect(mockFinishStreaming).toHaveBeenCalledWith('Generated image for: draw a horse', 'm1');
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('bails on a non-speakable last message (system info)', () => {
    mockConversations = [{ id: 'c1', messages: [assistantMsg('x', { isSystemInfo: true })] }];
    speakCompletedTurn('c1');
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('bails on a voice note that already has audio', () => {
    mockConversations = [{ id: 'c1', messages: [assistantMsg('x', { audioPath: '/a.wav' })] }];
    speakCompletedTurn('c1');
    expect(mockSpeak).not.toHaveBeenCalled();
  });
});

describe('initTurnSpeech (image generation → speak)', () => {
  it('speaks the result when image generation transitions to done', () => {
    initTurnSpeech();
    expect(mockImageListener).toBeTruthy();
    // not done yet → no speech
    mockImageListener!({ phase: 'generating', conversationId: 'c1' });
    expect(mockSpeak).not.toHaveBeenCalled();
    // transition to done → speak the result message
    mockImageListener!({ phase: 'done', conversationId: 'c1' });
    expect(mockSpeak).toHaveBeenCalledWith('Generated image for: draw a horse', 'm1');
  });

  it('does not re-speak while staying in done (fires once per turn)', () => {
    initTurnSpeech();
    mockImageListener!({ phase: 'done', conversationId: 'c1' });
    mockImageListener!({ phase: 'done', conversationId: 'c1' });
    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });
});
