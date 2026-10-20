import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { useProExpiryRedirect } from '../../../src/navigation/useProExpiryRedirect';
import type { RootStackParamList } from '../../../src/navigation/types';
import { useAppStore } from '../../../src/stores/appStore';

describe('the expired Pro purchase route', () => {
  const navigation = {
    isReady: jest.fn(() => true),
    getCurrentRoute: jest.fn(() => ({ name: 'Main', key: 'main' })),
    resetRoot: jest.fn(),
  } as unknown as NavigationContainerRefWithCurrent<RootStackParamList>;

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().setHasExpiredProCredential(false);
  });

  afterEach(() => {
    useAppStore.getState().setHasExpiredProCredential(false);
  });

  it('routes a cold-start expired credential when navigation becomes ready', async () => {
    useAppStore.getState().setHasExpiredProCredential(true);
    const { result } = renderHook(() => useProExpiryRedirect(navigation));

    act(() => result.current());

    await waitFor(() =>
      expect(navigation.resetRoot).toHaveBeenCalledWith({
        index: 1,
        routes: [{ name: 'Main' }, { name: 'ProDetail' }],
      }),
    );
  });

  it('routes an active screen when the saved deadline passes', async () => {
    renderHook(() => useProExpiryRedirect(navigation));
    expect(navigation.resetRoot).not.toHaveBeenCalled();

    act(() => {
      useAppStore.getState().setHasExpiredProCredential(true);
    });

    await waitFor(() =>
      expect(navigation.resetRoot).toHaveBeenCalledWith({
        index: 1,
        routes: [{ name: 'Main' }, { name: 'ProDetail' }],
      }),
    );
  });
});
