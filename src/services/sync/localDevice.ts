// Local device DISPLAY facts for @offgrid/sync: a human name and the platform tag.
//
// This module deliberately does NOT own the device id. The canonical installation identity is the
// protected fingerprint, and it is attached in exactly ONE place - private Pro's
// getCanonicalLocalSyncDevice(). Minting an id here would create a second identity source: record
// provenance and version vectors get keyed to a random id while membership, pairing and the
// licensed-installation roster are keyed to the fingerprint, so the same physical device appears
// twice and its records are attributed to a device that is not in any roster.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import type { DeviceInfo as SyncDeviceInfo } from '@offgrid/sync';

/**
 * Random per-install id minted by builds that predate canonical fingerprint identity.
 *
 * Read-only from here on: it exists solely so a persisted op-log can be remapped onto the canonical
 * identity once, after which it is cleared. Never write this key again.
 */
const LEGACY_DEVICE_ID_KEY = '@offgrid/sync/deviceId';
const DEVICE_NAME_KEY = '@offgrid/sync/deviceName';
const MAX_DEVICE_NAME_LENGTH = 64;
const DEFAULT_DEVICE_NAME = 'Off Grid AI Device';

/** Every local device fact EXCEPT its identity. The fingerprint owner supplies the id. */
export type LocalDeviceProfile = Omit<SyncDeviceInfo, 'id'>;

function validDeviceName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('Enter a device name.');
  if (name.length > MAX_DEVICE_NAME_LENGTH) {
    throw new Error(
      `Device names can be up to ${MAX_DEVICE_NAME_LENGTH} characters.`,
    );
  }
  return name;
}

/** Display name + platform for the local installation. Generates no identity. */
export async function getLocalDeviceProfile(): Promise<LocalDeviceProfile> {
  let name = await AsyncStorage.getItem(DEVICE_NAME_KEY);
  if (!name) {
    name = DEFAULT_DEVICE_NAME;
    try {
      name = DeviceInfo.getDeviceNameSync() || name;
    } catch {
      /* name is best-effort */
    }
  }
  return {
    name,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    version: '1',
    host: '',
    port: 0,
  };
}

/**
 * The pre-canonical random id, if this install ever minted one. Never creates it.
 *
 * Only the one-time op-log identity migration may consume this.
 */
export async function readLegacyLocalDeviceId(): Promise<string | null> {
  const legacy = await AsyncStorage.getItem(LEGACY_DEVICE_ID_KEY);
  const trimmed = legacy?.trim();
  return trimmed ? trimmed : null;
}

/** Retire the legacy id once its op-log rows carry the canonical identity. */
export async function clearLegacyLocalDeviceId(): Promise<void> {
  await AsyncStorage.removeItem(LEGACY_DEVICE_ID_KEY);
}

export async function renameLocalDevice(nextName: string): Promise<string> {
  const name = validDeviceName(nextName);
  await AsyncStorage.setItem(DEVICE_NAME_KEY, name);
  return name;
}
