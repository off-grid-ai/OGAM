import type { ActiveModelInfo } from '../../services/modelServices/modelStateTypes';

/**
 * Which text row shows a spinner: the model a load is actually running for, and nothing otherwise.
 *
 * PURE, so the rule can be read and tested on its own. It exists because the sheet used to decide this
 * from the tap - and tapping a row deliberately does not start a load (selecting MARKS a model; the
 * load is deferred to the first message), so the spinner had nothing to end it and ran forever.
 *
 * `parentIsLoading` stays in the answer for the reload path: the "settings changed, reload" card opens
 * this sheet while the screen reloads the SAME active model, and that load is reported by the screen.
 */
export function loadingTextRowId(
  status: ActiveModelInfo,
  parentIsLoading: boolean,
  selectedId: string | null,
): string | null {
  if (!status.text.isLoading && !parentIsLoading) return null;
  return status.text.model?.id ?? selectedId;
}
