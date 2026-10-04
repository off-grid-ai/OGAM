import { useMemo } from 'react';
import type { TextEngineCapabilities } from '@offgrid/application';
import { useActiveMobileModel } from './useActiveMobileModel';
import { mobileTextEngineControl } from '../services/modelServices/textEngineControl';

/**
 * Vision, tool, and thinking support of the active text route, projected by shared. Re-renders
 * when the route or inventory changes; nothing is copied into component state.
 */
export function useActiveTextCapabilities(): TextEngineCapabilities {
  const snapshot = useActiveMobileModel('text');
  return useMemo(
    () => mobileTextEngineControl.capabilities(snapshot.model?.id ?? null),
    [snapshot],
  );
}
