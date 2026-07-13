import { Platform, ToastAndroid, Alert } from 'react-native';

/**
 * Lightweight, non-blocking user hint. Android has a native toast; iOS has no
 * built-in toast, so we fall back to a brief alert (the standard RN cross-
 * platform mechanism). Use for short "can't do that right now" directions.
 */
export function showToast(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert('', message);
  }
}
