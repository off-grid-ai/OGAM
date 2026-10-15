import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * The app's one imperative navigation handle, for the rare jump that is decided outside a screen's own
 * component tree.
 *
 * It used to live beside the Pro expiry redirect, which existed to hold an installation whose licence had
 * lapsed on the purchase route. Off Grid AI is free in this build, so there is nothing to lapse and no
 * purchase route to hold anyone on; the ref outlived it because other callers still navigate imperatively.
 */
export const appNavigationRef =
  createNavigationContainerRef<RootStackParamList>();
