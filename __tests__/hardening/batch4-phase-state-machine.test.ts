/**
 * BATCH 4 (Image Generation) — hardening.
 *
 * device cases 17, 18, 20, 22, 26 assert the OBSERVABLE image-generation
 * lifecycle: the in-progress card appears, its status transitions from an
 * enhancing phase to a generating phase, a second in-flight request is silently
 * ignored, cancel mid-flight tears the card down, and generation with
 * enhancement OFF never shows the enhancing phase.
 *
 * The existing integration suite asserts the DERIVED `isGenerating` boolean but
 * never the authoritative `phase` field itself — the single source of truth the
 * UI projects. This suite drives the REAL `imageGenerationService`, localDreamGenerator,
 * activeModelService and llmService (prompt enhancement) and asserts the ORDERED `phase`
 * transitions directly. Only the phone is faked (generationDevice: the image-generation native
 * module and its progress events, llama.rn, the disk, RAM).
 */
import { launchGeneration, type GenerationDevice } from '../harness/generationDevice';
import { SD_MNN_PACKAGE_FILES } from '../harness/imageModelPackage';
import type { ImageGenPhase } from '../../src/services/imageGenerationService';

let device: GenerationDevice;
let imageGenerationService: any;
let isInFlight: (phase: ImageGenPhase) => boolean;

const appState = () => device.useAppStore.getState();
const diffusion = () => device.boundary.diffusion;
/** The native image engine reports a step of the running generation. */
const nativeProgress = (step: number, totalSteps = 8) =>
  device.boundary.litertEvents.emit('LocalDreamProgress', { step, totalSteps, progress: step / totalSteps });
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

/** Record every distinct phase the service passes through, in order. */
function trackPhases(): { phases: ImageGenPhase[]; stop: () => void } {
  const phases: ImageGenPhase[] = [];
  const unsub = imageGenerationService.subscribe((s: { phase: ImageGenPhase }) => {
    if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
  });
  return { phases, stop: unsub };
}

/** A downloaded, already-warmed image model, selected for image generation. */
async function setupModel(enhanceImagePrompts = false): Promise<void> {
  const { modelManager } = require('../../src/services/modelManager');
  const modelPath = `${modelManager.getImageModelsDirectory()}/img-1`;
  for (const name of SD_MNN_PACKAGE_FILES) device.boundary.fs!.seedFile(`${modelPath}/${name}`, 1024 * 1024);
  const model = { id: 'img-1', name: 'Image One', description: '', size: 500 * 1024 * 1024, modelPath, backend: 'mnn' };
  await modelManager.addDownloadedImageModel(model);
  appState().addDownloadedImageModel(model);
  appState().setActiveImageModelId('img-1');
  appState().markImageModelWarmed('img-1'); // pre-warmed so the ~120s notice path is out of scope here
  appState().updateSettings({
    imageSteps: 8, imageGuidanceScale: 2, imageWidth: 256, imageHeight: 256, imageThreads: 4, enhanceImagePrompts,
  } as never);
}

beforeEach(async () => {
  device = await launchGeneration({ engine: 'llama' });
  ({ imageGenerationService, isInFlight } = require('../../src/services/imageGenerationService'));
});

