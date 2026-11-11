jest.mock('react-native', () => {
  const handlers = new Map<string, Set<(event: any) => void>>();
  const native = {
    rejectErrorListener: false,
    listBackends: jest.fn().mockResolvedValue([
      { name: 'Mali-G57 MC2', description: 'Vulkan', type: 'gpu' },
      { name: 'CPU', description: 'CPU', type: 'cpu' },
    ]),
    loadModel: jest.fn().mockResolvedValue('Vulkan'),
    formatChat: jest.fn().mockResolvedValue('<user>hi</user>'),
    tokenize: jest.fn().mockResolvedValue([1, 2]),
    activeBackend: jest.fn().mockResolvedValue('Vulkan'),
    generate: jest.fn().mockImplementation(async (_prompt: string, _limit: number, sessionId: string) => {
      handlers.get('AtlasVulkanToken')?.forEach(cb => cb({ sessionId: 'old-session', text: 'WRONG' }));
      handlers.get('AtlasVulkanToken')?.forEach(cb => cb({ sessionId, text: 'OK' }));
      handlers.get('AtlasVulkanEnd')?.forEach(cb => cb({ sessionId }));
      return true;
    }),
    interrupt: jest.fn().mockResolvedValue(true),
    unload: jest.fn().mockResolvedValue(true),
  };
  return {
    NativeModules: { AtlasVulkan: native },
    NativeEventEmitter: class {
      addListener(name: string, handler: (event: unknown) => void) {
        if (name === 'AtlasVulkanError' && native.rejectErrorListener) {
          native.rejectErrorListener = false;
          throw new Error('Native event bridge unavailable');
        }
        if (!handlers.has(name)) handlers.set(name, new Set());
        handlers.get(name)!.add(handler);
        return { remove: () => handlers.get(name)?.delete(handler) };
      }
    },
  };
});

import { NativeModules } from 'react-native';
import { vulkanEngine, describeVulkanStatus } from '../../../src/services/vulkanEngine';

const native = (NativeModules as any).AtlasVulkan;

beforeEach(() => { jest.clearAllMocks(); native.rejectErrorListener = false; });

it('detects a physically enumerated Vulkan GPU without depending on model name', async () => {
  expect(await vulkanEngine.isAvailable()).toBe(true);
  expect(native.listBackends).toHaveBeenCalledTimes(1);
});

it('treats only the Mali-G57 as slow for text: not an Adreno, and not another Mali (the G615 was never measured)', async () => {
  expect(await vulkanEngine.isSlowTextGpu()).toBe(true);
  native.listBackends.mockResolvedValueOnce([{ name: 'Adreno (TM) 830', description: 'Vulkan', type: 'gpu' }]);
  expect(await vulkanEngine.isSlowTextGpu()).toBe(false);
  native.listBackends.mockResolvedValueOnce([{ name: 'Mali-G720-Immortalis MC12', description: 'Vulkan', type: 'gpu' }]);
  expect(await vulkanEngine.isSlowTextGpu()).toBe(false);
  native.listBackends.mockResolvedValueOnce([{ name: 'Mali-G615', description: 'Vulkan', type: 'gpu' }]);
  expect(await vulkanEngine.isSlowTextGpu()).toBe(false);
  native.listBackends.mockResolvedValueOnce([{ name: 'Mali-G57', description: 'Vulkan', type: 'gpu' }]);
  expect(await vulkanEngine.isSlowTextGpu()).toBe(true);
});

it('loads a GGUF with a bounded offload request and delegates chat templates', async () => {
  // A legacy bridge resolving only the backend name reports an unknown layer count.
  await expect(vulkanEngine.loadModel('/models/qwen.gguf', { gpuLayers: 8, context: 2048, threads: 4 })).resolves.toEqual(
    { backend: 'Vulkan', requestedGpuLayers: 8, offloadedGpuLayers: -1, totalLayers: -1 });
  expect(native.loadModel).toHaveBeenCalledWith('/models/qwen.gguf', 8, 2048, 4);
  await expect(vulkanEngine.formatChat([{role:'user',content:'hi'}])).resolves.toBe('<user>hi</user>');
  expect(native.formatChat).toHaveBeenCalledWith('[{"role":"user","content":"hi"}]');
});

it('streams only current-session tokens and completes without leaking listeners', async () => {
  const parts: string[] = [];
  await vulkanEngine.generate('hello', { maxTokens: 32, onToken: token => parts.push(token) });
  expect(parts).toEqual(['OK']);
  const second: string[] = [];
  await vulkanEngine.generate('hello again', { maxTokens: 32, onToken: token => second.push(token) });
  expect(second).toEqual(['OK']);
});

it('can stop an active generation through the native interrupt command', async () => {
  let resolveNative!: (value: boolean) => void;
  native.generate.mockImplementationOnce(() => new Promise<boolean>(resolve => { resolveNative = resolve; }));
  const generating = vulkanEngine.generate('hi', { maxTokens: 64, onToken: () => {} });
  await vulkanEngine.interrupt();
  expect(native.interrupt).toHaveBeenCalledTimes(1);
  resolveNative(true);
  await generating;
});

it('releases its lock when NativeEventEmitter listener setup throws', async () => {
  native.rejectErrorListener = true;
  await expect(vulkanEngine.generate('hello', { maxTokens: 32, onToken: () => {} })).rejects.toThrow('Native event bridge unavailable');
  expect(native.generate).not.toHaveBeenCalled();
  const output: string[] = [];
  await vulkanEngine.generate('retry', { maxTokens: 32, onToken: part => output.push(part) });
  expect(output).toEqual(['OK']);
});

it('propagates streaming callback failures and interrupts native generation', async () => {
  await expect(vulkanEngine.generate('hello', { maxTokens: 32, onToken: () => { throw new Error('UI callback failed'); } }))
    .rejects.toThrow('UI callback failed');
  expect(native.interrupt).toHaveBeenCalledTimes(1);
  const output: string[] = [];
  await vulkanEngine.generate('retry', { maxTokens: 32, onToken: part => output.push(part) });
  expect(output).toEqual(['OK']);
});

it('unloads the native model safely', async () => {
  await vulkanEngine.unload();
  expect(native.unload).toHaveBeenCalledTimes(1);
});

it('passes through the structured native load result with offloaded layers', async () => {
  const result = { backend: 'Vulkan: Mali-G615', requestedGpuLayers: 99, offloadedGpuLayers: 29, totalLayers: 29 };
  native.loadModel.mockResolvedValueOnce(result);
  await expect(vulkanEngine.loadModel('/models/qwen.gguf', { gpuLayers: 99, context: 2048, threads: 4 })).resolves.toEqual(result);
});

it('uses the native runtime status so a missing engine is not reported as missing hardware', async () => {
  native.runtimeStatus = jest.fn().mockResolvedValue(
    { status: 'not_packaged', packaged: false, message: 'not packaged', devices: [] });
  try {
    const status = await vulkanEngine.runtimeStatus();
    expect(status.status).toBe('not_packaged');
    expect(describeVulkanStatus(status)).toMatch(/not included in this APK/);
    expect(await vulkanEngine.isAvailable()).toBe(false);
  } finally { delete native.runtimeStatus; }
});

it('classifies a legacy bridge without runtimeStatus from its device list', async () => {
  native.listBackends.mockResolvedValueOnce([{ name: 'CPU', description: 'CPU', type: 'cpu' }]);
  const status = await vulkanEngine.runtimeStatus();
  expect(status.status).toBe('no_vulkan_device');
  expect(describeVulkanStatus(status)).toMatch(/reports no Vulkan GPU/);
});
