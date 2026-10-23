import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import type { RootStackParamList } from '../navigation/types';
import { selectHasProAccess } from '../stores/proAccessSlice';
import { useAppStore } from '../stores';
import { proGateShown } from '../services/analytics/analytics';

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
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // A credential alone is not enough. A device deactivated from the licensed-device roster is no
  // longer Pro, and Sync is the feature the roster exists to meter - it kept working while the Pro
  // screen's own header read "Device Not Active".
  const isSyncUnlocked = useAppStore(selectHasProAccess);
  const openSync = useCallback(() => {
    if (!isSyncUnlocked) proGateShown('sync');
    navigation.navigate(isSyncUnlocked ? 'Sync' : 'ProDetail');
  }, [isSyncUnlocked, navigation]);
  const openSyncNotifications = useCallback(() => {
    if (!isSyncUnlocked) proGateShown('sync');
    navigation.navigate(isSyncUnlocked ? 'Notifications' : 'ProDetail');
  }, [isSyncUnlocked, navigation]);

  return { isSyncUnlocked, openSync, openSyncNotifications };
}
