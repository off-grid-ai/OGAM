/**
 * Scribe Improve below the screen: what the phone's own model gives back, and the live checks.
 *
 * SPEC: Improve needs a text model and says so when there is none. With one loaded, one version
 * streams as it is written; "Another version" asks for a new one that differs from those shown, and
 * a reasoning model's think block is never shown or returned. A model that thinks even with thinking off
 * still has room to answer after a long think block; one that thinks past the whole budget says so,
 * with another text model on the phone to try. Improve never loads a second copy of the chat's
 * model, and never forces a load the memory guard refuses: it names a smaller model that fits.
 * When the model is large or thinks first, Improve offers a quicker one: on the phone, or else the
 * smallest of this phone's picks; a quick model gets no offer. The live checks flag a misspelt word with a
 * fix, Fix all applies the fixes, a word I add to the dictionary is never flagged again, and an
 * issue I ignore stays hidden.
 *
 * Real rewriteService, writingEngine, engines, llmService, stores and @offgrid/writing. Models are
 * imported, picked and loaded through the app's own paths. Device boundaries only: llama.rn, the disk, the RAM sensor (installNativeBoundary) and AsyncStorage.
 */
import { installNativeBoundary, GB, type NativeBoundary } from '../../harness/nativeBoundary';
import { importAndPickTextModel, importTextModel } from '../../harness/phoneTextModel';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type RewriteModule = typeof import('../../../pro/scribe/rewriteService');
type EngineModule = typeof import('../../../pro/scribe/writingEngine');

// The Models screen's import runs on the real navigation stack.
jest.unmock('@react-navigation/native');

const describePro = proIsPresent() ? describe : describe.skip;

/** Improve, in the text's own tone and layout, as plain text. */
const IMPROVE = { action: 'improve', tone: null, layout: 'keep', format: 'plain' } as const;

function rewrites(): RewriteModule {
  return requirePro<RewriteModule>('@offgrid/pro/scribe/rewriteService')!;
}

/** A llama.cpp text model on this phone, selected and loaded, as the person left it. */
async function loadTextModel(boundary: NativeBoundary, fileName = 'small.gguf', sizeBytes = 500 * 1024 * 1024) {
  const model = await importAndPickTextModel(boundary.fs!, { fileName, sizeBytes });
  const { activeModelService } = require('../../../src/services/activeModelService');
  await activeModelService.loadTextModel(model.id);
  return model;
}

