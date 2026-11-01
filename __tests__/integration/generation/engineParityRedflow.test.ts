/**
 * RED-FLOW: engine-parity bugs — Q17 (see docs/DEVICE_TEST_LOG.md).
 *
 * Drives the REAL runToolLoop → callLiteRTForLoop → liteRTService with a LiteRT model downloaded,
 * selected and loaded through activeModelService, and a tool enabled. Only the device is faked
 * (generationDevice: the LiteRT native module, llama.rn, the disk, RAM). Asserts the CORRECT behavior:
 * a voice note's transcript reaches the native model as text and NO audio file is sent with it.
 */
import { launchGeneration } from '../../harness/generationDevice';

const voiceNote = (uri: string, transcript: string) =>
  ({ id: `a-${uri}`, type: 'audio', uri, audioFormat: 'wav', textContent: transcript });

describe('engine parity — red-flow', () => {
  it('Q17: a voice note + a tool enabled on LiteRT sends the TRANSCRIPT and NO audio to the native model', async () => {
    const device = await launchGeneration({ engine: 'litert' });
    const { runToolLoop } = require('../../../src/services/generationToolLoop');
    const litert = device.boundary.litert;
    litert.scriptTurn({ content: 'Paris' }); // a plain answer, no tool call → the loop ends
    const sentBefore = litert.calls.sendMessage.length; // the load's own warm-up turn

    const thread = device.ask('what is the capital of France', [
      // the transcript is already in content; the note sits at a stale container path
      voiceNote('/stale/container/xyz/Documents/vn.wav', 'what is the capital of France') as never,
    ]);

    await runToolLoop({
      conversationId: device.conversationId,
      messages: thread,
      enabledToolIds: ['web_search'],
      isAborted: () => false,
      onThinkingDone: () => {},
      onStream: () => {},
      onFinalResponse: () => {},
    });

    // The native model got the transcript as text…
    const turn = litert.calls.sendMessage.slice(sentBefore);
    expect(turn).toHaveLength(1);
    expect(String(turn[0][0])).toContain('what is the capital of France');
    // …and never an audio file: audio is transcript-only, never model input.
    expect(litert.module.sendMessageWithAudio).not.toHaveBeenCalled();
    expect(litert.calls.sendMessageWithMedia).toHaveLength(0);
  });
});
