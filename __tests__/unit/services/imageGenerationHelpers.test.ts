/**
 * Image Generation Helpers Unit Tests
 *
 * Tests for pure helper functions used in image generation:
 * buildEnhancementMessages, getConversationContext, cleanEnhancedPrompt, buildImageGenMeta.
 */

import { Platform } from 'react-native';
import { useChatStore } from '../../../src/stores';
import {
  buildEnhancementMessages,
  getConversationContext,
  cleanEnhancedPrompt,
  buildImageGenMeta,
} from '../../../src/services/imageGenerationHelpers';

const originalOS = Platform.OS;
/** The platform the app runs on is the device, not our code: set it the way the runtime reports it. */
function runOn(os: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}
afterAll(() => runOn(originalOS as 'ios' | 'android'));

/** A real conversation in the real chat store, written through the store's own actions. */
function conversationWith(
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>,
): { id: string; ids: string[] } {
  const store = useChatStore.getState();
  const id = store.createConversation('model-1', 'Chat');
  const ids = messages.map(m => useChatStore.getState().addMessage(id, m).id);
  return { id, ids };
}

beforeEach(() => {
  useChatStore.getState().clearAllConversations();
});

describe('buildEnhancementMessages', () => {
  it('returns system + user message when no context', () => {
    const msgs = buildEnhancementMessages('a cat', []);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('a cat');
  });

  it('includes context messages between system and user', () => {
    const ctx = [
      { id: '1', role: 'user' as const, content: 'hello', timestamp: 1 },
      { id: '2', role: 'assistant' as const, content: 'hi', timestamp: 2 },
    ];
    const msgs = buildEnhancementMessages('a dog', ctx);
    expect(msgs).toHaveLength(4); // system + 2 ctx + user
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toBe(ctx[0]);
    expect(msgs[2]).toBe(ctx[1]);
    expect(msgs[3].content).toContain('a dog');
  });

  it('uses context-aware system prompt when context is provided', () => {
    const ctx = [{ id: '1', role: 'user' as const, content: 'make it darker', timestamp: 1 }];
    const msgs = buildEnhancementMessages('same scene', ctx);
    expect(msgs[0].content).toContain('conversation');
  });

  it('uses standalone system prompt when no context', () => {
    const msgs = buildEnhancementMessages('sunset', []);
    expect(msgs[0].content).not.toContain('conversation history');
  });

  it('wraps user content with User Request: prefix', () => {
    const msgs = buildEnhancementMessages('mountains', []);
    expect(msgs[msgs.length - 1].content).toBe('User Request: mountains');
  });
});

describe('getConversationContext', () => {
  it('returns empty array when conversation not found', () => {
    conversationWith([{ role: 'user', content: 'hello' }]);
    expect(getConversationContext('missing-id')).toEqual([]);
  });

  it('returns empty array when conversation has no messages', () => {
    const { id } = conversationWith([]);
    expect(useChatStore.getState().conversations.find(c => c.id === id)).toBeDefined();
    expect(getConversationContext(id)).toEqual([]);
  });

  it('filters to only user and assistant messages', () => {
    const { id } = conversationWith([
      { role: 'user', content: 'hello' },
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: 'hi' },
      { role: 'tool', content: 'result' },
    ]);
    expect(useChatStore.getState().getConversationMessages(id)).toHaveLength(4);
    const ctx = getConversationContext(id);
    expect(ctx.map(m => [m.role, m.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'hi'],
    ]);
  });

  it('takes last 10 messages', () => {
    const { id } = conversationWith(
      Array.from({ length: 15 }, (_, i) => ({ role: 'user' as const, content: `msg${i}` })),
    );
    const ctx = getConversationContext(id);
    expect(ctx).toHaveLength(10);
    expect(ctx[0].content).toBe('msg5'); // last 10 start at index 5
    expect(ctx[9].content).toBe('msg14');
  });

  it('truncates content to 500 chars', () => {
    const { id } = conversationWith([{ role: 'user', content: 'x'.repeat(600) }]);
    const ctx = getConversationContext(id);
    expect(ctx[0].content).toHaveLength(500);
  });

  it('prefixes context message ids with ctx-', () => {
    const { id, ids } = conversationWith([{ role: 'user', content: 'hi' }]);
    const ctx = getConversationContext(id);
    expect(ctx[0].id).toBe(`ctx-${ids[0]}`);
  });
});

describe('cleanEnhancedPrompt', () => {
  it('trims whitespace', () => {
    expect(cleanEnhancedPrompt('  hello  ')).toBe('hello');
  });

  it('removes leading and trailing double quotes', () => {
    expect(cleanEnhancedPrompt('"a sunset"')).toBe('a sunset');
  });

  it('removes leading and trailing single quotes', () => {
    expect(cleanEnhancedPrompt("'a forest'")).toBe('a forest');
  });

  it('strips <think>...</think> blocks', () => {
    expect(cleanEnhancedPrompt('<think>reasoning here</think>the prompt')).toBe('the prompt');
  });

  it('strips multiline think blocks', () => {
    expect(cleanEnhancedPrompt('<think>\nlong\nthinking\n</think>result')).toBe('result');
  });

  it('handles already clean input', () => {
    expect(cleanEnhancedPrompt('a beautiful mountain')).toBe('a beautiful mountain');
  });

  it('handles empty string', () => {
    expect(cleanEnhancedPrompt('')).toBe('');
  });
});

describe('buildImageGenMeta', () => {
  const baseModel = { id: 'm1', name: 'TestModel', modelPath: '/path' };
  const baseOpts = { steps: 8, guidanceScale: 2.5, result: { width: 512, height: 512 } as any, useOpenCL: false };

  it('returns Core ML backend on iOS', () => {
    runOn('ios');
    const meta = buildImageGenMeta(baseModel, baseOpts);
    expect(meta.gpu).toBe(true);
    expect(meta.gpuBackend).toBe('Core ML');
  });

  it('includes model name, steps, guidanceScale, resolution', () => {
    runOn('ios');
    const meta = buildImageGenMeta(baseModel, baseOpts);
    expect(meta.modelName).toBe('TestModel');
    expect(meta.steps).toBe(8);
    expect(meta.guidanceScale).toBe(2.5);
    expect(meta.resolution).toBe('512x512');
  });

  it('returns QNN backend for qnn backend on android', () => {
    runOn('android');
    const meta = buildImageGenMeta({ ...baseModel, backend: 'qnn' }, baseOpts);
    expect(meta.gpu).toBe(true);
    expect(meta.gpuBackend).toBe('QNN (NPU)');
  });

  it('returns MNN GPU when useOpenCL is true on android', () => {
    runOn('android');
    const meta = buildImageGenMeta({ ...baseModel, backend: 'mnn' }, { ...baseOpts, useOpenCL: true });
    expect(meta.gpu).toBe(true);
    expect(meta.gpuBackend).toBe('MNN (GPU)');
  });

  it('returns MNN CPU when useOpenCL is false and backend is mnn on android', () => {
    runOn('android');
    const meta = buildImageGenMeta({ ...baseModel, backend: 'mnn' }, { ...baseOpts, useOpenCL: false });
    expect(meta.gpu).toBe(false);
    expect(meta.gpuBackend).toBe('MNN (CPU)');
  });

  it('defaults backend to mnn when not specified', () => {
    runOn('android');
    const meta = buildImageGenMeta(baseModel, { ...baseOpts, useOpenCL: false });
    expect(meta.gpuBackend).toBe('MNN (CPU)');
  });
});
