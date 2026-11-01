/**
 * DRY / single-owner — generationToolLoop routes through the ONE engine-caps owner (src/services/engines.ts).
 *
 * generationToolLoop used to re-derive "which engine is active" INLINE: isLiteRTActive() read the store AND
 * conflated it with `liteRTService.isModelLoaded()`, instead of the owner getActiveEngineService()
 * (=== liteRTService), which defines "active engine" WITHOUT the loaded check. isUsingRemote /
 * callLLMWithRetry / selectEffectiveSchemas each also re-inlined the activeServer+hasProvider+!localLoaded
 * rule that engines.isRemoteTextModelActive() OWNS. #510 (4d88c249) promised a single source for active caps.
 *
 * This test drives the REAL runToolLoop over the REAL engines.ts, llmService, liteRTService, providers and
 * stores. Only the device and the network are faked (generationDevice: the LiteRT native module, llama.rn,
 * the disk, RAM, and an OpenAI-compatible server on the LAN). It asserts the loop's engine choice — read off
 * which native engine or server actually received the turn — MATCHES the owner's verdict. The GUARD case is
 * the exact input where the inline derivation and the owner DISAGREE — a LiteRT model selected but not yet
 * loaded: the owner names `litert`, the old inline conflation names `llama`.
 */
import { launchGeneration, connectServer, type GenerationDevice, type ServerHandle } from '../../harness/generationDevice';

type Engine = 'litert' | 'remote' | 'llama';

/** What each engine had received before the turn, so only this turn's traffic counts. */
function snapshot(device: GenerationDevice, server?: ServerHandle) {
  const litert = device.boundary.litert.calls;
  return {
    litert: litert.sendMessage.length + litert.sendMessageWithMedia.length,
    llama: device.boundary.llama!.calls.completion.length,
    remote: server?.requests.length ?? 0,
  };
}

/** The engine the loop ACTUALLY routed to, read off the native engine or server that got the turn. */
function engineTheLoopUsed(device: GenerationDevice, before: ReturnType<typeof snapshot>, server?: ServerHandle): Engine {
  const now = snapshot(device, server);
  const used: Engine[] = [];
  if (now.litert > before.litert) used.push('litert');
  if (now.remote > before.remote) used.push('remote');
  if (now.llama > before.llama) used.push('llama');
  expect(used).toHaveLength(1);
  return used[0];
}

/** The engine the OWNER (engines.ts) names as active — the single source of truth. */
function engineOwnerNames(device: GenerationDevice): Engine {
  const { getActiveEngineService, isRemoteTextModelActive } = require('../../../src/services/engines');
  if (isRemoteTextModelActive()) return 'remote';
  return getActiveEngineService() === device.liteRTService ? 'litert' : 'llama';
}

async function runTurn(device: GenerationDevice): Promise<void> {
  const { runToolLoop } = require('../../../src/services/generationToolLoop');
  const thread = device.ask('what is the capital of France');
  await runToolLoop({
    conversationId: device.conversationId,
    messages: thread,
    enabledToolIds: ['web_search'],
    isAborted: () => false,
    onThinkingDone: () => {},
    onStream: () => {},
    onFinalResponse: () => {},
  });
}

describe('generationToolLoop routes to the engine the engines.ts owner names', () => {
  it('GUARD (divergence input): a LiteRT model is active but not-yet-loaded — owner names litert, so the loop must route to LiteRT (not llama)', async () => {
    // The inline conflation `engine==='litert' && liteRTService.isModelLoaded()` disagrees with the owner
    // getActiveEngineService() (which does NOT check loaded) exactly here.
    const device = await launchGeneration({ engine: 'litert', load: false });
    device.boundary.litert.scriptTurn({ content: 'Paris' });
    const before = snapshot(device);

    // Nothing is loaded, so the engine the loop picked refuses the turn — and its refusal names it.
    // liteRTService says "No LiteRT model loaded"; llmService (the old inline choice) says "No model loaded".
    const outcome = await runTurn(device).then(() => null, (error: Error) => error);

    expect(engineOwnerNames(device)).toBe('litert');
    expect(outcome?.message).toBe('No LiteRT model loaded');
    expect(device.boundary.llama!.calls.completion.length).toBe(before.llama);
  });

  it('LiteRT active and loaded: loop routes to LiteRT, matching getActiveEngineService()', async () => {
    const device = await launchGeneration({ engine: 'litert' });
    device.boundary.litert.scriptTurn({ content: 'Paris' });
    const before = snapshot(device);

    await runTurn(device);

    expect(engineOwnerNames(device)).toBe('litert');
    expect(engineTheLoopUsed(device, before)).toBe(engineOwnerNames(device));
  });

  it('llama active and loaded: loop routes to llama, matching getActiveEngineService()', async () => {
    const device = await launchGeneration({ engine: 'llama' });
    device.boundary.llama!.scriptCompletion({ text: 'Paris' });
    const before = snapshot(device);

    await runTurn(device);

    expect(engineOwnerNames(device)).toBe('llama');
    expect(engineTheLoopUsed(device, before)).toBe(engineOwnerNames(device));
  });

  it('remote active (server selected, no local loaded): loop routes remote, matching isRemoteTextModelActive()', async () => {
    const device = await launchGeneration({ localModel: false });
    const server = await connectServer(device);
    server.reply({ content: ['Paris'] });
    const before = snapshot(device, server);

    try {
      await runTurn(device);
      expect(engineOwnerNames(device)).toBe('remote');
      expect(engineTheLoopUsed(device, before, server)).toBe(engineOwnerNames(device));
    } finally {
      server.restore();
    }
  });
});
