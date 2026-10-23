/**
 * The saved state was read late (slow, or retried after a failure) while the user was already working on
 * the launch defaults. Keep both: the saved state, with what the user changed during that session on top.
 *
 * A value the session never touched is still the launch value (the same reference), so the saved one is
 * taken. A list of records with ids keeps the saved records, takes the session's edits and additions,
 * and drops what the session deleted. A plain object is merged field by field. Anything else the session
 * changed wins. `keepCurrent` names keys that always follow the session (where the user is right now).
 */
type Rec = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const idOf = (value: unknown): string | undefined =>
  isPlainObject(value) && typeof value.id === 'string' ? value.id : undefined;

const isRecordList = (value: unknown): value is Rec[] =>
  Array.isArray(value) && value.every(item => idOf(item) !== undefined);

function mergeRecords(saved: Rec[], current: Rec[], atLaunch: Rec[]): Rec[] {
  const launchById = new Map(atLaunch.map(item => [idOf(item)!, item]));
  const currentById = new Map(current.map(item => [idOf(item)!, item]));
  const savedIds = new Set(saved.map(item => idOf(item)!));
  const kept = saved
    // Deleted during the session: it was there at launch and is gone now.
    .filter(item => !(launchById.has(idOf(item)!) && !currentById.has(idOf(item)!)))
    .map(item => {
      const id = idOf(item)!;
      const edited = currentById.get(id);
      return edited && edited !== launchById.get(id) ? edited : item;
    });
  const added = current.filter(item => !launchById.has(idOf(item)!) && !savedIds.has(idOf(item)!));
  // New records go on the side the list grows from (newest-first lists add at the front).
  const growsAtFront = current.length > 0 && added.includes(current[0]);
  return growsAtFront ? [...added, ...kept] : [...kept, ...added];
}

function mergeValue(saved: unknown, current: unknown, atLaunch: unknown): unknown {
  if (current === atLaunch) return saved;
  if (isRecordList(saved) && isRecordList(current) && isRecordList(atLaunch)) {
    return mergeRecords(saved, current, atLaunch);
  }
  if (isPlainObject(saved) && isPlainObject(current) && isPlainObject(atLaunch)) {
    const merged: Rec = { ...saved };
    for (const key of Object.keys(current)) {
      merged[key] = mergeValue(saved[key], current[key], atLaunch[key]);
    }
    return merged;
  }
  return current;
}

export function mergeSessionIntoSaved<T extends object>(
  saved: T,
  current: T,
  atLaunch: T,
  keys: readonly string[],
  keepCurrent: readonly string[] = [],
): T {
  const merged: Rec = { ...(saved as Rec) };
  const now = current as Rec;
  const launch = atLaunch as Rec;
  for (const key of keys) {
    merged[key] = keepCurrent.includes(key)
      ? now[key]
      : mergeValue((saved as Rec)[key], now[key], launch[key]);
  }
  return merged as T;
}
