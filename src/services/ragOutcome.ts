import type { Outcome, RagFailure } from '@offgrid/application';

/** Convert a typed RAG command result at the Mobile boundary without hiding failure. */
export function requireRagSuccess<Value>(
  outcome: Outcome<Value, RagFailure>,
): Value {
  if (!outcome.ok) throw new Error(outcome.failure.message);
  return outcome.value;
}
