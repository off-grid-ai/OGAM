import type { ModelType } from '../../stores/downloadStore';

/**
 * The ONE rule for the uniform id the ModelDownloadService routes cancel/retry/remove
 * on. Both sides MUST derive the id through this function so they can never diverge:
 *
 *  - the providers' `list()` assigns each download this id, and
 *  - the Download Manager's action dispatch (`idOf`) re-derives it to route on.
 *
 * The bug this prevents: STT store rows are keyed `whisper-<id>` (e.g.
 * `whisper-medium.en`), but `whisperService` keys models by the bare id
 * (`medium.en`). The provider stripped the prefix when listing (`stt:medium.en`)
 * while the View re-derived `stt:whisper-medium.en` from the raw store modelId — so
 * the service's lookup missed and Remove/Cancel/Retry silently no-opped
 * (`[DL-SM] … REFUSED: not found`). Every other type passes the modelId through
 * unchanged; only STT normalizes, and it normalizes HERE, once.
 */
export function uniformDownloadId(modelType: ModelType, modelId: string): string {
  // Per-type canonicalization, owned HERE so the providers' list() and the View's
  // dispatch can't drift. Both are idempotent (safe whether given the bare id or the
  // prefixed store id): STT store rows are `whisper-<id>` but whisperService keys by
  // the bare id; image store rows carry an `image:` prefix the provider strips.
  let canonical = modelId;
  if (modelType === 'stt') canonical = modelId.replace(/^whisper-/, '');
  else if (modelType === 'image') canonical = modelId.replace(/^image:/, '');
  return `${modelType}:${canonical}`;
}

/** The identity fields carried by a still-queued start (from getQueuedItems). */
export interface QueuedIdentity {
  modelType: ModelType;
  modelId: string;
  modelKey: string;
}

/**
 * The uniform id for a start that is still WAITING for a concurrency slot. It MUST
 * resolve to the exact id the provider assigns once that start becomes a listed
 * (downloading) row, or cancel/remove on a Queued item silently no-ops.
 *
 * The trap this closes: a text download's started-row id is `text:<modelKey>` (modelKey
 * = repo/file), because `textProvider.list()` keys on `modelKey`. But a queued item's
 * bare `modelId` is only the repo. Deriving the id from `modelId` gives `text:<repo>`,
 * which never matches the `text:<repo/file>` the View dispatches — so the queued row
 * stays and downloads anyway. Text routes on `modelKey`; every other type passes
 * `modelId` through. Owned HERE so the View's dispatch and `cancelQueuedStart` can't
 * diverge.
 */
export function queuedUniformId(q: QueuedIdentity): string {
  const idInput = q.modelType === 'text' ? q.modelKey : q.modelId;
  return uniformDownloadId(q.modelType, idInput);
}
