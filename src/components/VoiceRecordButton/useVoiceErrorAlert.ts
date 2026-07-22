import { useEffect } from 'react';
import { Linking } from 'react-native';
import { showAlert, type AlertState } from '../CustomAlert';

/** Owns the user-facing recovery policy for recording errors; the button only renders its state. */
export function useVoiceErrorAlert(
  error: string | null | undefined,
  setAlertState: (state: AlertState) => void,
): void {
  useEffect(() => {
    if (!error) return;

    const permissionDenied = error.toLowerCase().includes('permission denied');
    setAlertState(
      showAlert(
        permissionDenied
          ? 'Microphone Access Needed'
          : 'Voice Input Unavailable',
        permissionDenied
          ? 'Allow microphone access in Settings, then try again.'
          : `${error}. Try again.`,
        permissionDenied
          ? [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Open Settings',
                onPress: () => {
                  Linking.openSettings().catch(() => {});
                },
              },
            ]
          : [{ text: 'OK' }],
      ),
    );
  }, [error, setAlertState]);
}