describe('image-gen phase state machine — ordered transitions (cases 17, 18, 26)', () => {
  it('enhancement OFF: idle → loading → generating → done, never enters enhancing (case 26)', async () => {
    await setupModel(false);

    const { phases, stop } = trackPhases();
    await imageGenerationService.generateImage({ prompt: 'a red apple' });
    stop();

    // Starts idle (initial snapshot), never shows the enhancing phase when OFF,
    // ends at the terminal done phase.
    expect(phases[0]).toBe('idle');
    expect(phases).not.toContain('enhancing');
    expect(phases).toContain('loading');
    expect(phases).toContain('generating');
    expect(phases[phases.length - 1]).toBe('done');
    // loading must precede generating (case 18 direction, without enhancement).
    expect(phases.indexOf('loading')).toBeLessThan(phases.indexOf('generating'));
  });

  it('enhancement ON: passes through enhancing BEFORE loading/generating (cases 17, 18)', async () => {
    await setupModel(true);
    // The selected text model rewrites the prompt.
    device.boundary.llama!.scriptCompletion({ text: 'an enhanced red apple, studio lighting' });

    const { phases, stop } = trackPhases();
    await imageGenerationService.generateImage({ prompt: 'a red apple' });
    stop();

    expect(phases).toContain('enhancing');
    expect(phases).toContain('generating');
    // enhancing must come strictly before generating (the status transition case 18).
    expect(phases.indexOf('enhancing')).toBeLessThan(phases.indexOf('generating'));
    expect(phases[phases.length - 1]).toBe('done');
    // The engine drew the enhanced prompt.
    expect(diffusion().calls.generateImage[0].prompt).toContain('an enhanced red apple');
  });

  it('the generating status advances the step counter toward totalSteps (case 19)', async () => {
    await setupModel(false);
    diffusion().holdNextGeneration();

    const steps: number[] = [];
    const unsub = imageGenerationService.subscribe((s: { progress: { step: number } | null }) => {
      if (s.progress) steps.push(s.progress.step);
    });
    const run = imageGenerationService.generateImage({ prompt: 'apple' });
    while (!diffusion().generationHeld()) await settle();
    nativeProgress(1);
    nativeProgress(3);
    diffusion().releaseGeneration();
    await run;
    unsub();

    expect(Math.max(...steps)).toBeGreaterThanOrEqual(3);
    // monotonic non-decreasing during the run
    const generating = steps.filter(n => n > 0);
    for (let i = 1; i < generating.length; i++) expect(generating[i]).toBeGreaterThanOrEqual(generating[i - 1]);
  });
});

describe('illegal transition guard — a 2nd in-flight request is ignored (case 22)', () => {
  it('does not start a second generation and leaves the first phase/progress untouched', async () => {
    await setupModel(false);
    diffusion().holdNextGeneration();

    const gen1 = imageGenerationService.generateImage({ prompt: 'first' });
    while (!diffusion().generationHeld()) await settle();
    nativeProgress(2);
    await settle();

    const phaseDuring = imageGenerationService.getState().phase;
    const progressDuring = imageGenerationService.getState().progress;
    expect(isInFlight(phaseDuring)).toBe(true);

    // Second request while in-flight → returns null, the native engine is not asked again.
    const gen2 = await imageGenerationService.generateImage({ prompt: 'second' });
    expect(gen2).toBeNull();
    expect(diffusion().calls.generateImage).toHaveLength(1);
    // First generation's phase and progress are unchanged (no reset to step 0).
    expect(imageGenerationService.getState().phase).toBe(phaseDuring);
    expect(imageGenerationService.getState().progress).toEqual(progressDuring);

    diffusion().releaseGeneration();
    await gen1;
  });
});

describe('cancel mid-flight resets the machine to idle (case 20)', () => {
  it('transitions an in-flight generation back to idle and clears progress/prompt', async () => {
    await setupModel(false);
    diffusion().holdNextGeneration();

    const run = imageGenerationService.generateImage({ prompt: 'cancel me' });
    while (!diffusion().generationHeld()) await settle();
    expect(isInFlight(imageGenerationService.getState().phase)).toBe(true);

    await imageGenerationService.cancelGeneration();

    const s = imageGenerationService.getState();
    expect(s.phase).toBe('idle');
    expect(isInFlight(s.phase)).toBe(false);
    expect(s.progress).toBeNull();
    expect(s.prompt).toBeNull();
    // The native engine was told to stop.
    expect(diffusion().cancelCount()).toBe(1);
    await run;
  });
});

describe('no-model / load-failure surface an error phase, never a silent hang (cases 30, 38)', () => {
  it('no active image model → error phase with a clear message, generateImage returns null', async () => {
    appState().updateSettings({ imageSteps: 8, imageGuidanceScale: 2 } as never);

    const result = await imageGenerationService.generateImage({ prompt: 'no model' });

    expect(result).toBeNull();
    const s = imageGenerationService.getState();
    expect(s.phase).toBe('error');
    expect(s.error).toContain('No image model');
    expect(isInFlight(s.phase)).toBe(false); // not hung in an in-flight phase
  });

  it('image model load failure → error phase, not stuck in loading (case 38)', async () => {
    await setupModel(false);
    // The native engine cannot open the weights.
    diffusion().module.loadModel.mockRejectedValueOnce(new Error('weights corrupted'));

    const result = await imageGenerationService.generateImage({ prompt: 'broken model' });

    expect(result).toBeNull();
    const s = imageGenerationService.getState();
    expect(s.phase).toBe('error');
    expect(s.error).toContain('Failed to load image model');
    expect(isInFlight(s.phase)).toBe(false);
  });
});
