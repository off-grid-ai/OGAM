/**
 * A pressed control's id for `session_summary.actions`: its testID, and only when that testID is
 * written in source. A templated testID (`kb-document-remove-${id}`) shrinks to its fixed part
 * (`kb-document-remove`), so an id or a name in it never leaves the device. Visible text is never read.
 */
import { FIXED_ACTION_IDS, TEMPLATE_ACTION_IDS } from './actionIds.generated';

export const ACTION_ID = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
/** What a testID that is not in source counts as. */
export const UNKNOWN_ACTION = 'other';

const fixed = new Set(FIXED_ACTION_IDS);
const templates = TEMPLATE_ACTION_IDS.map(([source, id]) => [new RegExp(source), id] as const);
const cache = new Map<string, string>();
const CACHE_CAP = 500;

export function normalizeActionId(testID: string | null | undefined): string | null {
  if (!testID) return null;
  const known = cache.get(testID);
  if (known) return known;
  let id = UNKNOWN_ACTION;
  if (fixed.has(testID)) id = testID;
  else {
    const match = templates.find(([pattern]) => pattern.test(testID));
    if (match) id = match[1];
  }
  if (!ACTION_ID.test(id)) id = UNKNOWN_ACTION;
  if (cache.size < CACHE_CAP) cache.set(testID, id);
  return id;
}
