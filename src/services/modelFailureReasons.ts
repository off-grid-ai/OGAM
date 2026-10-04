/**
 * Pure model-failure reason + copy — the single source for "map a load error to a
 * typed reason" and "the user-facing copy for a reason". UI-FREE on purpose: both
 * the service layer (modelFailureHandler) and the screen layer (modelReadiness'
 * alert path) depend on it, so it must not import any component/UI module. (When
 * this lived in the screen module, importing it from a service dragged the
 * components barrel → ModelCard → native vector-icons into non-UI test envs.)
 */

export {
  modelNotReadyAlert,
  reasonFromLoadError,
  type ModelNotReadyReason,
} from '@offgrid/models';
