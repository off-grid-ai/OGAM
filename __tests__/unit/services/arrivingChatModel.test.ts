/**
 * The first chat model on its way, and what the chat does with messages that wait for it.
 * Pure rules over the download store's entries; the rendered journey is in
 * __tests__/integration/chat/firstModelArriving.rendered.test.tsx.
 */
import { arrivingChatModel, chatModelOnHand, waitingMessagesStep } from '../../../src/services/arrivingChatModel';
import { chatQueueView, waitingLabel } from '../../../src/screens/ChatScreen/chatQueueView';
import type { DownloadEntry } from '../../../src/utils/downloadStatus';
import type { QueuedMessage } from '../../../src/services/generationService';

const entry = (over: Partial<DownloadEntry>): DownloadEntry => ({
  modelKey: 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf',
  downloadId: 'd1',
  modelId: 'unsloth/Qwen3.5-0.8B-GGUF',
  fileName: 'Qwen3.5-0.8B-Q4_K_M.gguf',
  quantization: 'Q4_K_M',
  modelType: 'text',
  status: 'running',
  bytesDownloaded: 0,
  totalBytes: 600,
  combinedTotalBytes: 600,
  progress: 0.25,
  createdAt: 1,
  ...over,
} as DownloadEntry);

const byKey = (...entries: DownloadEntry[]) => Object.fromEntries(entries.map(e => [e.modelKey, e]));

describe('arrivingChatModel', () => {
  it('is the chat model downloading while none is chosen, by its model name', () => {
    expect(arrivingChatModel(byKey(entry({})), null)).toEqual({
      key: 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf',
      modelId: 'unsloth/Qwen3.5-0.8B-GGUF',
      name: 'Qwen 3.5 0.8B',
      progress: 0.25,
      failed: false,
    });
  });

  it('is nothing once a chat model is chosen', () => {
    expect(arrivingChatModel(byKey(entry({})), 'some-model')).toBeNull();
  });

  it('ignores other kinds, finished or cancelled downloads, and the intent classifier', () => {
    expect(arrivingChatModel(byKey(
      entry({ modelKey: 'a', modelType: 'image' }),
      entry({ modelKey: 'b', status: 'completed' }),
      entry({ modelKey: 'c', status: 'cancelled' }),
      entry({ modelKey: 'd', modelId: 'bartowski/SmolLM2-135M-Instruct-GGUF/x.gguf' }),
      entry({ modelKey: 'e', modelId: 'own/classifier' }),
    ), null, 'own/classifier')).toBeNull();
  });

  it('prefers a running download to a failed one, then the newest', () => {
    const failedNewer = entry({ modelKey: 'f', status: 'failed', createdAt: 9 });
    const runningOlder = entry({ modelKey: 'r', createdAt: 2 });
    const runningNewest = entry({ modelKey: 'n', createdAt: 5 });
    expect(arrivingChatModel(byKey(failedNewer, runningOlder, runningNewest), null)?.key).toBe('n');
    expect(arrivingChatModel(byKey(failedNewer), null)).toMatchObject({ key: 'f', failed: true });
  });

  it('keeps progress between 0 and 1', () => {
    expect(arrivingChatModel(byKey(entry({ progress: 1.4 })), null)?.progress).toBe(1);
    expect(arrivingChatModel(byKey(entry({ progress: -1 })), null)?.progress).toBe(0);
    expect(arrivingChatModel(byKey(entry({ progress: undefined as unknown as number })), null)?.progress).toBe(0);
  });
});

describe('waitingMessagesStep', () => {
  const arriving = arrivingChatModel(byKey(entry({})), null);
  it('sends once a chat model is chosen, waits while one is on its way, else hands them on', () => {
    expect(waitingMessagesStep(false, false, arriving)).toBe('none');
    expect(waitingMessagesStep(true, true, null)).toBe('send');
    expect(waitingMessagesStep(true, false, arriving)).toBe('wait');
    expect(waitingMessagesStep(true, false, null)).toBe('release');
  });
});

