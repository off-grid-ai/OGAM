import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Tracks on-screen keyboard visibility.
 *
 * Uses the `will*` events on iOS (they fire before the animation, so layout
 * that depends on visibility stays in sync with the keyboard) and the `did*`
 * events on Android (which has no `will*` events). This is the only place that
 * needs a Platform branch — it picks event names, not layout values.
 */
export const useKeyboardVisible = (): boolean => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () => setVisible(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return visible;
};
