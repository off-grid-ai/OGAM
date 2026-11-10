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

/**
 * The one sheet for a load the memory gate refused. It says why, then offers the next step: another
 * model (when the screen can open its picker), Load Anyway (neutral, not red: it is a choice, not a
 * deletion), or cancel. Both load paths used to build their own copy with "Load Anyway" in red and no
 * way forward except risking the load (device, 2026-11-05: Gemma 4 E4B refused, nothing offered).
 */
export function memoryRefusalAlert(
  detail: string,
  actions: { onTryAnyway: () => void; onCancel?: () => void; onChooseModel?: () => void },
): AlertState {
  // Load Anyway can still run the phone out of memory; the sheet says so in one line.
  return showAlert('Insufficient Memory', `${detail}\n\nLoad Anyway may close the app if memory runs out.`, [
    ...(actions.onChooseModel ? [{ text: 'Choose another model', style: 'primary' as const, onPress: actions.onChooseModel }] : []),
    { text: 'Load Anyway', onPress: actions.onTryAnyway },
    { text: 'Cancel', style: 'cancel' as const, onPress: actions.onCancel },
  ]);
}

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
  /** Opens the screen's model picker; offered as the way forward when memory refuses the load. */
  onChooseModel?: () => void;
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
          memoryRefusalAlert(errorMessage(error), {
            onTryAnyway: () => {
              deps.setAlertState(hideAlert());
              void attempt(true);
            },
            onChooseModel: deps.onChooseModel,
          }),
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
