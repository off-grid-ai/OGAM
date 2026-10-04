/**
 * Device memory-pressure recovery, registered as part of composition.
 *
 * This used to live at module scope in `residencyBootstrap.ts`, so the listener was installed as a
 * side effect of the first import that wanted the residency manager - which meant it could never be
 * removed, and whether it was installed at all depended on which unrelated module had been imported
 * first. It belongs where the rest of the model services are started, for the same reason the
 * inventory adapters moved there: registration that returns its own disposer is the only kind
 * `stopMobileModelServices` can actually undo.
 */
import { AppState, type NativeEventSubscription } from 'react-native';
import { modelsFailureMessage } from '@offgrid/application';
import { applicationFacade } from '../applicationFacade';
import { reportModelFailure } from '../modelFailureHandler';
import logger from '../../utils/logger';

function reportMemoryWarningFailure(error: unknown): void {
  reportModelFailure('text', error, {
    id: 'mobile-model-memory-warning',
    title: 'Model memory recovery failed',
    message: error instanceof Error ? error.message : 'Off Grid could not release model memory.',
    memoryPressure: true,
  });
}

async function handleMemoryWarning(): Promise<void> {
  const outcome = await applicationFacade().models.handleMemoryWarning();
  if (!outcome.ok) reportMemoryWarningFailure(new Error(modelsFailureMessage(outcome.failure)));
}

/** Recover model memory when the device reports pressure. Returns its own disposer. */
export function registerMobileMemoryWarningRecovery(): () => void {
  // EXPECTED ABSENCE, feature-detected: some test environments provide no AppState boundary at all.
  // This is the only condition under which not registering is normal, so it is checked rather than
  // inferred from a thrown error - a `try` around the call would have swallowed a real registration
  // failure on a device as if it were a missing test double, and then memory-pressure recovery
  // would be silently absent for the whole session.
  if (typeof AppState?.addEventListener !== 'function') return () => {};
  let subscription: NativeEventSubscription | undefined;
  try {
    subscription = AppState.addEventListener('memoryWarning', () => {
      handleMemoryWarning().catch(error => {
        logger.error('[ModelServices] memory warning recovery failed', error);
        reportMemoryWarningFailure(error);
      });
    });
  } catch (error) {
    // The boundary EXISTS and refused. That is a real fault: this device will not recover model
    // memory under pressure, and the next load is the thing that will feel it, so it is reported
    // through the same typed path as a failed recovery instead of being dropped.
    logger.error('[ModelServices] memory warning listener could not be registered', error);
    reportMemoryWarningFailure(error);
  }
  return () => {
    subscription?.remove();
    subscription = undefined;
  };
}
