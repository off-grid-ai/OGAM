/**
 * Why a model would not load, as the person is told.
 *
 * A llama model neither GPU nor CPU could open used to read as "Not enough memory" every time, because the
 * combined error said "may indicate insufficient memory" and the classifier matched the word. Now the cause
 * decides: only a real allocation failure is out of memory; a damaged or unsupported file says so, with the
 * next step.
 *
 * The phone is the boundary: llama.rn refuses the load with what llama.cpp says (harness/nativeBoundary). The
 * load runs through activeModelService, and the failure goes to the same card the chat shows.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';

let d: GenerationDevice;

/** Load the downloaded model while llama.cpp refuses it with `message`; return the card the person sees. */
async function failedLoad(message?: string) {
  d = await launchGeneration({ load: false });
  d.boundary.llama!.scriptInitFailure(true, message);
  const error = await d.activeModelService.loadTextModel(d.modelId).then(() => null, (e: unknown) => e);
  expect(error).not.toBeNull();
  const { reportModelFailure } = require('../../../src/services/modelFailureHandler');
  return reportModelFailure('text', error) as { title: string; message: string; memoryPressure?: boolean };
}

it('a damaged or unsupported model file says so, with the next step, not "Not enough memory"', async () => {
  const card = await failedLoad('Failed to load model: unsupported architecture');
  expect(card.title).toMatch(/can't be loaded/);
  expect(card.message).toMatch(/damaged or unsupported/);
  expect(card.message).toMatch(/download it again/);
  expect(card.memoryPressure).toBe(false);
});

it('a real allocation failure reads as out of memory', async () => {
  const card = await failedLoad('ggml_backend_cpu_buffer_type_alloc_buffer: failed to allocate buffer of size 4294967296');
  expect(card.title).toMatch(/Not enough memory/);
  expect(card.memoryPressure).toBe(true);
});
