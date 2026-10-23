/**
 * Unclean-exit marker (docs/ANALYTICS.md, `unclean_exit`).
 *
 * A model load or a generation writes a small marker when it starts and clears it when it ends.
 * Going to the background marks it not-foreground. If the next launch of the SAME app version finds
 * a foreground marker, the app died in the foreground mid-load or mid-generation.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'offgrid.analytics.uncleanExit';

export interface UncleanExitMarker {
  stage: 'load' | 'generate';
  model: string;
  engine: string;
  backend: string;
  free_ram_gb?: number;
  startedAt: number;
  appVersion: string;
  foreground: boolean;
  launch: string;
}

/** This launch. A marker written by this launch is never reported as the previous one's death. */
const LAUNCH = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let current: UncleanExitMarker | null = null;

function write(): void {
  const op = current ? AsyncStorage.setItem(KEY, JSON.stringify(current)) : AsyncStorage.removeItem(KEY);
  op.catch(() => undefined);
}

export function markStageStarted(marker: Omit<UncleanExitMarker, 'foreground' | 'launch'>): void {
  current = { ...marker, foreground: true, launch: LAUNCH };
  write();
}

export function markStageEnded(stage: UncleanExitMarker['stage']): void {
  if (current?.stage !== stage) return;
  current = null;
  write();
}

export function markForeground(foreground: boolean): void {
  if (!current || current.foreground === foreground) return;
  current = { ...current, foreground };
  write();
}

/** Read and clear the previous launch's marker. Returns it only when it counts as an unclean exit. */
export async function takeUncleanExit(appVersion: string): Promise<UncleanExitMarker | null> {
  let stored: UncleanExitMarker | null = null;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    stored = raw ? (JSON.parse(raw) as UncleanExitMarker) : null;
  } catch {
    stored = null;
  }
  if (!stored || stored.launch === LAUNCH) return null;
  if (!current) await AsyncStorage.removeItem(KEY).catch(() => undefined);
  if (!stored.foreground || stored.appVersion !== appVersion) return null;
  return stored;
}
