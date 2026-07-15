/**
 * RED-FLOW: Q18 — LiteRT mid-conversation temperature/topP change is ignored (see DEVICE_TEST_LOG).
 *
 * Drives the REAL liteRTService.prepareConversation (our code) with only the native LiteRTModule
 * faked (data + arg recorder), injected via the codebase's proven jest.resetModules + doMock + fresh
 * require pattern (RN captures NativeModules at import, so a fake must be in place before the service
 * is required — this friction is itself part of "why it didn't just work"). resetConversation is the
 * ONLY channel that pushes samplerConfig to native. Asserts the CORRECT behavior — a mid-conversation
 * temp change reaches native — and is RED on HEAD because prepareConversation only re-applies on
 * needsReset (id/system/tools changed), so the new sampler is discarded for an ongoing conversation.
 * it.failing carrier. NOTE: if the fix adds a dedicated native sampler setter instead of re-calling
 * resetConversation, update the assertion to that setter — the intent is "temp 1.5 reaches native".
 */
const SYS = 'You are helpful.';

function loadLiteRT() {
  const nativeModule = {
    loadModel: jest.fn().mockResolvedValue({ backend: 'gpu', maxNumTokens: 4096 }),
    resetConversation: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendMessageWithImages: jest.fn(),
    sendMessageWithAudio: jest.fn(),
    stopGeneration: jest.fn(),
    unloadModel: jest.fn(),
    getMemoryInfo: jest.fn(),
  };
  const emitter = { addListener: jest.fn(() => ({ remove: jest.fn() })) };
  jest.resetModules();
  jest.doMock('react-native', () => ({
    NativeModules: { LiteRTModule: nativeModule },
    NativeEventEmitter: jest.fn(() => emitter),
    Platform: { OS: 'android', select: (s: Record<string, any>) => s.android ?? s.default ?? null },
  }));
  jest.doMock('../../../src/utils/logger', () => {
    const log = jest.fn();
    return { __esModule: true, default: { log, error: log, warn: log } };
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { liteRTService } = require('../../../src/services/litert');
  return { liteRTService, nativeModule };
}

describe('LiteRT sampler in-flow — red-flow (correct behavior; currently RED)', () => {
  it('Q18: changing temperature mid-conversation re-applies it to native (resetConversation gets 1.5)', async () => {
    const { liteRTService, nativeModule } = loadLiteRT();
    await liteRTService.loadModel('/m/model.litertlm', 'gpu', { maxNumTokens: 4096 });

    // Turn 1: open the conversation at temperature 0.2 (first prepare → native reset fires).
    await liteRTService.prepareConversation('conv-1', SYS, {
      samplerConfig: { temperature: 0.2, topK: 40, topP: 0.9 },
      history: [],
    });
    expect(nativeModule.resetConversation).toHaveBeenCalledTimes(1);

    // User drags Temperature to 1.5 mid-conversation; next send re-prepares the SAME conversation.
    await liteRTService.prepareConversation('conv-1', SYS, {
      samplerConfig: { temperature: 1.5, topK: 40, topP: 0.9 },
      history: [],
    });

    // Correct: native received temperature 1.5. Today: the 2nd prepare is a no-op (same id/sys/tools),
    // so resetConversation is never called with 1.5 and the model keeps sampling at 0.2.
    expect(nativeModule.resetConversation).toHaveBeenCalledWith(
      SYS, 1.5, expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );
  });
});
