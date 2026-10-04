import type { TextStreamTransport } from '../../../../src/services/adapters/providers/types';
import { remoteTextTransportRegistry } from '../../../../src/services/adapters/providers/registry';

function transport(id: string): TextStreamTransport {
  return {
    id,
    type: 'openai-compatible',
    async generate(_modelId, _messages, _options, callbacks) {
      callbacks.onComplete({ content: '' });
    },
    async stopGeneration() {},
    async isReady() { return true; },
  };
}

describe('remote text transport lookup boundary', () => {
  beforeEach(() => remoteTextTransportRegistry.clear());

  it('resolves only the exact registered server transport', () => {
    const remote = transport('server-1');
    remoteTextTransportRegistry.register(remote.id, remote);
    expect(remoteTextTransportRegistry.get('server-1')).toBe(remote);
    expect(remoteTextTransportRegistry.get('missing')).toBeUndefined();
  });

  it('has no local route or model selection state', () => {
    remoteTextTransportRegistry.register('server-2', transport('server-2'));
    remoteTextTransportRegistry.unregister('server-2');
    expect(remoteTextTransportRegistry.ids()).toEqual([]);
    expect(remoteTextTransportRegistry.get('local')).toBeUndefined();
  });

  it('clears every external transport without changing Shared model state', () => {
    remoteTextTransportRegistry.register('server-3', transport('server-3'));
    remoteTextTransportRegistry.clear();
    expect(remoteTextTransportRegistry.ids()).toEqual([]);
  });
});
