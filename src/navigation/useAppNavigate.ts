import { useCallback, useContext } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { appNavigationRef } from './useProExpiryRedirect';

/**
 * Navigate from anywhere: the screen's navigator when there is one, else the app's root navigator.
 * A task card in a chat list, a sheet in a portal or a header can render outside a screen, where
 * useNavigation() throws and took the whole chat down with it.
 */
export function useAppNavigate(): (route: string, params?: object) => void {
  const navigation = useContext(NavigationContext);
  return useCallback(
    (route: string, params?: object) => {
      if (navigation) {
        (navigation as unknown as { navigate: (r: string, p?: object) => void }).navigate(route, params);
        return;
      }
      if (appNavigationRef.isReady()) {
        (appNavigationRef as unknown as { navigate: (r: string, p?: object) => void }).navigate(route, params);
      }
    },
    [navigation],
  );
}
