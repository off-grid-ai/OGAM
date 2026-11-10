/**
 * Knowing about a newer Atlas, and installing it from inside the app. A published build is a GitHub release tagged
 * "atlas-<build number>" holding the APK, and the build number is also shown in the app's version ("0.0.148 (build 144)"), so
 * "newer" means a higher build number. Android asks the person to confirm the install (and to allow installs from Atlas once).
 */
import { NativeModules, Platform } from 'react-native';
import { ATLAS_REPO } from '../constants';

export interface UpdateInfo { build: number; tag: string; name: string; apkUrl: string; size: number; notes: string }

/** The build number in a version name like "0.0.148 (build 144)", or null when the app was not built by the release workflow. */
export function buildFromVersion(version: string | undefined): number | null {
  const m = /\(build (\d+)\)/i.exec(version ?? '');
  return m ? Number(m[1]) : null;
}

export const buildFromTag = (tag: string | undefined): number | null => {
  const m = /^atlas-(\d+)$/.exec(tag ?? '');
  return m ? Number(m[1]) : null;
};

/** The update a release offers, or null when it is not newer, has no APK, or is not an Atlas build. */
/** The release text without the install blurb, so "What is new" shows only what changed. */
const whatIsNew = (body: unknown): string => String(body ?? '').replace(/^Install this APK[^\n]*\n?/i, '').trim();

export function updateFromRelease(release: any, currentBuild: number | null): UpdateInfo | null {
  const build = buildFromTag(release?.tag_name);
  if (build === null || currentBuild === null || build <= currentBuild || release?.draft || release?.prerelease) return null;
  const apk = (release.assets ?? []).find((a: any) => /\.apk$/i.test(a?.name ?? '') && a?.browser_download_url);
  if (!apk) return null;
  return { build, tag: release.tag_name, name: release.name || `Atlas build ${build}`, apkUrl: apk.browser_download_url, size: Number(apk.size) || 0, notes: whatIsNew(release.body) };
}

export function installedBuild(): number | null {
  try { return buildFromVersion(require('../utils/appVersion').appVersionLabel()); } catch { return null; }
}

export interface UpdateCheck { current: number | null; update: UpdateInfo | null }

/** Asks GitHub for the latest published build. Throws with a readable message when it cannot be reached. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const current = installedBuild();
  const r = await fetch(`https://api.github.com/repos/${ATLAS_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return { current, update: null };
  if (!r.ok) throw new Error(`GitHub answered HTTP ${r.status}`);
  return { current, update: updateFromRelease(await r.json(), current) };
}

/** Downloads the APK into the cache and starts Android's installer. Resolves 'started', or 'needs-permission' when Android first needs the install setting turned on. */
export class UpdateCancelled extends Error { constructor() { super('Download cancelled.'); } }

/** `onCancel` is given a function that stops the download (the promise then rejects with UpdateCancelled). */
export async function downloadAndInstall(update: UpdateInfo, onProgress: (fraction: number) => void, onCancel?: (cancel: () => void) => void): Promise<'started' | 'needs-permission'> {
  if (Platform.OS !== 'android' || !NativeModules.AtlasDevice?.installApk) throw new Error('Updating from the app works on Android only.');
  const RNFS = require('react-native-fs');
  const dir = `${RNFS.CachesDirectoryPath}/updates`;
  await RNFS.mkdir(dir);
  const file = `${dir}/Atlas-${update.build}.apk`;
  await RNFS.unlink(file).catch(() => undefined);
  let cancelled = false;
  const { jobId, promise } = RNFS.downloadFile({
    fromUrl: update.apkUrl, toFile: file, progressInterval: 500,
    progress: (p: any) => onProgress(Math.min(1, p.bytesWritten / Math.max(1, p.contentLength || update.size))),
  });
  onCancel?.(() => { cancelled = true; RNFS.stopDownload(jobId); });
  let res: any;
  try { res = await promise; } catch (e) { throw cancelled ? new UpdateCancelled() : e; }
  if (cancelled) throw new UpdateCancelled();
  if (res.statusCode && res.statusCode >= 400) throw new Error(`Download failed (HTTP ${res.statusCode})`);
  const size = Number((await RNFS.stat(file)).size);
  if (update.size && size < update.size * 0.99) throw new Error('The download was cut short. Try again on a steadier connection.');
  return NativeModules.AtlasDevice.installApk(file);
}

const LAST_KEY = 'atlas-update-last-check';
const SKIP_KEY = 'atlas-update-skipped-build';
const EVERY_MS = 20 * 60 * 60 * 1000;

/**
 * Once a day when the app opens, asks if a newer build is published and, if so, says so once (with "Skip this version").
 * Off when the person turned it off in Settings > App updates, in off-grid mode, or on a build that does not know its number.
 */
export async function announceUpdateOnce(): Promise<void> {
  try {
    const { useAppStore } = require('../stores');
    if ((useAppStore.getState().settings as any).checkUpdates === false) return;
    if (require('../atlasTools/offGrid').offGridOn()) return;
    if (Platform.OS !== 'android' || installedBuild() === null) return;
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const last = Number(await AsyncStorage.getItem(LAST_KEY)) || 0;
    if (Date.now() - last < EVERY_MS) return;
    await AsyncStorage.setItem(LAST_KEY, String(Date.now()));
    const { update } = await checkForUpdate();
    if (!update || (await AsyncStorage.getItem(SKIP_KEY)) === String(update.build)) return;
    const { Alert } = require('react-native');
    Alert.alert('A newer Atlas is ready', `${update.name} is published. Install it from Settings > App updates.`, [
      { text: 'Later', style: 'cancel' },
      { text: 'Skip this version', onPress: () => { void AsyncStorage.setItem(SKIP_KEY, String(update.build)); } },
      { text: 'Open', onPress: () => { try { require('../navigation/navigationRef').navigationRef.navigate('Main', { screen: 'SettingsTab' }); } catch { /* not ready */ } } },
    ]);
  } catch { /* offline or GitHub unreachable: say nothing */ }
}
