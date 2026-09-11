/**
 * Model readiness — the single typed outcome for "is a usable text model loaded
 * for this turn, and if not, WHY".
 *
 * This replaces a `Promise<boolean>` that collapsed five distinct failures
 * (no model selected, model not on disk, out of memory, a load already running,
 * the native load threw) into one opaque `false`. That collapse is why every
 * failure surfaced as the same useless "Failed to load model. Please try again."
 * alert AND why the failure was undiagnosable from logs — the reason was thrown
 * away at the return. With a typed reason: the caller renders the right intent,
 * a [GEN-SM] log line records which branch fired, and a test asserts each one.
 *
 * Single source of truth: the reason->message copy and the error->reason
 * heuristic live here ONCE and every caller reuses them (no per-call-site
 * duplication).
 */

import type { ChatModelReadyOutcome } from '@offgrid/application';
// The error→reason heuristic and reason→copy live in a UI-free module (so the
// service layer can reuse them without dragging the components barrel in). Re-export
// for the many call sites that import them from here.
import { reasonFromLoadError, modelNotReadyAlert } from '@offgrid/application';

export { reasonFromLoadError, modelNotReadyAlert };

export type ModelReadyOutcome = ChatModelReadyOutcome;
