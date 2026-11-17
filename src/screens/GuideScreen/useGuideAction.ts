/**
 * The one action under a guide topic: open it on this phone, get Pro for it, or get it where it
 * lives (the desktop app, the browser extension). A topic with nowhere to go has no button.
 */
import { Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GUIDE_LINKS } from '@offgrid/models';
import type { RootStackParamList } from '../../navigation/types';
import { useAppStore } from '../../stores';
import { selectHasProAccess } from '../../stores/proAccessSlice';
import { useHasRegisteredScreen } from '../../navigation/screenRegistry';
import { useGetPro } from '../../hooks/useGetPro';
import { useOpenSync } from '../../hooks/useOpenSync';
import { useOpenProTools } from '../../hooks/useOpenProTools';
import { withUtm } from '../../utils/utm';
import type { GuideOpen, MobileGuideTopic } from './guideTopics';

export interface GuideAction {
  label: string;
  icon: string;
  /** Pro the person does not have yet: the button leads to Get Pro. */
  locked: boolean;
  external: boolean;
  onPress: () => void;
}

const OPEN_LABEL: Record<GuideOpen, string> = {
  chat: 'Start a chat',
  projects: 'Open Projects',
  models: 'Open Models',
  notes: 'Open Notes',
  vault: 'Open Vault',
  sync: 'Open Devices',
  clipboard: 'Open Clipboard',
  tools: 'Open Tools',
};

/** Pro screens: they exist on this phone only when Pro registered them. */
const PRO_SCREEN: Partial<Record<GuideOpen, keyof RootStackParamList | string>> = {
  notes: 'Notes',
  vault: 'Vault',
  clipboard: 'Clipboard',
};

export function useGuideAction(): (topic: MobileGuideTopic) => GuideAction | null {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const hasPro = useAppStore(selectHasProAccess);
  const hasChatModel = useAppStore(s => Boolean(s.activeModelId));
  const getPro = useGetPro();
  const { openSync } = useOpenSync();
  const openTools = useOpenProTools();
  const registered: Record<string, boolean> = {
    Notes: useHasRegisteredScreen('Notes'),
    Vault: useHasRegisteredScreen('Vault'),
    Clipboard: useHasRegisteredScreen('Clipboard'),
  };

  const go = (open: GuideOpen): void => {
    switch (open) {
      case 'chat':
        // A chat needs a model; without one, Models is where the next step is.
        if (hasChatModel) navigation.navigate('Chat', {});
        else navigation.navigate('Main', { screen: 'ModelsTab' } as never);
        return;
      case 'projects':
        navigation.navigate('Main', { screen: 'ProjectsTab' } as never);
        return;
      case 'models':
        navigation.navigate('Main', { screen: 'ModelsTab' } as never);
        return;
      case 'sync':
        openSync();
        return;
      case 'tools':
        openTools();
        return;
      default: {
        const screen = PRO_SCREEN[open];
        if (screen && registered[screen]) navigation.navigate(screen as never);
        else getPro('guide');
      }
    }
  };

  return topic => {
    if (topic.open) {
      const open = topic.open;
      const locked = topic.pro && !hasPro;
      return {
        label: locked ? 'Get Pro' : OPEN_LABEL[open],
        icon: locked ? 'lock' : 'arrow-right',
        locked,
        external: false,
        onPress: () => (locked ? getPro('guide') : go(open)),
      };
    }
    if (topic.get && topic.get !== 'mobile') {
      const url = withUtm(GUIDE_LINKS[topic.get], 'guide');
      return {
        label: 'Get it',
        icon: 'external-link',
        locked: false,
        external: true,
        onPress: () => { Linking.openURL(url).catch(() => undefined); },
      };
    }
    return null;
  };
}
