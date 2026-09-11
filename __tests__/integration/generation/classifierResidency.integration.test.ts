import {
  type ModelInventoryAdapter,
  type ModelSelectionStore,
} from '@offgrid/models';
import { createOffGridApplication, modelsFailureMessage } from '@offgrid/application';
import { reconcileMobileSidecarAdapters } from '../../../src/services/modelServices/sidecarGenerationAdapter';
import { nativeModelLifecycle } from '../../../src/services/adapters/native/modelLifecycle';
import { classifierExecutionAdapter } from '../../../src/services/adapters/native/classifierExecutionAdapter';
import { registerApplicationFacade } from '../../../src/services/applicationFacade';

const mockLifecycleEvents: string[] = [];

jest.mock('../../../src/services/adapters/native/modelLifecycle', () => ({
  nativeModelLifecycle: {
    loadTextModel: jest.fn(async (modelId: string) => {
      mockLifecycleEvents.push(`load:${modelId}`);
    }),
    unloadTextModel: jest.fn(async () => {
      mockLifecycleEvents.push('unload:classifier');
    }),
  },
}));

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    runNativeCompletion: jest.fn(async (_messages, options) => {
      options.onStream({ content: 'YES' });
      return { content: 'YES' };
    }),
    stopGeneration: jest.fn(async () => undefined),
  },
}));

jest.mock('../../../src/services/adapters/native/embeddingRuntimeAdapter', () => ({
  embeddingService: {
    load: jest.fn(async () => undefined),
    unload: jest.fn(async () => undefined),
    embedBatch: jest.fn(async () => []),
  },
}));

describe('Mobile classifier residency integration', () => {
  test('shared generation evicts the text runtime and owns classifier cleanup', async () => {
    mockLifecycleEvents.length = 0;
    let selectedRoute: string | null = null;
    const selections: ModelSelectionStore = {
      read: modality => modality === 'classifier' ? selectedRoute : null,
      write: async (_modality, routeId) => {
        selectedRoute = routeId;
      },
    };
    const inventory: ModelInventoryAdapter = {
      id: 'classifier-inventory',
      async listModels() {
        return [{
          id: 'classifier.gguf',
          name: 'Classifier',
          kind: 'classifier',
          modality: 'classifier',
          source: 'local',
          adapterId: 'mobile-classifier-sidecar',
          capabilities: { classification: true },
          installed: true,
          ready: true,
          loaded: false,
          residentSizeMB: 128,
          residencyKey: 'mobile:text-engine',
          residencyLifecycle: 'operation',
        }];
      },
    };
    const application = createOffGridApplication({
      models: {
        selection: selections,
        memory: {
          current: () => ({ totalMB: 8_192, availableMB: 6_000, platform: 'mobile' as const }),
        },
        classifier: () => classifierExecutionAdapter,
        inventoryAdapters: [inventory],
        remote: {
          configuration: {
            read: () => ({version: 1, activeServerId: null, servers: []}),
            write: async () => undefined,
          },
          credentials: {
            read: async () => null,
            write: async () => undefined,
            remove: async () => undefined,
          },
          providers: {
            register: async () => undefined,
            unregister: async () => undefined,
          },
        },
      },
    });
    registerApplicationFacade(() => application);
    await application.models.refresh();
    const routes = application.models.snapshot().inventory;
    const routeId = routes[0]?.routeId;
    if (!routeId) throw new Error('The classifier fixture needs a canonical route.');
    const selected = await application.models.select({modality: 'classifier', modelId: routeId});
    if (!selected.ok) throw new Error(modelsFailureMessage(selected.failure));

    const textLease = await application.models.residency.acquire(
      {
        key: 'text:active-route',
        modelId: 'active-text.gguf',
        type: 'text',
        sizeMB: 512,
        residencyKey: 'mobile:text-engine',
      },
      {
        load: async () => undefined,
        unload: async () => {
          mockLifecycleEvents.push('unload:text');
          return {reclaimed: true as const};
        },
      },
    );
    await textLease.release();

    const registrations = new Map<string, () => void>();
    reconcileMobileSidecarAdapters(
      {registerAdapter: adapter => application.models.adapters.registerGeneration(adapter)},
      routes,
      registrations,
    );

    const result = await application.models.mainQueue.generate({
      operation: { type: 'classifier', input: 'A watercolor fox', labels: ['image', 'text'] },
      routeId,
      allowFallback: false,
    });

    expect(result.output).toEqual({
      type: 'classification',
      labels: [
        { label: 'image', score: 1 },
        { label: 'text', score: 0 },
      ],
    });
    expect(mockLifecycleEvents).toEqual([
      'unload:text',
      'load:classifier.gguf',
      'unload:classifier',
    ]);
    expect(nativeModelLifecycle.loadTextModel).toHaveBeenCalledWith(
      'classifier.gguf',
      120_000,
      false,
    );
    expect(application.models.snapshot().residents).toEqual([]);
    for (const unregister of registrations.values()) unregister();
    await application.stop();
  });
});
