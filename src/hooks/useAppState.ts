import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export interface UseAppStateCallbacks {
  onForeground?: () => void;
  onBackground?: () => void;
}

export const useAppState = (callbacks: UseAppStateCallbacks) => {
  const appState = useRef(AppState.currentState);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        callbacksRef.current.onForeground?.();
      } else if (
        appState.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        callbacksRef.current.onBackground?.();
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return {
    currentState: appState.current,
  };
};
