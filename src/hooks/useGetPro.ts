import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import type { RootStackParamList } from '../navigation/types';
import { selectHasProAccess } from '../stores/proAccessSlice';
import { useAppStore } from '../stores';
import { useTheme } from '../theme';
import { openProCheckout } from '../services/proCheckout';
import { proPaywallViewed } from '../services/analytics/analytics';

/**
 * The one "Get Pro" action. Someone without Pro goes straight to the checkout sheet: no page in
 * between, a lapsed or deactivated key included. Someone with Pro active goes to the Pro page, where
 * they see their status and manage devices. A key bought elsewhere is entered from
 * the sheet ("Have a key?"), which returns to the Pro page with the key field open.
 */
export function useGetPro(): (medium: string) => void {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isDark } = useTheme();
  return useCallback(
    (medium: string) => {
      const s = useAppStore.getState();
      if (selectHasProAccess(s) || s.isProActive) {
        navigation.navigate('ProDetail');
        return;
      }
      proPaywallViewed();
      openProCheckout(medium, isDark ? 'dark' : 'light').catch(() => navigation.navigate('ProDetail'));
    },
    [isDark, navigation],
  );
}
