export type ProjectDeleteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export const PROJECT_DELETE_FALLBACK_REASON =
  'This project could not be deleted.';

export function projectDeleteFailure(error: unknown): ProjectDeleteOutcome {
  const reason =
    error instanceof Error ? error.message.trim() : String(error).trim();
  return {
    ok: false,
    reason: reason || PROJECT_DELETE_FALLBACK_REASON,
  };
}
