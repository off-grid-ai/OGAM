/**
 * The way to another Off Grid AI app from this phone: the desktop app or the browser extension.
 * The label and the address are the shared rule's (productAction in @offgrid/features); this only
 * says what the phone knows (is a desktop paired) and does the tap.
 *
 * A paired desktop reads "Open …" and goes to this phone's Computers screen. The extension installs
 * in a browser on a computer, which the phone cannot see, so the tap offers both stores.
 */
import { useCallback } from 'react';
import { Alert, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { t } from '@offgrid/i18n';
import { extensionStores, productAction, type OtherProduct } from '@offgrid/features';
import type { RootStackParamList } from '../navigation/types';
import { useRemoteServerStore } from '../stores';
import { pairedComputer } from '../services/pairedComputerSearch';
import { withUtm } from '../utils/utm';

export interface OtherProductLink {
  label: string;
  icon: string;
  /** Leaves the app (a web page or a store). */
  external: boolean;
  onPress: () => void;
}

const open = (url: string): void => {
  Linking.openURL(url).catch(() => undefined);
};

/** `medium` names the screen for the link's UTM tag (pro-detail, guide, …). */
export function useOtherProduct(
  medium: string,
): (product: Exclude<OtherProduct, 'mobile'>) => OtherProductLink {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const hasDesktop = useRemoteServerStore(s => pairedComputer(s.servers, s.activeServerId) !== null);

  return useCallback(
    product => {
      if (product === 'extension') {
        const action = productAction({ product });
        return {
          label: t(action.label),
          icon: 'external-link',
          external: true,
          onPress: () =>
            Alert.alert(t(action.label), t('It installs in the browser on your computer. Pick the store for that browser.'), [
              ...extensionStores().map(store => ({ text: t(store.name), onPress: () => open(store.url) })),
              { text: t('Cancel'), style: 'cancel' as const },
            ]),
        };
      }
      const action = productAction({ product, have: hasDesktop });
      if (action.kind === 'open') {
        return {
          label: t(action.label),
          icon: 'arrow-right',
          external: false,
          onPress: () => navigation.navigate('RemoteServers'),
        };
      }
      const url = withUtm(action.url ?? '', medium);
      return { label: t(action.label), icon: 'external-link', external: true, onPress: () => open(url) };
    },
    [hasDesktop, medium, navigation],
  );
}
