import DeviceInfo from 'react-native-device-info';
import logger from './logger';

/**
 * Logs the app's current memory footprint, tagged with a call-site label.
 *
 * On iOS, DeviceInfo.getUsedMemory() returns the process phys_footprint - the
 * exact number the kernel's jetsam killer compares against before terminating
 * the app. A 4 GB device (e.g. iPhone XS) kills a foreground app at roughly
 * 1.3-1.4 GB, lower in the background. Logging a snapshot around whisper model
 * load and each transcribe chunk gives a footprint trajectory, so an apparent
 * "crash" can be confirmed (or ruled out) as a low-memory kill: if `used`
 * climbs toward the ceiling right before the app dies, it was jetsam, not a
 * code fault.
 *
 * Never throws - diagnostics must not break the path they observe.
 */
export async function logMemory(tag: string): Promise<void> {
  try {
    const [used, total] = await Promise.all([
      DeviceInfo.getUsedMemory(),
      DeviceInfo.getTotalMemory(),
    ]);
    const toMb = (n: number) => Math.round(n / (1024 * 1024));
    const pct = total > 0 ? Math.round((used / total) * 100) : 0;
    logger.log(`[mem] ${tag} used=${toMb(used)}MB total=${toMb(total)}MB (${pct}%)`);
  } catch (e) {
    logger.warn(`[mem] ${tag} snapshot failed: ${String(e)}`);
  }
}
