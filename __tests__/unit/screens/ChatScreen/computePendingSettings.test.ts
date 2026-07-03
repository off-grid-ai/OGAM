import { computePendingSettings } from '../../../../src/screens/ChatScreen/useChatScreen';

describe('computePendingSettings — reload banner (LiteRT token budget)', () => {
  it('returns false when nothing was loaded yet', () => {
    expect(computePendingSettings('litert', { liteRTMaxTokens: 8192 }, null)).toBe(false);
  });

  it('does NOT flag a change when both sides resolve to the same effective token budget', () => {
    // Backend matches on both sides; isolate the token-budget behavior.
    // Loaded with the setting unset (effective native default 4096); live still unset.
    expect(computePendingSettings('litert', { liteRTBackend: 'cpu' }, { liteRTBackend: 'cpu' })).toBe(false);
    // Loaded 4096 explicitly, live unset → both effective 4096 → not changed.
    expect(computePendingSettings('litert', { liteRTBackend: 'cpu' }, { liteRTBackend: 'cpu', liteRTMaxTokens: 4096 })).toBe(false);
  });

  it('flags a change when the setting goes from unset (effective 4096) to an explicit value (F5)', () => {
    // The mirror bug: loaded with liteRTMaxTokens undefined, user later sets 8192. The
    // effective budget genuinely changed and a reload is required, so the banner must fire.
    expect(
      computePendingSettings('litert', { liteRTBackend: 'cpu', liteRTMaxTokens: 8192 }, { liteRTBackend: 'cpu' }),
    ).toBe(true);
  });

  it('flags a change when an explicit value changes', () => {
    expect(
      computePendingSettings('litert', { liteRTBackend: 'cpu', liteRTMaxTokens: 8192 }, { liteRTBackend: 'cpu', liteRTMaxTokens: 4096 }),
    ).toBe(true);
  });

  it('flags a LiteRT backend change', () => {
    expect(
      computePendingSettings('litert', { liteRTBackend: 'gpu' }, { liteRTBackend: 'cpu' }),
    ).toBe(true);
  });
});
