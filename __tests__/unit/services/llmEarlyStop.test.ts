/**
 * A Stop pressed before the native completion starts must stop the reply.
 *
 * llama.rn clears a stop when a completion starts, so a Stop that arrives while the turn is still preparing
 * its messages used to be lost: the reply then ran to the end, and Stop waited for all of it.
 *
 * The phone is the boundary: llama.rn (harness/nativeBoundary, with llama.rn's own stop semantics). The model
 * loads through activeModelService, and the chat, generation service and llm service run for real.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';

let d: GenerationDevice;
beforeEach(async () => {
  d = await launchGeneration();
});

it('a Stop pressed before the completion starts stops the reply, with no tokens generated', async () => {
  d.boundary.llama!.scriptCompletion({ text: 'A long answer that should never be streamed.' });
  const completionCalls = d.nativeContext()!.completion.mock.calls.length;

  const reply = d.llmService.generateResponse(d.ask('Tell me a story')).catch(() => '');
  // The Stop lands while the turn is still preparing its messages.
  await d.llmService.stopGeneration();
  const answer = await reply;

  expect(answer).toBe('');
  expect(d.nativeContext()!.completion.mock.calls.length).toBe(completionCalls);
  expect(d.llmService.isCurrentlyGenerating?.() ?? false).toBe(false);
});

it('the next reply after an early Stop runs normally', async () => {
  const first = d.llmService.generateResponse(d.ask('First')).catch(() => '');
  await d.llmService.stopGeneration();
  await first;

  d.boundary.llama!.scriptCompletion({ text: 'Second answer' });
  expect(await d.llmService.generateResponse(d.ask('Second'))).toBe('Second answer');
});
