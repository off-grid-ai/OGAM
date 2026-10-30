import {
  AppState,
  Linking,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import { getRegisteredScreens } from '../navigation/screenRegistry';
import { appNavigationRef } from '../navigation/useProExpiryRedirect';
import logger from '../utils/logger';

/**
 * "Improve" from outside the app: Android's text-selection menu (PROCESS_TEXT) and iOS Share.
 * The native side holds the selected text until the app takes it. Scribe is Pro: with Pro the
 * text opens on the `ScribeImprove` route; without it, the upgrade screen.
 */
interface ImproveRequest {
  id: string;
  text: string;
  /** `replace`: the calling app gets the pick back in place (Android, editable text). */
  apply: 'replace' | 'copy';
}

interface ScribeEntryNative {
  takePending(): Promise<ImproveRequest | null>;
  finish(id: string, text: string | null): Promise<boolean>;
}

const native: ScribeEntryNative | undefined = NativeModules.ScribeEntryModule;
const IMPROVE_URL = 'offgrid://improve';
let current: string | null = null;

/** Show the waiting request, if any. Safe to call often: each request is taken once. */
export async function openPendingImprove(): Promise<void> {
  if (!native || !appNavigationRef.isReady()) return;
  const request = await native.takePending();
  if (!request) return;
  // A request still open on screen is answered with nothing, so its caller is never left waiting.
  if (current) await finishImprove(null);
  const navigate = appNavigationRef.navigate as unknown as (name: string, params?: object) => void;
  if (!getRegisteredScreens().some(s => s.name === 'ScribeImprove')) {
    await native.finish(request.id, null);
    navigate('ProDetail');
    return;
  }
  current = request.id;
  navigate('ScribeImprove', { text: request.text, apply: request.apply });
}

/** Give the chosen text back to the app it came from (null leaves its text as it was). */
export async function finishImprove(text: string | null): Promise<void> {
  if (!native || !current) return;
  const id = current;
  current = null;
  await native.finish(id, text).catch(cause =>
    logger.warn('[Scribe] could not return the text', cause),
  );
}

/** Watch for requests: on start, when Android offers one, and when iOS opens offgrid://improve. */
export function startScribeEntry(): () => void {
  if (!native) return () => undefined;
  const open = (): void => {
    openPendingImprove().catch(cause => logger.warn('[Scribe] Improve did not open', cause));
  };
  const subs: { remove(): void }[] = [
    AppState.addEventListener('change', state => {
      if (state === 'active') open();
    }),
    Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith(IMPROVE_URL)) open();
    }),
  ];
  if (Platform.OS === 'android') {
    subs.push(
      new NativeEventEmitter(NativeModules.ScribeEntryModule).addListener(
        'ScribeImproveRequested',
        open,
      ),
    );
  }
  open();
  return () => subs.forEach(sub => sub.remove());
}
