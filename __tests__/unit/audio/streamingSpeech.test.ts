/**
 * Streaming-speech coordinator — turns streaming assistant text into spoken
 * audio sentence-by-sentence. Verifies the gating (voice mode + engine ready),
 * thinking is never spoken, the queue drains through the engine, the trailing
 * partial is flushed on finish, and reset aborts.
 */
import logger from '@offgrid/core/utils/logger';

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockEngine = { speak: jest.fn().mockResolvedValue(undefined), getActiveVoice: jest.fn(() => null), displayName: 'Mock' };
jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: { getActiveEngine: jest.fn(() => mockEngine) },
}));

jest.mock('../../../pro/audio/ttsStore', () => ({
  useTTSStore: { getState: jest.fn(), setState: jest.fn() },
}));

import { useTTSStore } from '../../../pro/audio/ttsStore';
import {
  feedStreamingText, finishStreamingText, resetStreamingSpeech, isStreamingSpeechActive,
} from '../../../pro/audio/streamingSpeech';

const store = useTTSStore as unknown as { getState: jest.Mock; setState: jest.Mock };
const flush = () => new Promise<void>((r) => setImmediate(r));

let state: Record<string, any>;

function setMode(interfaceMode: 'chat' | 'audio', isReady: boolean) {
  state = {
    settings: { interfaceMode, enabled: true, speed: 1, engineId: 'kokoro', voiceByEngine: {} },
    isReady, playbackElapsed: 0, playSessionId: 0, currentMessageId: null, playbackStatus: 'idle',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEngine.speak.mockResolvedValue(undefined);
  setMode('audio', true);
  store.getState.mockImplementation(() => state);
  store.setState.mockImplementation((partial: any) => {
    const p = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...p };
  });
  resetStreamingSpeech();
  (logger as any); // referenced to keep import
});

describe('feedStreamingText gating', () => {
  it('does nothing in chat mode', async () => {
    setMode('chat', true);
    feedStreamingText('Hello there.');
    await flush();
    expect(mockEngine.speak).not.toHaveBeenCalled();
    expect(isStreamingSpeechActive()).toBe(false);
  });

  it('does nothing when the engine is not ready (and not already active)', async () => {
    setMode('audio', false);
    feedStreamingText('Hello there.');
    await flush();
    expect(mockEngine.speak).not.toHaveBeenCalled();
  });
});

describe('streaming playback', () => {
  it('speaks a completed sentence through the engine', async () => {
    feedStreamingText('Hello there. And mo');
    await flush();
    await flush();
    expect(mockEngine.speak).toHaveBeenCalledTimes(1);
    expect(mockEngine.speak.mock.calls[0][0]).toBe('Hello there.');
    expect(isStreamingSpeechActive()).toBe(true);
  });

  it('never speaks the thinking, only the answer', async () => {
    feedStreamingText('<think>internal reasoning here</think>The answer is yes.');
    await flush();
    await flush();
    expect(mockEngine.speak).toHaveBeenCalledTimes(1);
    expect(mockEngine.speak.mock.calls[0][0]).toBe('The answer is yes.');
    expect(mockEngine.speak.mock.calls[0][0]).not.toContain('reasoning');
  });

  it('flushes the trailing partial sentence on finish', async () => {
    feedStreamingText('First done. Trailing tail with no period');
    await flush();
    await flush();
    expect(mockEngine.speak).toHaveBeenCalledTimes(1); // "First done."
    finishStreamingText('First done. Trailing tail with no period', 'msg-1');
    await flush();
    await flush();
    expect(mockEngine.speak).toHaveBeenCalledTimes(2);
    expect(mockEngine.speak.mock.calls[1][0]).toBe('Trailing tail with no period');
  });
});

describe('lifecycle', () => {
  it('reset clears active state', async () => {
    feedStreamingText('Hello there.');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);
    resetStreamingSpeech();
    expect(isStreamingSpeechActive()).toBe(false);
  });

  it('finish returns false when nothing was streaming', () => {
    expect(finishStreamingText('anything', 'm')).toBe(false);
  });
});
