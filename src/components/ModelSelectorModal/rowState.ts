import type { ActiveModelInfo } from '../../services/activeModelService/types';

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

export interface TextRowState {
  /** Highlighted: the row the chat will use (or, while a load runs, the row being loaded). */
  isActive: boolean;
  /** Information only: this model is the one resident in memory. */
  showLoadedCheck: boolean;
  /** A tap would change nothing (it is already the selection) or a load is running. */
  disabled: boolean;
}

/**
 * How one local text row looks and whether it takes a tap. PURE.
 *
 * Every part follows the SELECTION (activeModelId), never the resident model. Selecting only marks a
 * model and the load waits for the next message, so the two drift apart: after A → B, A is still
 * resident while B is selected. Keying the row off the resident model disabled A, so tapping A again
 * did nothing and the chat stayed on B (device 2026-10-22: 0.8B → 2B → 0.8B, then a photo answered
 * "Vision Not Supported" because 2B has no projector). The loaded checkmark stays, as information.
 */
export function textRowState(args: {
  modelPath: string;
  modelId: string;
  /** The resident model's path, if any. */
  loadedPath: string | null;
  /** The selected model's path; falls back to the resident one when nothing is selected. */
  selectedPath: string | null;
  remoteActive: boolean;
  loadingModelId: string | null;
  isAnyLoading: boolean;
}): TextRowState {
  const { modelPath, modelId, loadedPath, selectedPath, remoteActive, loadingModelId, isAnyLoading } = args;
  const isSelected = !remoteActive && (selectedPath ?? loadedPath) === modelPath;
  const loadInProgress = loadingModelId != null;
  return {
    isActive: !remoteActive && (loadInProgress ? loadingModelId === modelId : isSelected),
    showLoadedCheck: !remoteActive && !loadInProgress && loadedPath === modelPath,
    disabled: isAnyLoading || isSelected,
  };
}
