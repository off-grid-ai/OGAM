import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getRegisteredScreens } from '../navigation/screenRegistry';
import { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../stores/appStore';
import { selectHasProAccess } from '../stores/proAccessSlice';
import { PRO_TOOLS_SCREEN } from './useIsProActive';

/**
 * One callback for "open the Pro Tools destination", used everywhere the user can
 * reach those tools (the chat quick-settings row and the Tools page header).
 *
 * This used to be a fork: entitled users went into the tools, everyone else was routed
 * to the purchase page. There is no purchase page any more - Off Grid AI is free - so
 * the callback now answers the only question left, which is whether this build carries
 * the tools at all:
 *
 * Bundle loaded -> the Pro Tools screen (email/calendar + MCP servers) is registered,
 *                  so navigate straight into it.
 * No bundle     -> the Pro features screen, which explains what is missing and why,
 *                  and never asks for money.
 */
export function useOpenProTools(): () => void {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return () => {
    const hasAccess = selectHasProAccess(useAppStore.getState());
    const hasProScreen = getRegisteredScreens().some(
      s => s.name === PRO_TOOLS_SCREEN,
    );
    if (hasAccess && hasProScreen) {
      navigation.navigate(PRO_TOOLS_SCREEN as any);
    } else {
      navigation.navigate('ProDetail');
    }
  };
}
