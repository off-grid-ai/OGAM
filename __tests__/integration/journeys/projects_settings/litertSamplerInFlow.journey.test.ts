/**
 * Journey (cluster C): TEXT sampler settings-in-flow on the LiteRT engine.
 *
 * NEW bug hunt (NOT one of Q1–Q13): on LiteRT, the sampler config (temperature/topP) is
 * only pushed to the native runtime by resetConversation(). prepareConversation() calls
 * resetConversation() ONLY when the conversation id / system prompt / tools change
 * (`needsReset`). For an ONGOING conversation, changing Temperature mid-chat updates the
 * store + the value read fresh in generationServiceHelpers (samplerConfig) — but
 * prepareConversation short-circuits, so the NEW samplerConfig is NEVER handed to the
 * applier. The value SHOWN (modal slider) diverges from the value the model CONSUMES
 * until the conversation resets (new chat / system-prompt change / compaction).
 *
 * Contrast: llama re-applies temperature on EVERY ctx.completion() call
 * (buildCompletionParams inside generateResponse), so the same mid-chat change is honoured
 * immediately. Engine-specific divergence — a leaked concrete difference.
 *
 * We drive the REAL litert.ts prepareConversation gate and spy the resetConversation
 * applier (the seam that would carry the new temperature to native). The assertion is
 * WHETHER the applier receives the new samplerConfig — not merely that some method ran.
 */

import { liteRTService } from '../../../../src/services/litert';

describe('Journey C — LiteRT sampler settings-in-flow (NEW: mid-chat temperature drift)', () => {
  let resetSpy: jest.SpyInstance;

  beforeEach(() => {
    // Put the service into a "model loaded" state so prepareConversation runs its gate.
    (liteRTService as any).loaded = true;
    (liteRTService as any).activeBackend = 'gpu';
    (liteRTService as any).activeConversationId = null;
    (liteRTService as any).activeSystemPrompt = null;
    (liteRTService as any).activeToolsJson = '';
    (liteRTService as any).cumulativeTokens = 0;
    (liteRTService as any).configuredMaxTokens = 4096;
    jest.spyOn(liteRTService, 'isAvailable').mockReturnValue(true);
    // Spy the applier — the ONLY path that hands a samplerConfig to the native runtime.
    // Stub it (don't hit the native module) but record what it was asked to apply.
    resetSpy = jest.spyOn(liteRTService, 'resetConversation').mockImplementation(async (systemPrompt: string) => {
      (liteRTService as any).activeSystemPrompt = systemPrompt;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  /** temperature the applier was asked to apply on its Nth (0-based) invocation. */
  const appliedTempOnCall = (n: number): number | undefined =>
    resetSpy.mock.calls[n]?.[1]?.samplerConfig?.temperature;

  it('BUG (new): a mid-conversation temperature change is NEVER applied — the gate skips the applier for an ongoing conversation', async () => {
    const conversationId = 'conv-A';
    const systemPrompt = 'You are helpful.';

    // Turn 1: new conversation → gate opens, applier runs with temperature 0.2.
    await liteRTService.prepareConversation(conversationId, systemPrompt, {
      samplerConfig: { temperature: 0.2, topP: 0.9 },
    });
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(appliedTempOnCall(0)).toBe(0.2);

    // User drags Temperature to 1.5 mid-chat. Next send: SAME id, SAME system prompt, no tools.
    await liteRTService.prepareConversation(conversationId, systemPrompt, {
      samplerConfig: { temperature: 1.5, topP: 0.9 },
    });

    // THE BUG: needsReset is false → the applier is NOT called again → native stays at 0.2.
    // The value shown (1.5) is never the value the running LiteRT conversation consumes.
    expect(resetSpy).toHaveBeenCalledTimes(1); // no second apply
    expect(appliedTempOnCall(1)).toBeUndefined();
  });

  it('the SAME change IS applied once the system prompt changes (switching project) — proving the gate is the cause', async () => {
    const conversationId = 'conv-B';
    await liteRTService.prepareConversation(conversationId, 'Prompt v1', {
      samplerConfig: { temperature: 0.2 },
    });
    expect(appliedTempOnCall(0)).toBe(0.2);

    // Changing the system prompt (e.g. filing the chat under a project) trips needsReset,
    // and only THEN does the (independently-changed) temperature reach the applier.
    await liteRTService.prepareConversation(conversationId, 'Prompt v2 (new project)', {
      samplerConfig: { temperature: 1.5 },
    });
    expect(resetSpy).toHaveBeenCalledTimes(2);
    expect(appliedTempOnCall(1)).toBe(1.5);
  });
});
