/**
 * Scribe Improve below the screen: what the phone's own model gives back, and the live checks.
 *
 * SPEC: Improve needs a text model and says so when there is none. With one loaded, a single
 * completion gives up to three versions; one equal to what I wrote is not a version, and a
 * reasoning model's think block is never shown as one. A model that thinks even with thinking off
 * still has room to answer after a long think block; one that thinks past the whole budget says so,
 * with another text model on the phone to try. The live checks flag a misspelt word with a
 * fix, Fix all applies the fixes, a word I add to the dictionary is never flagged again, and an
 * issue I ignore stays hidden.
 *
 * Real rewriteService, writingEngine, engines, llmService, stores and @offgrid/writing. Device
 * boundaries only: llama.rn, the disk, the RAM sensor (installNativeBoundary) and AsyncStorage.
 */
import { installNativeBoundary, GB, type NativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type RewriteModule = typeof import('../../../pro/scribe/rewriteService');
type EngineModule = typeof import('../../../pro/scribe/writingEngine');

const describePro = proIsPresent() ? describe : describe.skip;

const MODEL_PATH = '/models/small.gguf';

function rewrites(): RewriteModule {
  return requirePro<RewriteModule>('@offgrid/pro/scribe/rewriteService')!;
}

/** A llama.cpp text model on this phone, selected and loaded, as the person left it. */
async function loadTextModel(boundary: NativeBoundary): Promise<void> {
  const { llmService } = require('../../../src/services/llm');
  const { hardwareService } = require('../../../src/services/hardware');
  const { useAppStore } = require('../../../src/stores');
  boundary.fs!.seedFile(MODEL_PATH, 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  await llmService.loadModel(MODEL_PATH);
  useAppStore.setState({
    downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: MODEL_PATH })],
    activeModelId: 'llm',
  });
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
    const { useAppStore } = require('../../../src/stores');
    useAppStore.setState({ downloadedModels: [], activeModelId: null });

    await expect(rewrites().prepareRewrites()).resolves.toEqual({ ready: false, blocker: 'no-model' });
  });

  it('with a loaded model, one completion gives the three versions, streamed as they arrive', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const service = rewrites();
    await expect(service.prepareRewrites()).resolves.toEqual({ ready: true });

    boundary.llama!.scriptCompletion({ text: 'First version\n---\nSecond version\n---\nThird version' });
    const progress: string[][] = [];
    const options = await service.rewriteOptions('the draft i wrote', 'improve', p => progress.push(p));

    expect(options).toEqual(['First version', 'Second version', 'Third version']);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toEqual(options);
  });

  it('a version equal to what I wrote is not offered', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const service = rewrites();

    boundary.llama!.scriptCompletion({ text: 'Keep this line.\n---\nA better line.\n---\nThe best line.' });
    const options = await service.rewriteOptions('  Keep this line.  ', 'improve', () => undefined);

    expect(options).toEqual(['A better line.', 'The best line.']);
  });

  it('a leading think block is never one of the versions', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const service = rewrites();

    boundary.llama!.scriptCompletion({
      text: '<think>The person wants it clearer.\n---\nMaybe shorter.</think>\nOne\n---\nTwo\n---\nThree',
    });
    const progress: string[][] = [];
    const options = await service.rewriteOptions('a draft', 'improve', p => progress.push(p));

    expect(options).toEqual(['One', 'Two', 'Three']);
    for (const partial of progress) {
      for (const option of partial) expect(option).not.toMatch(/think|clearer|Maybe shorter/i);
    }
  });

  /** A model that ignores thinking-off: ~1,500 tokens of reasoning (4 characters each) first. */
  const LONG_THINKING = `<think>${'The person wants it clearer, so I weigh each word. '.repeat(118)}</think>\n`;

  it('a model that thinks for longer than a chat reply still gives the versions after it', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const service = rewrites();

    boundary.llama!.scriptCompletion({ text: `${LONG_THINKING}One\n---\nTwo\n---\nThree`, charsPerToken: 4 });
    const options = await service.rewriteOptions('a draft', 'improve', () => undefined);

    expect(options).toEqual(['One', 'Two', 'Three']);
  });

  it('a model that thinks past the whole budget says so and names another model to try', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const { useAppStore } = require('../../../src/stores');
    useAppStore.setState({
      downloadedModels: [
        createDownloadedModel({ id: 'llm', name: 'Thinker 8B', engine: 'llama', filePath: MODEL_PATH }),
        createDownloadedModel({ id: 'small', name: 'Qwen 3.5 0.8B', engine: 'llama', filePath: '/models/q.gguf' }),
      ],
    });
    const service = rewrites();

    const endless = `<think>${'I weigh one more word. '.repeat(800)}</think>\nOne`;
    boundary.llama!.scriptCompletion({ text: endless, charsPerToken: 4 });
    await expect(service.rewriteOptions('a draft', 'improve', () => undefined)).rejects.toBeInstanceOf(
      service.ThinkingOnlyError,
    );
    expect(service.thinkingOnlyReadiness()).toEqual({
      ready: false,
      blocker: 'thinking-only',
      modelName: 'Thinker 8B',
      alternative: { id: 'small', name: 'Qwen 3.5 0.8B' },
    });
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
