import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import type { RootStackParamList } from '../navigation/types';
import { useHasRegisteredScreen } from '../navigation/screenRegistry';

/**
 * Single navigation gate for the user-facing Sync control center.
 *
 * Sync between your own devices is free, like everything else, so this no longer asks whether the person
 * may use it. What it does ask is whether the surfaces are in this build: the Sync and Notifications
 * screens come from the optional pro bundle, and navigating to a route that does not exist would leave a
 * tap doing nothing. When they are missing, the tap lands on the Pro features screen, which says so
 * plainly instead of selling anything.
 *
 * `isSyncUnlocked` keeps its name for its callers, and now means "the Sync screen is here".
 */
export function useOpenSync(): {
  isSyncUnlocked: boolean;
  openSync: () => void;
  openSyncNotifications: () => void;
} {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isSyncUnlocked = useHasRegisteredScreen('Sync');
  const hasNotifications = useHasRegisteredScreen('Notifications');
  const openSync = useCallback(() => {
    navigation.navigate(isSyncUnlocked ? 'Sync' : 'ProDetail');
  }, [isSyncUnlocked, navigation]);
  const openSyncNotifications = useCallback(() => {
    navigation.navigate(hasNotifications ? 'Notifications' : 'ProDetail');
  }, [hasNotifications, navigation]);

  return { isSyncUnlocked, openSync, openSyncNotifications };
}
