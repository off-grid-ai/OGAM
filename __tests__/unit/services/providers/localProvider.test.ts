/**
 * The local provider: the provider face of the on-device llama model.
 *
 * The model is loaded the way the app loads it (activeModelService, through the residency lock); the
 * provider then answers from the real llmService over the llama.rn fake.
 *
 * Real: localProvider, llmService, activeModelService, the residency manager, the stores. Faked (device,
 * harness/generationDevice): llama.rn, the filesystem, RAM.
 */
import { launchGeneration, type GenerationDevice } from '../../../harness/generationDevice';
import type { Message } from '../../../../src/types';

let d: GenerationDevice;
let provider: any;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

async function phone(opts: { load?: boolean } = {}) {
  d = await launchGeneration({ load: opts.load });
  provider = require('../../../../src/services/providers/localProvider').localProvider;
}

const ask = (content = 'Hello'): Message[] => [{ id: '1', role: 'user', content, timestamp: Date.now() }];
const webSearch = [{
  type: 'function' as const,
  function: { name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: {} } },
}];

/** Run provider.generate and collect what it reports. */
async function generate(messages: Message[], options: Record<string, unknown> = {}) {
  const tokens: string[] = [];
  const reasoning: string[] = [];
  const done: any[] = [];
  const errors: Error[] = [];
  await provider.generate(messages, options, {
    onToken: (t: string) => tokens.push(t),
    onReasoning: (r: string) => reasoning.push(r),
    onComplete: (r: any) => done.push(r),
    onError: (e: Error) => errors.push(e),
  });
  return { tokens, reasoning, done, errors };
}

