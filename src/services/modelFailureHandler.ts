/**
 * modelFailureHandler — the ONE owner that turns any model failure (text, image,
 * tts, stt, embedding) into a uniform, dismissible card. Before this, failures
 * surfaced five different ways: text → a typed alert, image → a flat chat message,
 * tts/stt → a `state.error` field nobody rendered, embedding/RAG → silently
 * swallowed. Now every path calls reportModelFailure and the user always sees the
 * same dismissible ModelFailureCard — nothing is silent, nothing is a chat message.
 *
 * Severity is the contract:
 *  - 'error' (default): a load/generation was BLOCKED. The error→reason heuristic
 *    and reason→copy live in ONE place (modelReadiness) and are reused here, so an
 *    insufficient-memory failure reads the same everywhere and offers Retry.
 *  - 'warning': a soft, NON-blocking degradation (e.g. prompt enhancement skipped
 *    because the text model couldn't load — the image still generates). The caller
 *    supplies the plain message; we never invent a scary "failed" title for these.
 */
import {
  reasonFromLoadError,
  modelNotReadyAlert,
  type ModelNotReadyReason,
} from './modelFailureReasons';
import { isOverridableMemoryError } from './modelLoadErrors';
import {
  useModelFailureStore,
  type ModelFailure,
  type ModelFailureType,
  type ModelFailureSeverity,
} from '../stores/modelFailureStore';
import logger from '../utils/logger';

/** Human label per model type, used in the card title (e.g. "Image model"). */
const TYPE_LABEL: Record<ModelFailureType, string> = {
  text: 'Text model',
  image: 'Image model',
  tts: 'Voice',
  stt: 'Transcription',
  embedding: 'Memory',
};

export interface ReportFailureContext {
  /** 'error' (blocking, default) or 'warning' (soft degradation). */
  severity?: ModelFailureSeverity;
  /** Override the derived message — required for 'warning' (the soft copy). */
  message?: string;
  /** Override the derived title. */
  title?: string;
  /** When set on an 'error', the card shows a Retry button that runs this. */
  onRetry?: () => void;
  /** When the error is the OVERRIDABLE memory gate, the card shows "Load Anyway"
   *  that runs this (re-attempt forcing past the budget). Ignored for non-overridable
   *  errors and for warnings — so a caller can pass it unconditionally and it only
   *  surfaces when the gate is actually overridable. */
  onLoadAnyway?: () => void;
  /** Stable id so repeated reports for the same surface replace, not stack.
   *  Defaults to the modelType (one card per subsystem). */
  id?: string;
}

/**
 * Report a model failure to the single dismissible surface. Returns the pushed
 * ModelFailure (handy for tests/logging). Counterpart to ensureReadyOrAlert's
 * alert path — both share the same reason→copy source so wording never drifts.
 */
export function reportModelFailure(
  modelType: ModelFailureType,
  error: unknown,
  ctx: ReportFailureContext = {},
): ModelFailure {
  const severity = ctx.severity ?? 'error';
  const reason: ModelNotReadyReason | null = severity === 'error' ? reasonFromLoadError(error) : null;
  const detail = error instanceof Error ? error.message : error ? String(error) : undefined;
  const copy = reason ? modelNotReadyAlert(reason, detail) : null;
  // "Load Anyway" is offered only for a hard error whose CAUSE is the overridable
  // memory gate — derived once here from the typed discriminant (never re-sniffed
  // from the message). Callers pass onLoadAnyway unconditionally; it's dropped unless
  // the gate is genuinely overridable, so a non-memory failure never shows the button.
  const overridable = severity === 'error' && isOverridableMemoryError(error);

  const failure: ModelFailure = {
    id: ctx.id ?? modelType,
    modelType,
    severity,
    title: ctx.title ?? (copy ? `${TYPE_LABEL[modelType]}: ${copy.title}` : `${TYPE_LABEL[modelType]} notice`),
    message: ctx.message ?? copy?.message ?? (detail ?? 'Something went wrong.'),
    onRetry: severity === 'error' ? ctx.onRetry : undefined,
    memoryPressure: reason === 'insufficient-memory',
    overridable,
    onLoadAnyway: overridable ? ctx.onLoadAnyway : undefined,
  };

  // [FAIL-SM] trace (kept forever): every model failure, its derived reason and
  // severity, in one place — so a silent/mis-surfaced failure is never a mystery.
  logger.log(
    `[FAIL-SM] ${modelType} ${severity} reason=${reason ?? 'n/a'} memPressure=${failure.memoryPressure} detail=${detail ?? ''}`,
  );

  useModelFailureStore.getState().report(failure);
  return failure;
}

/** Dismiss a failure card (e.g. once a retry succeeds). */
export function clearModelFailure(modelType: ModelFailureType): void {
  useModelFailureStore.getState().dismiss(modelType);
}
