/**
 * VOICE MODE streaming auto-speak — CONTENT guards.
 *
 * As a reply streams in voice mode, the pro streaming coordinator feeds sentences
 * to the TTS engine live. This pins the EXACT segments handed to engine.speak()
 * for replies that contain a thinking block or a tool call — the terminal
 * artifact a user hears mid-stream. The parsing seam (parseThinkingContent /
 * stripControlTokens) is shared across engines {llama, litert}, so a single
 * coordinator-level guard covers both.
 *
 * Deleting the thinking/tool-call withholding must fail these — they assert the
 * spoken segments, never "was called".
 */
import logger from '@offgrid/core/utils/logger';

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockEngine = {
  speak: jest.fn(() => Promise.resolve()),
  getActiveVoice: jest.fn(() => null),
  getPhase: jest.fn(() => 'ready'),
  release: jest.fn().mockResolvedValue(undefined),
  isFullyDownloaded: jest.fn(() => true),
  getRequiredAssets: jest.fn(() => [{ sizeBytes: 320 * 1024 * 1024 }]),
  capabilities: { peakRamMB: 320 },
  displayName: 'Mock',
};
jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: { getActiveEngine: jest.fn(() => mockEngine) },
}));
jest.mock('@offgrid/core/services/modelResidency', () => ({
  modelResidencyManager: { canLoadWithoutEviction: jest.fn(() => false) },
}));
jest.mock('../../../pro/audio/ttsStore', () => ({
  useTTSStore: { getState: jest.fn(), setState: jest.fn() },
}));

import { useTTSStore } from '../../../pro/audio/ttsStore';
import { feedStreamingText, finishStreamingText, resetStreamingSpeech } from '../../../pro/audio/streamingSpeech';

const store = useTTSStore as unknown as { getState: jest.Mock; setState: jest.Mock };
const flush = () => new Promise<void>((r) => setImmediate(r));
let state: Record<string, any>;

const spokenSegments = () => (mockEngine.speak.mock.calls as unknown as string[][]).map((c) => c[0]);

beforeEach(async () => {
  jest.clearAllMocks();
  mockEngine.speak.mockImplementation(() => Promise.resolve());
  state = {
    settings: { interfaceMode: 'audio', enabled: true, speed: 1, engineId: 'kokoro', voiceByEngine: {} },
    isReady: true, playbackElapsed: 0, playSessionId: 0, currentMessageId: null, playbackStatus: 'idle',
    initializeEngine: jest.fn().mockResolvedValue(undefined),
  };
  store.getState.mockImplementation(() => state);
  store.setState.mockImplementation((partial: any) => {
    const p = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...p };
  });
  resetStreamingSpeech();
  await flush();
});

describe('voice-mode streaming: thinking is never spoken', () => {
  it('a reply that streams <think>…</think> then the answer speaks ONLY the answer', async () => {
    // Thinking streams first (withheld), then the visible answer.
    feedStreamingText('<think>let me reason about this quietly');
    await flush();
    feedStreamingText('<think>let me reason about this quietly</think>The sky is blue. ');
    await flush();
    finishStreamingText('<think>let me reason about this quietly</think>The sky is blue. Water is wet.', 'm');
    await flush();
    await flush();

    const spoken = spokenSegments().join(' ');
    expect(spoken).not.toMatch(/reason about this/i);
    expect(spoken).not.toContain('<think>');
    expect(spoken).toContain('The sky is blue.');
    expect(spoken).toContain('Water is wet.');
  });
});

describe('voice-mode streaming: tool-call markup is never spoken', () => {
  it('a complete tool-call block mid-answer is stripped from the spoken segments', async () => {
    feedStreamingText('Let me look. ');
    await flush();
    feedStreamingText('Let me look. <tool_call>{"name":"search","q":"weather"}</tool_call> ');
    await flush();
    finishStreamingText('Let me look. <tool_call>{"name":"search","q":"weather"}</tool_call> All set.', 'm');
    await flush();
    await flush();

    const spoken = spokenSegments().join(' ');
    expect(spoken).not.toContain('tool_call');
    expect(spoken).not.toContain('search');
    expect(spoken).not.toContain('weather');
    expect(spoken).toContain('Let me look.');
    expect(spoken).toContain('All set.');
  });

  it('a still-forming tool-call opener at the stream tail is WITHHELD, not spoken', async () => {
    // A dangling "<tool_cal" (no closing >) must never be handed to speak().
    feedStreamingText('Working on it. <tool_cal');
    await flush();
    const spoken = spokenSegments().join(' ');
    expect(spoken).not.toContain('<tool_cal');
    expect(spoken).not.toContain('tool_cal');
  });
});