function installPhone(): NativeBoundary {
  return installNativeBoundary({
    llama: true,
    fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
}

describePro('Improve rewrites from the phone\'s model', () => {
  it('without a text model, rewrites are blocked with no-model', async () => {
    installPhone();

    await expect(rewrites().prepareRewrites()).resolves.toEqual({ ready: false, blocker: 'no-model' });
  });

  it('with a loaded model, one version streams as it is written', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const service = rewrites();
    await expect(service.prepareRewrites()).resolves.toEqual({ ready: true });

    boundary.llama!.scriptCompletion({ text: 'The draft I wrote, made clearer.' });
    const progress: string[] = [];
    const version = await service.rewriteVersion('the draft i wrote', IMPROVE, [], p => progress.push(p));

    expect(version).toBe('The draft I wrote, made clearer.');
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[progress.length - 1]).toBe(version);
  });

  it('Another version asks the model for one that differs from those already shown', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const service = rewrites();

    boundary.llama!.scriptCompletion({ text: 'A third way to say it.' });
    await service.rewriteVersion('a draft', IMPROVE, ['First way.', 'Second way.'], () => undefined);

    const sent = JSON.stringify(boundary.llama!.calls.completion.at(-1));
    expect(sent).toContain('Versions already shown');
    expect(sent).toContain('First way.');
    expect(sent).toContain('Second way.');
  });

  // K2 Horizon writes <ifm|think>, even empty with thinking off; the iPhone streamed its tags raw.
  it.each([
    ['<think>', '</think>'],
    ['<ifm|think>', '</ifm|think>'],
  ])('a leading %s block is never shown or returned', async (open, close) => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const service = rewrites();

    boundary.llama!.scriptCompletion({
      text: `${open}The person wants it clearer. Maybe shorter.${close}\nOne clearer line.`,
    });
    const progress: string[] = [];
    const version = await service.rewriteVersion('a draft', IMPROVE, [], p => progress.push(p));

    expect(version).toBe('One clearer line.');
    for (const partial of progress) expect(partial).not.toMatch(/think|wants it|Maybe shorter/i);
  });

  /** A model that ignores thinking-off: ~1,500 tokens of reasoning (4 characters each) first. */
  const LONG_THINKING = `<think>${'The person wants it clearer, so I weigh each word. '.repeat(118)}</think>\n`;

  it('a model that thinks for longer than the version itself still gives the version after it', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const service = rewrites();

    boundary.llama!.scriptCompletion({ text: `${LONG_THINKING}One clearer line.`, charsPerToken: 4 });
    const version = await service.rewriteVersion('a draft', IMPROVE, [], () => undefined);

    expect(version).toBe('One clearer line.');
  });

  it('a model that thinks past the whole budget says so and names another model to try', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary, 'Thinker 8B.gguf');
    const small = await importTextModel(boundary.fs!, { fileName: 'Qwen 3.5 0.8B.gguf', sizeBytes: 300 * 1024 * 1024 });
    const service = rewrites();

    const endless = `<think>${'I weigh one more word. '.repeat(800)}</think>\nOne`;
    boundary.llama!.scriptCompletion({ text: endless, charsPerToken: 4 });
    await expect(service.rewriteVersion('a draft', IMPROVE, [], () => undefined)).rejects.toBeInstanceOf(
      service.ThinkingOnlyError,
    );
    expect(service.thinkingOnlyReadiness()).toEqual({
      ready: false,
      blocker: 'thinking-only',
      modelName: 'Thinker 8B',
      alternative: { id: small.id, name: 'Qwen 3.5 0.8B' },
    });
  });

  it('with the chat model loaded, Improve uses it and loads nothing more', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const loadsBefore = boundary.llama!.calls.initLlama.length;

    await expect(rewrites().prepareRewrites()).resolves.toEqual({ ready: true });

    expect(boundary.llama!.calls.initLlama.length).toBe(loadsBefore);
  });

  it('a model too big for free memory is not loaded; a smaller one on the phone is offered and fits', async () => {
    const boundary = installNativeBoundary({
      llama: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 6 * GB, availBytes: 1.5 * GB },
    });
    await importAndPickTextModel(boundary.fs!, { fileName: 'Big 8B.gguf', sizeBytes: 5 * GB });
    const small = await importTextModel(boundary.fs!, { fileName: 'Small 0.8B.gguf', sizeBytes: 300 * 1024 * 1024 });
    const service = rewrites();

    await expect(service.prepareRewrites()).resolves.toEqual({
      ready: false,
      blocker: 'no-memory',
      modelName: 'Big 8B',
      alternative: { id: small.id, name: 'Small 0.8B' },
    });
    expect(boundary.llama!.calls.initLlama).toHaveLength(0);

    await expect(service.switchTextModel(small.id)).resolves.toEqual({ ready: true });
    expect(boundary.llama!.calls.initLlama).toHaveLength(1);
  });

  it('a large model gets an offer of a quicker one already on the phone', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary, 'Big 8B.gguf', 5 * GB);
    const small = await importTextModel(boundary.fs!, { fileName: 'Small 0.8B.gguf', sizeBytes: 300 * 1024 * 1024 });

    expect(rewrites().quickModelOffer()).toEqual({ kind: 'use', id: small.id, name: 'Small 0.8B' });
  });

  it('a small model that thinks first gets an offer of the smallest pick for this phone', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary, 'Thinker 1B.gguf', 800 * 1024 * 1024);
    const service = rewrites();
    expect(service.quickModelOffer()).toBeNull();

    boundary.llama!.scriptCompletion({ text: '<think>Weighing it.</think>\nOne clearer line.' });
    await service.rewriteVersion('a draft', IMPROVE, [], () => undefined);

    const { devicePicks } = require('../../../src/services/devicePicks');
    const { hardwareService } = require('../../../src/services/hardware');
    const smallest = devicePicks(hardwareService.getTotalMemoryGB())
      .filter((p: { sizeBytes: number }) => p.sizeBytes <= service.QUICK_MODEL_MAX_BYTES)
      .sort((a: { sizeBytes: number }, b: { sizeBytes: number }) => a.sizeBytes - b.sizeBytes)[0];
    expect(smallest).toBeTruthy();
    expect(service.quickModelOffer()).toMatchObject({ kind: 'get', name: smallest.model.name, sizeBytes: smallest.sizeBytes });
  });
});

describePro('Scribe live checks', () => {
  /** A fresh engine and storage, as on a new install. */
  async function freshEngine(): Promise<EngineModule> {
    installNativeBoundary();
    const storage = require('@react-native-async-storage/async-storage');
    await (storage.default ?? storage).clear();
    const mod = requirePro<EngineModule>('@offgrid/pro/scribe/writingEngine')!;
    await mod.writingEngine.start();
    return mod;
  }

  const TEXT = 'I will recieve the parcel tomorrow.';
  const spelling = (mod: EngineModule, text: string) =>
    mod.writingEngine.check(text).filter(i => text.slice(i.span[0], i.span[1]) === 'recieve');

  it('flags a misspelt word with a replacement, and Fix all applies it', async () => {
    const mod = await freshEngine();
    const [issue] = spelling(mod, TEXT);

    expect(issue).toBeDefined();
    expect(issue.replacements).toContain('receive');
    expect(mod.fixAll(TEXT, mod.writingEngine.check(TEXT))).toBe('I will receive the parcel tomorrow.');
  });

  it('a word added to the dictionary is not flagged again', async () => {
    const mod = await freshEngine();
    expect(spelling(mod, TEXT)).toHaveLength(1);

    mod.writingEngine.addWord('recieve');

    expect(spelling(mod, TEXT)).toHaveLength(0);
  });

  it('an ignored issue stays hidden, also after an edit elsewhere in the text', async () => {
    const mod = await freshEngine();
    const [issue] = spelling(mod, TEXT);

    mod.writingEngine.ignore(TEXT, issue);

    expect(spelling(mod, TEXT)).toHaveLength(0);
    const edited = 'Tomorrow I will recieve the parcel.';
    expect(spelling(mod, edited)).toHaveLength(0);
  });
});
