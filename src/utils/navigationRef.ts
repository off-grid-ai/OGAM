import { createNavigationContainerRef } from '@react-navigation/native';

/** Lets code outside a screen (an incoming share, a notification) open a screen. Set on the NavigationContainer in App.tsx. */
export const navigationRef = createNavigationContainerRef<any>();
