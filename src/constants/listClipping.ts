/**
 * The clipping props every FlatList / SectionList / VirtualizedList spreads.
 *
 * On Android, Fabric's removeClippedSubviews detaches and re-attaches rows while the list
 * scrolls, and the native child index goes out of step with the JS tree. The draw pass
 * then reads a null child (NullPointerException on View.mViewFlags in
 * ViewGroup.dispatchDraw) or adds at a bad index (IndexOutOfBounds in
 * ReactClippingViewManager.addView). FlatList turns clipping ON by default on Android,
 * so a list that omits the prop still crashes.
 *
 * iOS has the same fault in another form: a clipped row is detached from its parent, so when
 * the list unmounts (switching the Models tabs) Fabric finds the row under a different view and
 * asserts in RCTViewComponentView unmountChildComponentView (SIGABRT, device 2026-11-05), and
 * rows that move as they enter can stay detached and never draw (blank Gallery tiles).
 * Virtualization still unmounts far rows, so clipping is off on both platforms.
 *
 * ESLint (no-restricted-syntax in .eslintrc.js) fails any list that does not spread this.
 */
export const LIST_CLIPPING_PROPS = {
  removeClippedSubviews: false,
} as const;