describe('the queue while the model is on its way', () => {
  const arriving = arrivingChatModel(byKey(entry({ progress: 0.42 })), null)!;
  const queued = (over: Partial<QueuedMessage>): QueuedMessage =>
    ({ id: 'q1', conversationId: 'c1', text: 'hello', messageText: 'hello', ...over });

  it('says what the message waits for, or that the download stopped', () => {
    expect(waitingLabel(arriving)).toBe('42% · sends when Qwen 3.5 0.8B is ready');
    expect(waitingLabel({ ...arriving, failed: true })).toBe('Qwen 3.5 0.8B stopped downloading');
  });

  it('shows the wait only in the chat whose messages wait for the model', () => {
    const view = chatQueueView([queued({ waitsForModel: true })], undefined, 'c1', arriving);
    expect(view.waiting).toEqual({ label: '42% · sends when Qwen 3.5 0.8B is ready', failed: false });
    expect(chatQueueView([queued({})], undefined, 'c1', arriving).waiting).toBeUndefined();
    expect(chatQueueView([queued({ waitsForModel: true })], undefined, 'other', arriving).waiting).toBeUndefined();
    expect(chatQueueView([queued({ waitsForModel: true })], undefined, null, arriving).items).toEqual([]);
  });
});

describe('takeChatModelOnHand', () => {
  const { takeChatModelOnHand } = require('../../../src/services/arrivingChatModel');
  const { useAppStore } = require('../../../src/stores/appStore');
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  const { createDownloadedModel } = require('../../utils/factories');
  beforeEach(() => {
    useDownloadStore.setState({ downloads: {} });
    useAppStore.setState({ activeModelId: null, lastTextModelId: null, downloadedModels: [] });
  });

  it('is nothing when no chat model is chosen, on the phone or on its way', () => {
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'own/classifier' })] });
    useAppStore.getState().updateSettings({ classifierModelId: 'own/classifier' });
    expect(takeChatModelOnHand()).toBe(false);
    expect(useAppStore.getState().activeModelId).toBeNull();
  });

  it('chooses the last pick on the phone before any other chat model', () => {
    useAppStore.setState({
      lastTextModelId: 'last',
      downloadedModels: [createDownloadedModel({ id: 'first' }), createDownloadedModel({ id: 'last' })],
    });
    expect(takeChatModelOnHand()).toBe(true);
    expect(useAppStore.getState().activeModelId).toBe('last');
  });

  it('counts a chosen model or one on its way, and chooses nothing then', () => {
    useAppStore.setState({ activeModelId: 'chosen' });
    expect(takeChatModelOnHand()).toBe(true);
    useAppStore.setState({ activeModelId: null });
    useDownloadStore.setState({ downloads: byKey(entry({})) });
    expect(takeChatModelOnHand()).toBe(true);
    expect(useAppStore.getState().activeModelId).toBeNull();
  });
});

describe('chatModelOnHand', () => {
  const { createDownloadedModel } = require('../../utils/factories');
  const app = (over: object = {}) => ({ activeModelId: null, downloadedModels: [], lastTextModelId: null, ...over });

  it('is the chosen model first, by name, and a chosen one the list does not hold has no name', () => {
    const own = createDownloadedModel({ id: 'own', name: 'Own' });
    expect(chatModelOnHand(byKey(entry({})), app({ activeModelId: 'own', downloadedModels: [own] }))).toEqual({ name: 'Own', arriving: false });
    expect(chatModelOnHand({}, app({ activeModelId: 'remote' }))).toEqual({ name: null, arriving: false });
  });

  it('then the one on its way, then the one on the phone setup would choose', () => {
    const first = createDownloadedModel({ id: 'first', name: 'First' });
    const last = createDownloadedModel({ id: 'last', name: 'Last' });
    expect(chatModelOnHand(byKey(entry({})), app({ downloadedModels: [first] }))).toEqual({ name: 'Qwen 3.5 0.8B', arriving: true });
    expect(chatModelOnHand({}, app({ downloadedModels: [first, last], lastTextModelId: 'last' }))).toEqual({ name: 'Last', arriving: false });
    expect(chatModelOnHand({}, app({ downloadedModels: [first, last] }))).toEqual({ name: 'First', arriving: false });
  });

  it('is nothing with no chat model, the intent classifier aside', () => {
    const classifier = createDownloadedModel({ id: 'own/classifier', name: 'Classifier' });
    expect(chatModelOnHand({}, app({ downloadedModels: [classifier], classifierModelId: 'own/classifier' }))).toBeNull();
  });
});
