/**
 * loadModelWithOverride — the SINGLE way any screen loads a model with the inline
 * "Load Anyway" memory-override flow.
 *
 * The override behaviour (catch OverridableMemoryError → offer "Load Anyway" →
 * retry with { override: true }) used to be re-implemented per screen. The Chats
 * tab had a plain `catch → showAlert('Failed to load model')` with no override, so
 * a memory-blocked load there dead-ended while the chat screen offered Load Anyway.
 * That divergence is the bug. This helper owns the flow once so EVERY caller (Chats
 * tab, model selector, chat turn) behaves identically — pass a load thunk that takes
 * the override opts and the screen's alert setter.
 */
import { AlertState, showAlert, hideAlert } from '../utils/alertState';
import { isOverridableMemoryError } from '../utils/modelLoadErrors';

/** Safe message extraction — a thrown value isn't guaranteed to be an Error, and
 *  `(error as Error).message` renders "undefined" for a string/other throw. */
const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface LoadWithOverrideDeps {
  setAlertState: (a: AlertState) => void;
  /** Ran on a successful load (initial OR after Load Anyway). e.g. navigate/close sheet. */
  onSuccess?: () => void;
  /** Ran on a non-overridable failure, after the error alert is shown. */
  onError?: (error: Error) => void;
  /** Ran before each attempt (initial + the Load-Anyway retry). e.g. setLoading(true). */
  onAttemptStart?: () => void;
  /** Ran after each attempt settles. e.g. setLoading(false). */
  onAttemptEnd?: () => void;
}

/**
 * @param load  performs the load; receives `{ override: true }` on the Load-Anyway retry.
 */
export async function loadModelWithOverride(
  load: (opts?: { override?: boolean }) => Promise<void>,
  deps: LoadWithOverrideDeps,
): Promise<void> {
  const attempt = async (override: boolean): Promise<void> => {
    deps.onAttemptStart?.();
    try {
      await load(override ? { override: true } : undefined);
      deps.onSuccess?.();
    } catch (error) {
      // Only the memory gate is overridable, and only offer it once (not after the
      // user already chose Load Anyway and it still failed — that's a real hard limit).
      if (!override && isOverridableMemoryError(error)) {
        deps.setAlertState(
          showAlert(
            'Insufficient Memory',
            `${errorMessage(error)}\n\nWould you like to override these safeguards and load it anyway?`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Load Anyway',
                style: 'destructive',
                onPress: () => {
                  deps.setAlertState(hideAlert());
                  void attempt(true);
                },
              },
            ],
          ),
        );
        return;
      }
      deps.setAlertState(showAlert('Error', `Failed to load model: ${errorMessage(error)}`));
      deps.onError?.(error instanceof Error ? error : new Error(errorMessage(error)));
    } finally {
      deps.onAttemptEnd?.();
    }
  };
  await attempt(false);
}
