import { useCallback } from 'react';
import { useAppNavigate } from '../navigation/useAppNavigate';
import { selectHasProAccess } from '../stores/proAccessSlice';
import { useAppStore } from '../stores';
import { useTheme } from '../theme';
import { OfflineError, openProCheckout } from '../services/proCheckout';
import { proPaywallViewed } from '../services/analytics/analytics';

/**
 * The one "Get Pro" action. Someone without Pro goes straight to the checkout sheet: no page in
 * between, a lapsed or deactivated key included. Someone with Pro active goes to the Pro page, where
 * they see their status and manage devices. Offline, the Pro page opens instead of a sheet that
 * could not load. A key bought elsewhere is entered from
 * the sheet ("Have a key?"), which returns to the Pro page with the key field open.
 */
export function useGetPro(): (medium: string) => void {
  const navigate = useAppNavigate();
  const { isDark } = useTheme();
  return useCallback(
    (medium: string) => {
      const s = useAppStore.getState();
      if (selectHasProAccess(s) || s.isProActive) {
        navigate('ProDetail');
        return;
      }
      proPaywallViewed();
      // Offline, or no sheet at all: the Pro page, which works without a connection.
      openProCheckout(medium, isDark ? 'dark' : 'light').catch((error: unknown) =>
        navigate('ProDetail', error instanceof OfflineError ? { offline: true } : undefined),
      );
    },
    [isDark, navigate],
  );
}
