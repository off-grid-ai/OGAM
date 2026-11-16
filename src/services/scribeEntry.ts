import {
  AppState,
  Linking,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
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

/** The app's navigator, handed in by App so this service never imports the navigation layer. */
export interface ImproveNavigator {
  isReady(): boolean;
  navigate(name: string, params?: object): void;
  /** Whether a screen is registered: Improve is Pro, so without Pro it is not. */
  hasRoute(name: string): boolean;
}

const native: ScribeEntryNative | undefined = NativeModules.ScribeEntryModule;
/**
 * The Share extension opens `<this app's bundle id>://improve`, so with several builds installed
 * (dev, release) it opens the one it belongs to. `offgrid://improve` still works.
 */
const IMPROVE_URL = /^[a-z][a-z0-9+.-]*:\/\/improve(?:[/?#]|$)/i;
/**
 * iOS is still bringing the app in when it reports `active`. A screen pushed then never finishes
 * its transition, and the stack stops taking touches: Back, the swipe and every button go dead.
 */
const SETTLE_MS = 400;
let current: string | null = null;
/** iOS: a request that came in a link, waiting for the navigator. */
let waiting: ImproveRequest | null = null;
let linked = 0;

/** The text an iOS Share link carries (`<bundle id>://improve?text=…`), or null. */
function improveTextFromUrl(url: string): string | null {
  if (!IMPROVE_URL.test(url)) return null;
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  for (const part of query.split('&')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at) !== 'text') continue;
    try {
      const text = decodeURIComponent(part.slice(at + 1));
      return text.trim() ? text : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Hold a link's text for openPendingImprove; true when the link carried some. */
function holdLinked(url: string | null): boolean {
  const text = url ? improveTextFromUrl(url) : null;
  if (!text) return false;
  waiting = { id: `link-${++linked}`, text, apply: 'copy' };
  return true;
}

/** Resolves once the app is in front and done arriving. */
async function settled(): Promise<void> {
  if (AppState.currentState !== 'active') {
    await new Promise<void>(resolve => {
      const sub = AppState.addEventListener('change', state => {
        if (state !== 'active') return;
        sub.remove();
        resolve();
      });
    });
  }
  await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
}
let navigator: ImproveNavigator | null = null;

/** Show the waiting request, if any. Safe to call often: each request is taken once. */
export async function openPendingImprove(): Promise<void> {
  if (!native || !navigator?.isReady()) return;
  const request = waiting ?? (await native.takePending());
  waiting = null;
  if (!request) return;
  // A request still open on screen is answered with nothing, so its caller is never left waiting.
  if (current) await finishImprove(null);
  const navigate = navigator.navigate.bind(navigator);
  if (!navigator.hasRoute('ScribeImprove')) {
    await native.finish(request.id, null);
    await settled();
    navigate('ProDetail');
    return;
  }
  current = request.id;
  await settled();
  // From outside the app, Improve opens in place: no push animation for iOS to leave half done.
  navigate('ScribeImprove', { text: request.text, apply: request.apply, entry: 'outside' });
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

/** Watch for requests: on start, when Android offers one, and when iOS opens its improve link. */
export function startScribeEntry(appNavigator: ImproveNavigator): () => void {
  if (!native) return () => undefined;
  navigator = appNavigator;
  const open = (): void => {
    openPendingImprove().catch(cause => logger.warn('[Scribe] Improve did not open', cause));
  };
  const subs: { remove(): void }[] = [
    AppState.addEventListener('change', state => {
      if (state === 'active') open();
    }),
    Linking.addEventListener('url', ({ url }) => {
      if (!IMPROVE_URL.test(url)) return;
      holdLinked(url);
      open();
    }),
  ];
  // Opened from cold by a Share link: the link is the launch URL, not an event.
  Linking.getInitialURL()
    .then(url => {
      if (holdLinked(url)) open();
    })
    .catch(() => undefined);
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
