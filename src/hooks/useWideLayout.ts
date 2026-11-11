import { useWindowDimensions } from 'react-native';

/**
 * Atlas: tablet / unfolded-phone layout. On wide screens content is kept in a centered,
 * readable column instead of stretching edge to edge (13" tablet, Razr inner screen in landscape).
 */
export const WIDE_MIN_WIDTH = 720;
export const READABLE_MAX_WIDTH = 920;

export function useWideLayout(maxWidth: number = READABLE_MAX_WIDTH): { isWide: boolean; width: number; column: object } {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_MIN_WIDTH;
  return {
    isWide,
    width,
    column: isWide ? { width: '100%', maxWidth, alignSelf: 'center' } : {},
  };
}
