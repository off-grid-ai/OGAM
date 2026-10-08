/**
 * Microphone permission, read without prompting, on both platforms.
 *
 * The mic button looked usable when the permission was denied: nothing read the permission until
 * the person pressed it, and then the press failed. This answers "is the mic denied?" up front so
 * the button can say so and point to Settings.
 *
 * - The OS answer comes from react-native-audio-api's checkRecordingPermissions, already a
 *   dependency: AVAudioApplication/AVAudioSession recordPermission on iOS, checkSelfPermission on
 *   Android. Neither shows a prompt.
 * - Android reports a "Don't ask again" denial as Undetermined (it cannot tell it apart from
 *   never-asked). The request paths report a refused request here, so that case reads as denied
 *   too, until the OS says Granted again.
 */
import { AudioManager } from 'react-native-audio-api';
import logger from '../utils/logger';

type Listener = (denied: boolean) => void;

let deniedByRequest = false;
const listeners = new Set<Listener>();

function emit(denied: boolean): void {
  listeners.forEach(listener => listener(denied));
}

/** True when the microphone permission is denied. Never prompts; an unreadable answer is not denied. */
export async function isMicPermissionDenied(): Promise<boolean> {
  let status: string;
  try {
    status = await AudioManager.checkRecordingPermissions();
  } catch (error) {
    logger.warn('[MicPermission] could not read the permission:', error);
    return false;
  }
  if (status === 'Granted') deniedByRequest = false;
  return status === 'Denied' || (status === 'Undetermined' && deniedByRequest);
}

/** A permission request was refused. Called by the paths that request the mic. */
export function noteMicPermissionRefused(): void {
  deniedByRequest = true;
  emit(true);
}

/** Called when a refused request is reported, so a visible mic button updates at once. */
export function onMicPermissionRefused(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
