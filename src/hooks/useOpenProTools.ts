import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getRegisteredScreens } from '../navigation/screenRegistry';
import { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../stores/appStore';
import { selectHasProAccess } from '../stores/proAccessSlice';
import { PRO_TOOLS_SCREEN } from './useIsProActive';
import { proGateShown } from '../services/analytics/analytics';

/**
 * One callback for "open the Pro Tools destination", used everywhere the user can
 * reach pro tools (the chat quick-settings row and the Tools page header).
 *
 * Pro active  -> the Pro Tools screen (email/calendar + MCP servers) is registered,
 *                so navigate straight into it and show what is available.
 * Free        -> the screen is not registered, so route to the Pro upsell page.
 *
 * Routing on the registered screen (not on a license flag) keeps this in step with
 * useIsProActive and the rest of the app's single definition of "Pro is active".
 */
export function useOpenProTools(): () => void {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return () => {
    const hasAccess = selectHasProAccess(useAppStore.getState());
    const hasProScreen = getRegisteredScreens().some(s => s.name === PRO_TOOLS_SCREEN);
    if (hasAccess && hasProScreen) {
      navigation.navigate(PRO_TOOLS_SCREEN as any);
    } else {
      proGateShown('tools');
      navigation.navigate('ProDetail');
    }
  };
}
