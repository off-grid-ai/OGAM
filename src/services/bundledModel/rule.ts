import type { PackState } from './port';

/**
 * What the packs mean for the person:
 *  - absent:   no pack is coming (a sideloaded build, a platform with none). The regular download serves.
 *  - arriving: on its way; `waitsForWifi` when Play holds it for Wi-Fi.
 *  - stopped:  it was coming and stopped (failed, canceled). Retry falls back to the regular download.
 *  - arrived:  every pack is on the phone, with the folder of each.
 */
export type BundledModelState =
  | { kind: 'absent' }
  | { kind: 'arriving'; bytes: number; total: number; waitsForWifi: boolean }
  | { kind: 'stopped'; bytes: number; total: number }
  | { kind: 'arrived'; paths: Record<string, string> };

const STOPPED = new Set(['failed', 'canceled']);

export function bundledModelState(
  packs: Readonly<Record<string, PackState>>,
  names: readonly string[],
  sizes: Readonly<Record<string, number>>,
): BundledModelState {
  const states = names.map(name => packs[name]);
  if (states.every(s => s?.status === 'completed' && s.assetsPath)) {
    return { kind: 'arrived', paths: Object.fromEntries(states.map(s => [s!.name, s!.assetsPath!])) };
  }
  // A pack Play has not heard of means no packs ship with this install.
  if (states.some(s => !s || s.status === 'not_installed' || s.status === 'unknown')) return { kind: 'absent' };
  // A pack that has arrived counts its whole size; one on its way, what it has so far.
  const total = names.reduce((sum, name) => sum + (packs[name].totalBytes || sizes[name]), 0);
  const bytes = names.reduce((sum, name) => {
    const s = packs[name];
    return sum + (s.status === 'completed' ? (s.totalBytes || sizes[name]) : s.bytesDownloaded);
  }, 0);
  if (states.some(s => STOPPED.has(s!.status))) return { kind: 'stopped', bytes, total };
  // Every other status is on its way (pending, downloading, transferring, held for Wi-Fi or a tap) or
  // landed and waiting for the rest.
  return { kind: 'arriving', bytes, total, waitsForWifi: states.some(s => s!.status === 'waiting_for_wifi') };
}

/**
 * Whether to ask for the packs now. Play starts fast-follow packs by itself after a store install, but a
 * download it paused, dropped or never started (and every local-testing install) stays "not_installed"
 * until the app asks. A build with no packs (sideloaded) answers the ask with an error, and the regular
 * download serves as before.
 */
export function asksForPacks(packs: Readonly<Record<string, PackState | undefined>>, names: readonly string[]): boolean {
  return names.some(name => packs[name]?.status === 'not_installed');
}
