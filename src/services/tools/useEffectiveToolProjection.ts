import { useSyncExternalStore } from 'react';
import type { EffectiveToolProjection } from '@offgrid/models';
import { effectiveChatTools } from '../composition/effectiveToolProjection';

export function useEffectiveToolProjection(): EffectiveToolProjection {
  const tools = effectiveChatTools();
  return useSyncExternalStore(tools.subscribe, tools.snapshot, tools.snapshot);
}
