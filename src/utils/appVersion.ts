import DeviceInfo from 'react-native-device-info';
import packageJson from '../../package.json';

/**
 * The version of the app that is installed, e.g. "0.0.105 (build 93)". It is read from the installed
 * APK, so it always matches the build you are running; package.json is only the fallback because it
 * can lag behind the Android version.
 */
export function appVersionLabel(): string {
  try {
    const installed = DeviceInfo.getVersion?.();
    if (installed) return installed;
  } catch { /* fall back */ }
  return packageJson.version;
}
