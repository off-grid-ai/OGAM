/**
 * The line that tells the AI roughly where the user is. It comes from the phone's last GPS reading and the built-in city list,
 * never leaves the phone (the AI runs on it), and holds only a city and country, not coordinates. Switched on by default;
 * Appearance > AI style turns it off.
 */
import { NativeModules, Platform } from 'react-native';
import { useAppStore } from '../stores/appStore';
import { useMaps } from './maps';
import { describePlace } from './whereAmI';

/** A reading older than this is not offered as "where the user is". */
const FRESH_MS = 12 * 3600e3;

const ago = (ms: number) => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 2) return 'just now';
  return minutes < 90 ? `${minutes} minutes ago` : `${Math.round(minutes / 60)} hours ago`;
};

/** The instruction text, or '' when location is switched off, there is no recent reading, or no city is known. */
export function locationNote(now = Date.now()): string {
  if (useAppStore.getState().settings.shareLocation === false) return '';
  const fix = useMaps.getState().lastFix;
  if (!fix || now - fix.time > FRESH_MS) return '';
  const place = describePlace(fix.lat, fix.lon);
  if (!place) return '';
  return `\n\nThe user's phone GPS (read ${ago(now - fix.time)}) puts them ${place.sentence}. Use this when they ask where they are or what is near; only large cities are known, so for a small town say they are near the closest city, and do not name airports, roads or landmarks you were not given.`;
}

/** Reads the phone's last known position (only if location was already allowed) and keeps it for the note above. */
export async function refreshLastFix(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const fresh = await NativeModules.AtlasDevice?.lastLocation?.();
    const current = useMaps.getState().lastFix;
    if (fresh && (!current || fresh.time > current.time)) useMaps.getState().setFix(fresh);
  } catch { /* no permission yet: the note stays empty */ }
}
