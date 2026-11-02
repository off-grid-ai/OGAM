import { activeLiteRTContextTokens } from '../../../src/services/engines';
import { useAppStore, useRemoteServerStore } from '../../../src/stores';
import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';
import { providerRegistry } from '../../../src/services/providers';

jest.mock('../../../src/stores', () => ({
  useAppStore: { getState: jest.fn() },
  useRemoteServerStore: { getState: jest.fn() },
}));
jest.mock('../../../src/services/llm', () => ({ llmService: { isModelLoaded: jest.fn() } }));
jest.mock('../../../src/services/litert', () => ({
  liteRTService: { isModelLoaded: jest.fn(), getContextUsage: jest.fn() },
}));
jest.mock('../../../src/services/providers', () => ({ providerRegistry: { hasProvider: jest.fn() } }));

function activate(opts: { engine: 'litert' | 'llama'; liteRTLoaded?: boolean; remoteServer?: string | null }) {
  (useAppStore.getState as jest.Mock).mockReturnValue({
    activeModelId: 'm1',
    downloadedModels: [{ id: 'm1', engine: opts.engine }],
  });
  (useRemoteServerStore.getState as jest.Mock).mockReturnValue({ activeServerId: opts.remoteServer ?? null });
  (providerRegistry.hasProvider as jest.Mock).mockReturnValue(true);
  (llmService.isModelLoaded as jest.Mock).mockReturnValue(opts.engine === 'llama');
  (liteRTService.isModelLoaded as jest.Mock).mockReturnValue(opts.liteRTLoaded ?? false);
  (liteRTService.getContextUsage as jest.Mock).mockReturnValue({ used: 0, max: 1024 });
}

describe('activeLiteRTContextTokens', () => {
  it('is the context the loaded LiteRT engine holds, which native may have clamped below the setting', () => {
    activate({ engine: 'litert', liteRTLoaded: true });
    expect(activeLiteRTContextTokens()).toBe(1024);
  });

  it('is undefined when the LiteRT model is selected but not loaded', () => {
    activate({ engine: 'litert', liteRTLoaded: false });
    expect(activeLiteRTContextTokens()).toBeUndefined();
  });

  it('is undefined when llama.cpp is the active engine', () => {
    activate({ engine: 'llama', liteRTLoaded: true });
    expect(activeLiteRTContextTokens()).toBeUndefined();
  });

  it('is undefined when a remote server answers instead', () => {
    activate({ engine: 'litert', liteRTLoaded: true, remoteServer: 'gateway' });
    (llmService.isModelLoaded as jest.Mock).mockReturnValue(false);
    expect(activeLiteRTContextTokens()).toBeUndefined();
  });
});
