import { Platform } from 'react-native';

/**
 * The clipping props every FlatList / SectionList / VirtualizedList spreads.
 *
 * On Android, Fabric's removeClippedSubviews detaches and re-attaches rows while the list
 * scrolls, and the native child index goes out of step with the JS tree. The draw pass
 * then reads a null child (NullPointerException on View.mViewFlags in
 * ViewGroup.dispatchDraw) or adds at a bad index (IndexOutOfBounds in
 * ReactClippingViewManager.addView). FlatList turns clipping ON by default on Android,
 * so a list that omits the prop still crashes. Clipping stays on for iOS, where it is safe.
 *
 * ESLint (no-restricted-syntax in .eslintrc.js) fails any list that does not spread this.
 */
export const LIST_CLIPPING_PROPS = {
  removeClippedSubviews: Platform.OS !== 'android',
} as const;