describe('LocalProvider', () => {
  it('is the local provider, and reports what the loaded model can do', async () => {
    await phone();

    expect(provider.id).toBe('local');
    expect(provider.type).toBe('local');
    expect(provider.capabilities).toEqual(expect.objectContaining({
      supportsVision: d.llmService.supportsVision(),
      supportsToolCalling: true, // the model's chat template carries tool use
      supportsThinking: d.llmService.supportsThinking(),
      providerName: 'Local (llama.cpp)',
    }));
  });

  it('tracks the model id it was told was loaded', async () => {
    await phone();

    await provider.loadModel('/path/to/model.gguf');

    expect(provider.getLoadedModelId()).toBe('/path/to/model.gguf');
  });

  it('is ready only while llama holds a model', async () => {
    await phone({ load: false });
    expect(provider.isModelLoaded()).toBe(false);
    expect(await provider.isReady()).toBe(false);

    await d.activeModelService.loadTextModel('m');

    expect(provider.isModelLoaded()).toBe(true);
    expect(await provider.isReady()).toBe(true);
  });

  it('unloading frees the native model and forgets the model id', async () => {
    await phone();
    await provider.loadModel('/some/model.gguf');

    await provider.unloadModel();

    expect(d.llmService.isModelLoaded()).toBe(false);
    expect(provider.getLoadedModelId()).toBeNull();
  });

  it('dispose frees the native model and forgets the model id', async () => {
    await phone();
    await provider.loadModel('/some/model.gguf');

    await provider.dispose();

    expect(d.llmService.isModelLoaded()).toBe(false);
    expect(provider.getLoadedModelId()).toBeNull();
  });

  describe('generate', () => {
    it('streams the answer and completes with it and the speed details', async () => {
      await phone();
      d.boundary.llama!.scriptCompletion({ text: 'Hi there' });

      const { tokens, done, errors } = await generate(ask());

      expect(errors).toEqual([]);
      expect(tokens.join('')).toBe('Hi there');
      expect(done).toHaveLength(1);
      expect(done[0].content).toBe('Hi there');
      expect(done[0].meta).toEqual(expect.objectContaining({
        gpu: d.llmService.getGpuInfo().gpu,
        tokenCount: d.llmService.getPerformanceStats().lastTokenCount,
      }));
    });

    it('streams the reasoning to onReasoning', async () => {
      await phone();
      d.useAppStore.getState().updateSettings({ thinkingEnabled: true });
      d.boundary.llama!.scriptCompletion({ text: 'answer', reasoning: 'thinking...' });

      const { reasoning, done } = await generate(ask());

      expect(reasoning.join('')).toBe('thinking...');
      expect(done[0].reasoningContent).toBe('thinking...');
    });

    it('with tools, completes with the tool calls the model made, arguments as JSON text', async () => {
      await phone();
      // llama.rn's own tool-call shape: a function with its arguments as JSON text.
      d.boundary.llama!.scriptCompletion({
        text: '',
        toolCalls: [{ type: 'function', id: 'tc1', function: { name: 'web_search', arguments: '{"query":"test"}' } }] as any,
      });

      const { done, errors } = await generate(ask('Search for weather'), { tools: webSearch });

      expect(errors).toEqual([]);
      expect(done[0].toolCalls).toEqual([expect.objectContaining({ name: 'web_search', arguments: '{"query":"test"}' })]);
      // The tool schema reached the native completion.
      const sent = d.boundary.llama!.calls.completion[0][0] as any;
      expect(JSON.stringify(sent.tools)).toContain('web_search');
    });

    it('with tools, completes with a plain answer when the model calls none', async () => {
      await phone();
      d.boundary.llama!.scriptCompletion({ text: 'The weather is sunny' });

      const { done } = await generate(ask('Search for weather'), { tools: webSearch });

      expect(done[0].content).toBe('The weather is sunny');
      expect(done[0].toolCalls).toEqual([]);
    });

    it('with tools, streams the reasoning to onReasoning', async () => {
      await phone();
      d.useAppStore.getState().updateSettings({ thinkingEnabled: true });
      d.boundary.llama!.scriptCompletion({ text: 'done', reasoning: 'deep thought' });

      const { reasoning } = await generate(ask(), { tools: webSearch });

      expect(reasoning.join('')).toBe('deep thought');
    });

    it('reports "No model loaded" when llama holds no model, and sends nothing', async () => {
      await phone({ load: false });

      const { errors, done } = await generate([]);

      expect(errors.map(e => e.message)).toEqual(['No model loaded']);
      expect(done).toEqual([]);
      expect(d.boundary.llama!.calls.completion).toHaveLength(0);
    });

    it('reports a native failure during the reply as an error', async () => {
      await phone();
      d.boundary.llama!.scriptCompletion({ throwMessage: 'Failed to evaluate chunks' });

      const { errors, done } = await generate(ask());

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(Error);
      expect(done).toEqual([]);
    });
  });

  it('stopGeneration stops the native completion that is streaming', async () => {
    await phone();
    d.boundary.llama!.scriptCompletion({ text: 'one two three', pauseAfter: 'one' });
    const tokens: string[] = [];
    const done: any[] = [];
    const running = provider.generate(ask(), {}, {
      onToken: (t: string) => tokens.push(t), onComplete: (r: any) => done.push(r), onError: () => {},
    });
    const deadline = Date.now() + 3000;
    while (tokens.join('') !== 'one') { // the native side has streamed "one" and holds there
      if (Date.now() > deadline) throw new Error('the reply never streamed');
      await new Promise(r => setTimeout(r, 5));
    }

    await provider.stopGeneration();
    await running;

    expect(d.nativeContext()!.stopCompletion).toHaveBeenCalled();
    expect(tokens.join('')).toBe('one'); // nothing after the stop
    expect(d.llmService.isCurrentlyGenerating()).toBe(false);
  });

  describe('getTokenCount', () => {
    it('asks the native tokenizer when a model is loaded', async () => {
      await phone();

      const count = await provider.getTokenCount('Hello world');

      expect(count).toBe(3); // the tokenizer's three tokens
      expect(d.nativeContext()!.tokenize).toHaveBeenCalledWith('Hello world');
    });

    it('estimates four characters a token when no model is loaded', async () => {
      await phone({ load: false });

      expect(await provider.getTokenCount('Hello world')).toBe(3);
    });
  });
});
