import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import logger from '../utils/logger';
import {
  isMicPermissionDenied,
  onMicPermissionRefused,
} from '../services/micPermission';

/**
 * Whether the microphone permission is denied, kept current while the caller is mounted.
 * Re-read whenever the app returns to the foreground, because that is where a person changes it
 * (Settings), and at once when a request is refused.
 */
export function useMicPermissionDenied(): boolean {
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const refresh = () => {
      isMicPermissionDenied()
        .then(setDenied)
        .catch(error => logger.warn('[MicPermission] could not refresh the permission:', error));
    };
    refresh();
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    const unsubscribe = onMicPermissionRefused(setDenied);
    return () => {
      appState.remove();
      unsubscribe();
    };
  }, []);
  return denied;
}
