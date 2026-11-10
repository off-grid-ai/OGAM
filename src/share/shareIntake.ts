import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { create } from 'zustand';
import { navigationRef } from '../utils/navigationRef';
import { useAuthStore } from '../stores';
import logger from '../utils/logger';

/**
 * Text another app sent to Atlas (Share, or "Ask Atlas" on selected text). It waits here until the app can show it: the
 * navigation is ready and the app is not locked behind a PIN. Then the "What should Atlas do with this?" screen opens.
 */
export const useIncomingShare = create<{ text: string | null; set: (text: string | null) => void }>((set) => ({ text: null, set: (text) => set({ text }) }));

const Native: { getInitialShare?: () => Promise<string | null> } | undefined = Platform.OS === 'android' ? NativeModules.AtlasShare : undefined;
export const shareAvailable = Boolean(Native);

/** Opens the share screen if a share is waiting and the app is ready; otherwise keeps it waiting. Safe to call any time. */
export function flushShare(): void {
  const { text, set } = useIncomingShare.getState();
  if (!text || !navigationRef.isReady()) return;
  const auth = useAuthStore.getState();
  if (auth.isEnabled && auth.isLocked) return;
  set(null);
  navigationRef.navigate('Share', { text });
}

/** Starts listening: text waiting from the launch, and text shared while the app runs. Returns the way to stop. */
export function startShareIntake(): () => void {
  if (!Native) return () => undefined;
  const offer = (text?: string | null) => { if (text && text.trim()) { useIncomingShare.getState().set(text); flushShare(); } };
  Native.getInitialShare?.().then(offer).catch((e) => logger.warn('[Share] could not read the shared text', e));
  const subscription = new NativeEventEmitter(NativeModules.AtlasShare as any).addListener('AtlasShareText', offer);
  const unlocked = useAuthStore.subscribe(flushShare);
  return () => { subscription.remove(); unlocked(); };
}
