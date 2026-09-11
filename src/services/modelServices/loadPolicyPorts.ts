import type { LoadPolicyTransitionPorts } from '@offgrid/models';
import { applicationFacade } from '../applicationFacade';
import logger from '../../utils/logger';

/**
 * Load-policy ports over the closed application facade. Shared owns the policy transition,
 * the initial-seed exception, and the mode-change ejection; this only forwards the two
 * commands and reports a typed ejection failure.
 */
export function mobileLoadPolicyPorts(): LoadPolicyTransitionPorts {
  return {
    setPolicy: next => applicationFacade().models.setLoadPolicy(next),
    ejectAll: async () => {
      const outcome = await applicationFacade().models.eject();
      if (!outcome.ok) {
        throw new Error(
          `Load-policy ejection failed: ${JSON.stringify(outcome.failure)}`,
        );
      }
      return outcome.value;
    },
    reportEjectionFailure: error =>
      logger.error('[LoadPolicy] ejection after a mode change failed', error),
  };
}
