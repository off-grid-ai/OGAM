import { useWindowDimensions } from 'react-native';

/**
 * Atlas window size classes (Material breakpoints, in dp). They follow the WINDOW, not
 * the device, so a phone in portrait stays compact, a Razr in landscape or a foldable's
 * inner screen becomes medium, and the 13.2" onn tablet is expanded in landscape (and in
 * portrait whenever its window is at least 840dp wide).
 */
export type LayoutClass = 'compact' | 'medium' | 'expanded';
export const MEDIUM_MIN_WIDTH = 600;
export const EXPANDED_MIN_WIDTH = 840;

export function layoutClassFor(width: number): LayoutClass {
  if (width >= EXPANDED_MIN_WIDTH) return 'expanded';
  if (width >= MEDIUM_MIN_WIDTH) return 'medium';
  return 'compact';
}

export type LayoutInfo = {
  layoutClass: LayoutClass;
  width: number;
  height: number;
  /** Side navigation rail instead of the bottom bar. */
  navigationRail: boolean;
  /** Room for two panes side by side (Projects | Agents, settings columns). */
  twoPane: boolean;
};

export function layoutInfoFor(width: number, height: number): LayoutInfo {
  const layoutClass = layoutClassFor(width);
  return {
    layoutClass, width, height,
    navigationRail: layoutClass !== 'compact',
    twoPane: layoutClass === 'expanded',
  };
}

export function useLayoutClass(): LayoutInfo {
  const { width, height } = useWindowDimensions();
  return layoutInfoFor(width, height);
}
