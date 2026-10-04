import type { RuntimeModel } from '@offgrid/models';
import { hasUsableChatRoute } from '../../../../src/screens/ChatScreen/useChatScreen';

function route(
  modality: RuntimeModel['modality'],
  ready: boolean,
): RuntimeModel {
  return {
    id: `${modality}-model`,
    name: `${modality} model`,
    kind: modality === 'image' ? 'image' : 'text',
    modality,
    source: 'local',
    adapterId: `${modality}-adapter`,
    capabilities: {},
    installed: true,
    ready,
    loaded: false,
  };
}

describe('chat route availability', () => {
  it('does not treat embedding or classifier sidecars as chat models', () => {
    expect(
      hasUsableChatRoute([
        route('embedding', true),
        route('classifier', true),
      ]),
    ).toBe(false);
  });

  it('requires a ready text or image route', () => {
    expect(hasUsableChatRoute([route('text', false), route('image', false)]))
      .toBe(false);
    expect(hasUsableChatRoute([route('text', true)])).toBe(true);
    expect(hasUsableChatRoute([route('image', true)])).toBe(true);
  });
});
