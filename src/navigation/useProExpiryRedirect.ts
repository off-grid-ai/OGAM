import { useCallback, useEffect, useRef } from 'react';
import {
  createNavigationContainerRef,
  type NavigationContainerRef,
} from '@react-navigation/native';
import { useAppStore } from '../stores';
import { selectHasProAccess } from '../stores/proAccessSlice';
import type { RootStackParamList } from './types';

export const appNavigationRef =
  createNavigationContainerRef<RootStackParamList>();

/**
 * Show the purchase route when access expires, with Home as the return route.
 *
 * The returned callback is also the NavigationContainer onReady handler. This handles a credential
 * that was already expired during cold-start hydration, before the navigator existed.
 */
export function useProExpiryRedirect(
  navigation: ProExpiryNavigation = appNavigationRef,
): () => void {
  const expired = useAppStore(state => state.hasExpiredProCredential);
  const hasProAccess = useAppStore(selectHasProAccess);
  const hadProAccess = useRef(hasProAccess);
  const redirectPending = useRef(expired);

  const redirectIfExpired = useCallback(() => {
    if (!redirectPending.current || !navigation.isReady()) return;
    if (navigation.getCurrentRoute?.()?.name === 'ProDetail') {
      redirectPending.current = false;
      return;
    }
    redirectPending.current = false;
    navigation.resetRoot({
      index: 1,
      routes: [
        { name: 'Main', params: { screen: 'HomeTab' } },
        { name: 'ProDetail' },
      ],
    });
  }, [navigation]);

  useEffect(() => {
    if (hasProAccess) {
      hadProAccess.current = true;
      redirectPending.current = false;
      return;
    }
    if (expired || hadProAccess.current) {
      hadProAccess.current = false;
      redirectPending.current = true;
    }
    redirectIfExpired();
  }, [expired, hasProAccess, redirectIfExpired]);

  return redirectIfExpired;
}
type ProExpiryNavigation = Pick<
  NavigationContainerRef<RootStackParamList>,
  'isReady' | 'resetRoot'
> & {
  getCurrentRoute?: NavigationContainerRef<RootStackParamList>['getCurrentRoute'];
};
