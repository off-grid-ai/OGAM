/**
 * useEjectAllModels — thin View projection for Eject All (Home + Chat). Verifies the
 * reactive hasActiveModel derivation (local OR remote) and that ejectAll DELEGATES to
 * activeModelService.ejectAll (the single owner of the unload side-effect) and
 * surfaces the count. The unload sequence itself is the service's responsibility.
 */
import { renderHook, act } from '@testing-library/react-native';

const mockEjectAll = jest.fn(async () => ({ count: 2 }));
jest.mock('../../../src/services', () => ({
  activeModelService: { ejectAll: () => mockEjectAll() },
}));

let mockAppState: Record<string, unknown> = {};
let mockRemoteState: Record<string, unknown> = {};
jest.mock('../../../src/stores', () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) => sel(mockAppState),
  useRemoteServerStore: (sel: (s: Record<string, unknown>) => unknown) => sel(mockRemoteState),
}));

import { useEjectAllModels } from '../../../src/hooks/useEjectAllModels';

beforeEach(() => {
  jest.clearAllMocks();
  mockAppState = { activeModelId: null, activeImageModelId: null };
  mockRemoteState = { activeRemoteTextModelId: null, activeRemoteImageModelId: null };
});

describe('useEjectAllModels', () => {
  it('hasActiveModel is false when nothing is active', () => {
    expect(renderHook(() => useEjectAllModels()).result.current.hasActiveModel).toBe(false);
  });

  it('hasActiveModel is true for a local OR a remote model', () => {
    mockAppState = { activeModelId: 'gemma', activeImageModelId: null };
    expect(renderHook(() => useEjectAllModels()).result.current.hasActiveModel).toBe(true);

    mockAppState = { activeModelId: null, activeImageModelId: null };
    mockRemoteState = { activeRemoteTextModelId: 'r1', activeRemoteImageModelId: null };
    expect(renderHook(() => useEjectAllModels()).result.current.hasActiveModel).toBe(true);
  });

  it('ejectAll delegates to activeModelService and returns the count', async () => {
    const { result } = renderHook(() => useEjectAllModels());
    let count = -1;
    await act(async () => { count = await result.current.ejectAll(); });
    expect(mockEjectAll).toHaveBeenCalled();
    expect(count).toBe(2);
  });
});
