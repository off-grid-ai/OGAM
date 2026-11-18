/**
 * The context window a chat is budgeted against: the remote server's own for its active model, the
 * context setting when the server reports none, and llama.cpp's setting with no server.
 */
import { configuredContextTokens } from '../../../src/services/contextWindow';
import { useAppStore } from '../../../src/stores/appStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { llmService } from '../../../src/services/llm';

const model = (maxContextLength?: number) => ({
  id: 'qwen3-8b', name: 'qwen3-8b', serverId: 's1',
  capabilities: { supportsVision: false, supportsToolCalling: false, supportsThinking: false, maxContextLength },
  lastUpdated: '',
});

afterEach(() => {
  useRemoteServerStore.setState({ activeServerId: null, activeRemoteTextModelId: null, discoveredModels: {} });
});

describe('configuredContextTokens', () => {
  it("a remote model is budgeted at the server's context for it", () => {
    useAppStore.setState(s => ({ settings: { ...s.settings, contextLength: 4096 } }));
    useRemoteServerStore.setState({ activeServerId: 's1', activeRemoteTextModelId: 'qwen3-8b', discoveredModels: { s1: [model(32768)] as never } });
    expect(configuredContextTokens()).toBe(32768);
  });

  it('a remote model that reports no context uses the context setting, as before', () => {
    useAppStore.setState(s => ({ settings: { ...s.settings, contextLength: 8192 } }));
    useRemoteServerStore.setState({ activeServerId: 's1', activeRemoteTextModelId: 'qwen3-8b', discoveredModels: { s1: [model()] as never } });
    expect(configuredContextTokens()).toBe(8192);
  });

  it('with no setting either, the app default', () => {
    useAppStore.setState(s => ({ settings: { ...s.settings, contextLength: 0 } }));
    useRemoteServerStore.setState({ activeServerId: 's1', activeRemoteTextModelId: null, discoveredModels: {} });
    expect(configuredContextTokens()).toBe(4096);
  });

  it("with no server, llama.cpp's setting", () => {
    llmService.updatePerformanceSettings({ contextLength: 2048 });
    expect(configuredContextTokens()).toBe(2048);
    llmService.updatePerformanceSettings({ contextLength: 0 });
    expect(configuredContextTokens()).toBe(4096);
  });
});
