/**
 * A side-task load (the intent classifier) borrows the text engine and must never become the chat model.
 *
 * Device, 2026-11-05: Gemma 4 picked, SmolLM2-135M (the classifier) answering every turn. The loader
 * recorded every successful load as the chat selection, so a classify that overlapped another one, or
 * whose chat-model reload was refused, left the classifier selected.
 *
 * Real: activeModelService and its loaders, the residency manager's load lock, llmService, the stores.
 * Faked (device, harness/generationDevice): llama.rn, the filesystem, RAM.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';

let d: GenerationDevice;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

const launchWithClassifier = async () => {
  d = await launchGeneration({ extraModels: [{ id: 'c', name: 'SmolLM2 135M' }] });
  d.useAppStore.getState().updateSettings({ classifierModelId: 'c' });
  d.activeModelService.selectTextModel('m');
};
const selection = () => d.useAppStore.getState().activeModelId;

describe('a utility load of the classifier', () => {
  it('never shows the classifier as the chat model, during the side task or after it', async () => {
    await launchWithClassifier();

    let duringWork: string | null = null;
    await d.activeModelService.withUtilityTextModel('c', async () => {
      duringWork = selection();
    });

    expect(duringWork).toBe('m');
    expect(selection()).toBe('m');
    expect(d.useAppStore.getState().lastTextModelId).toBe('m');
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('m');
  });

  it('two classifies that overlap leave the chat on the person’s model', async () => {
    await launchWithClassifier();

    await Promise.all([
      d.activeModelService.withUtilityTextModel('c', async () => undefined),
      d.activeModelService.withUtilityTextModel('c', async () => undefined),
    ]);

    expect(selection()).toBe('m');
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('m');
  });

  it('a cancelled switch does not make a still-loaded classifier the chat pick', async () => {
    await launchWithClassifier();
    await d.activeModelService.loadTextModel('c', undefined, { utility: true });
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('c');

    d.activeModelService.keepLoadedTextModelSelected();

    expect(selection()).toBe('m');
  });

  it('a chat load of the same model still records it as the selection', async () => {
    // The flag only changes side-task loads: picking a model for chat is unchanged.
    await launchWithClassifier();

    await d.activeModelService.loadTextModel('c');

    expect(selection()).toBe('c');
  });
});

describe('a phone that already holds the classifier as its chat model', () => {
  // The selection is persisted but the downloaded list is not: the repair runs when the scan delivers
  // the list, through the same store action every scan uses.
  const holdBadSelection = async (lastPick: string | null) => {
    await launchWithClassifier();
    d.useAppStore.setState({ activeModelId: 'c', lastTextModelId: lastPick });
    d.useAppStore.getState().setDownloadedModels([...models()]);
  };
  const models = () => d.useAppStore.getState().downloadedModels as any[];

  it('goes back to the person’s last pick when the scan delivers the list', async () => {
    await holdBadSelection('m');
    expect(selection()).toBe('m');
  });

  it('keeps the classifier when the person picked it themselves', async () => {
    await holdBadSelection('c');
    expect(selection()).toBe('c');
  });

  it('keeps the selection when the last pick is no longer on the phone', async () => {
    await launchWithClassifier();
    d.useAppStore.setState({ activeModelId: 'c', lastTextModelId: 'gone' });
    d.useAppStore.getState().setDownloadedModels([...models()]);
    expect(selection()).toBe('c');
  });

  it('keeps the selection when there is no last pick', async () => {
    await holdBadSelection(null);
    expect(selection()).toBe('c');
  });

  it('leaves a selection that is not the classifier alone', async () => {
    await launchWithClassifier();
    d.useAppStore.setState({ lastTextModelId: 'c' });
    d.useAppStore.getState().setDownloadedModels([...models()]);
    expect(selection()).toBe('m');
  });
});
