import { useState } from 'react';
import { activeModelService } from '../services';
import { useAppStore, useRemoteServerStore } from '../stores';

/**
 * Thin View-side projection for the "Eject All" control, shared by Home + Chat.
 *
 * - `hasActiveModel` is derived REACTIVELY from the stores (the projection layer).
 * - the unload SIDE-EFFECT is NOT here: `ejectAll` dispatches to
 *   activeModelService.ejectAll(), the single owner of the unload sequence (local
 *   unload + remote disconnect + count). No screen re-implements it; that's what let
 *   one screen wire Eject All and another stub it.
 * - `isEjecting` is the ephemeral in-flight flag for this dispatch (spinner only).
 */
export function useEjectAllModels(): {
  isEjecting: boolean;
  hasActiveModel: boolean;
  ejectAll: () => Promise<number>;
} {
  const [isEjecting, setIsEjecting] = useState(false);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const activeImageModelId = useAppStore((s) => s.activeImageModelId);
  const activeRemoteTextModelId = useRemoteServerStore((s) => s.activeRemoteTextModelId);
  const activeRemoteImageModelId = useRemoteServerStore((s) => s.activeRemoteImageModelId);

  const hasActiveModel = !!(activeModelId || activeImageModelId || activeRemoteTextModelId || activeRemoteImageModelId);

  const ejectAll = async (): Promise<number> => {
    setIsEjecting(true);
    try {
      const { count } = await activeModelService.ejectAll();
      return count;
    } finally {
      setIsEjecting(false);
    }
  };

  return { isEjecting, hasActiveModel, ejectAll };
}
