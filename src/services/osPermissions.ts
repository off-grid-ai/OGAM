/**
 * The OS permissions a feature can need, read and asked for in one place, so a screen can show the
 * shared readiness line ("Camera access is off. Allow") and its one step works on both platforms.
 * Reading never prompts. Asking shows the system prompt once; after a refusal only Settings can change it.
 */
import { Linking, PermissionsAndroid, Platform, type Permission } from 'react-native';
import { Camera } from 'react-native-vision-camera';
import type { PermissionKind, PermissionStatus } from '@offgrid/features';
import { isMicPermissionDenied, noteMicPermissionRefused } from './micPermission';
import logger from '../utils/logger';

const ANDROID: Partial<Record<PermissionKind, Permission>> = {
  microphone: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  camera: PermissionsAndroid.PERMISSIONS.CAMERA,
  ...(Number(Platform.Version) >= 33 ? { notifications: PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS } : {}),
};

/** Where a permission stands, without a prompt. A permission this code cannot read reads as granted. */
export async function readPermission(kind: PermissionKind): Promise<PermissionStatus> {
  try {
    if (kind === 'microphone') return (await isMicPermissionDenied()) ? 'blocked' : 'granted';
    if (kind === 'camera') {
      const status = Camera.getCameraPermissionStatus();
      if (status === 'granted') return 'granted';
      return status === 'not-determined' ? 'ask' : 'blocked';
    }
    const android = Platform.OS === 'android' ? ANDROID[kind] : undefined;
    if (android) return (await PermissionsAndroid.check(android)) ? 'granted' : 'ask';
  } catch (error) {
    logger.warn(`[Permissions] could not read ${kind}:`, error);
  }
  return 'granted';
}

/** Show the system prompt. True when the permission is on afterwards. */
export async function askPermission(kind: PermissionKind): Promise<boolean> {
  try {
    if (kind === 'camera') return (await Camera.requestCameraPermission()) === 'granted';
    const android = Platform.OS === 'android' ? ANDROID[kind] : undefined;
    if (android) {
      const granted = (await PermissionsAndroid.request(android)) === PermissionsAndroid.RESULTS.GRANTED;
      if (!granted && kind === 'microphone') noteMicPermissionRefused();
      return granted;
    }
  } catch (error) {
    logger.warn(`[Permissions] could not ask for ${kind}:`, error);
  }
  return false;
}

export function openAppSettings(): void {
  Linking.openSettings().catch(error => logger.error('[Permissions] could not open Settings:', error));
}

/** The readiness step "Allow": ask, and when the system will not ask again, open Settings. */
export async function allowPermission(kind: PermissionKind): Promise<boolean> {
  if (await askPermission(kind)) return true;
  openAppSettings();
  return false;
}
