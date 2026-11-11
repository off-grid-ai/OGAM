import { Linking } from 'react-native';
import { navigationRef } from '../utils/navigationRef';
import { useAppStore, useAuthStore, useChatStore } from '../stores';

/** Where an atlas://app/<where> link goes (the launcher shortcuts use these). */
export type AppLinkTarget = 'chat' | 'call' | 'record' | 'brief' | 'schedule';
const TARGETS: AppLinkTarget[] = ['chat', 'call', 'record', 'brief', 'schedule'];

/** The target in a link like "atlas://app/call", or null for any other link. */
export function appLinkTarget(url: string | null | undefined): AppLinkTarget | null {
  const m = /^atlas:\/\/app\/([a-z]+)\/?$/i.exec(url ?? '');
  const where = m?.[1].toLowerCase() as AppLinkTarget | undefined;
  return where && TARGETS.includes(where) ? where : null;
}

let waiting: AppLinkTarget | null = null;

/** Opens the screen a shortcut asked for, once the navigation is ready and the app is not locked behind a PIN. */
export function flushAppLink(): void {
  if (!waiting || !navigationRef.isReady()) return;
  const auth = useAuthStore.getState();
  if (auth.isEnabled && auth.isLocked) return;
  const target = waiting;
  waiting = null;
  if (target === 'call') navigationRef.navigate('Call', {});
  else if (target === 'record') navigationRef.navigate('Recorder');
  else if (target === 'brief') navigationRef.navigate('DailyBrief');
  else if (target === 'schedule') navigationRef.navigate('Schedule');
  else {
    const s = useAppStore.getState();
    const modelId = s.activeModelId || s.downloadedModels[0]?.id;
    if (!modelId) { navigationRef.navigate('Main', { screen: 'ModelsTab' }); return; }
    navigationRef.navigate('Chat', { conversationId: useChatStore.getState().createConversation(modelId) });
  }
}

export function openAppLink(url: string | null | undefined): void {
  const target = appLinkTarget(url);
  if (!target) return;
  waiting = target;
  flushAppLink();
}

/** Listens for shortcut links, from the launch and while the app runs. Returns the way to stop. */
export function startAppLinks(): () => void {
  Linking.getInitialURL().then(openAppLink).catch(() => undefined);
  const subscription = Linking.addEventListener('url', (e) => openAppLink(e.url));
  const unlocked = useAuthStore.subscribe(flushAppLink);
  return () => { subscription.remove(); unlocked(); };
}
