// Gaps between React Native Web and the phone, closed before the app loads (App.tsx starts listeners as it
// loads, so this module is imported first in preview/index.js).
import { AppState } from 'react-native';

// React Native Web answers an event it does not track (memoryWarning) with no subscription; the app removes
// every subscription it took, so hand back one that removes nothing.
const addAppStateListener = AppState.addEventListener.bind(AppState);
AppState.addEventListener = (type, handler) =>
  addAppStateListener(type, handler) ?? { remove() {} };
