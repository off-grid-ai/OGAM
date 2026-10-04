import { useState } from 'react';
import { modelsFailureMessage } from '@offgrid/application';
import { applicationFacade } from '../services/applicationFacade';
import { useActiveMobileModel } from './useActiveMobileModel';

/**
 * Thin View-side projection for the "Eject All" control, shared by Home + Chat.
 *
 * - `hasActiveModel` is derived REACTIVELY from the stores (the projection layer).
 * - the unload SIDE-EFFECT is NOT here: `ejectAll` dispatches to the shared user
 *   ejection coordinator. No screen re-implements cancellation or unloading.
 * - `isEjecting` is the ephemeral in-flight flag for this dispatch (spinner only).
 */
export function useEjectAllModels(): {
  isEjecting: boolean;
  hasActiveModel: boolean;
  ejectAll: () => Promise<number>;
} {
  const [isEjecting, setIsEjecting] = useState(false);
  const text = useActiveMobileModel('text').model;
  const image = useActiveMobileModel('image').model;
  const transcription = useActiveMobileModel('transcription').model;
  const voice = useActiveMobileModel('voice').model;
  const hasActiveModel = !!text || !!image || !!transcription || !!voice;

  const ejectAll = async (): Promise<number> => {
    setIsEjecting(true);
    try {
      const outcome = await applicationFacade().workflows.ejectModels();
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
      return outcome.value.count;
    } finally {
      setIsEjecting(false);
    }
  };

  return { isEjecting, hasActiveModel, ejectAll };
}
