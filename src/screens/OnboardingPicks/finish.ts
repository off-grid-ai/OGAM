/** Leaving onboarding's picks: they are kept (or none, on skip) and model setup comes next. */
import type { Picks } from '@offgrid/features';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useAppStore } from '../../stores/appStore';
import { onboardingPicked } from '../../services/analytics/analytics';

export function finishPicks<R extends keyof RootStackParamList>(
  navigation: NativeStackNavigationProp<RootStackParamList, R>,
  picks: Picks | null,
): void {
  const store = useAppStore.getState();
  store.setOnboardingPicks(picks);
  onboardingPicked(picks);
  store.setOnboardingComplete(true);
  navigation.reset({ index: 0, routes: [{ name: 'AutoSetup' }] });
}
