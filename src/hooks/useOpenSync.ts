import { useCallback } from 'react';
import { useAppNavigate } from '../navigation/useAppNavigate';
import { selectHasProAccess } from '../stores/proAccessSlice';
import { useAppStore } from '../stores';
import { proGateShown } from '../services/analytics/analytics';
import { useGetPro } from './useGetPro';

/**
 * Single navigation gate for the user-facing Sync control center.
 *
 * The restricted Sync bootstrap remains registered so an unlicensed installation can
 * receive Pro from an already licensed peer. Normal product entry points, however,
 * lead unlicensed users through the Pro surface first.
 */
export function useOpenSync(): {
  isSyncUnlocked: boolean;
  openSync: () => void;
  openSyncNotifications: () => void;
} {
  const navigate = useAppNavigate();
  // A credential alone is not enough. A device deactivated from the licensed-device roster is no
  // longer Pro, and Sync is the feature the roster exists to meter - it kept working while the Pro
  // screen's own header read "Device Not Active".
  const isSyncUnlocked = useAppStore(selectHasProAccess);
  const getPro = useGetPro();
  const openSync = useCallback(() => {
    if (isSyncUnlocked) return navigate('Sync');
    proGateShown('sync');
    getPro('sync');
  }, [isSyncUnlocked, navigate, getPro]);
  const openSyncNotifications = useCallback(() => {
    if (isSyncUnlocked) return navigate('Notifications');
    proGateShown('sync');
    getPro('sync-notifications');
  }, [isSyncUnlocked, navigate, getPro]);

  return { isSyncUnlocked, openSync, openSyncNotifications };
}
