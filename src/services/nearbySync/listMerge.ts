/**
 * Merge for the stores that hold lists you add to on either phone: saved map places, checklists and
 * Survival Manual notes. "The newest copy wins" lost whatever the other phone added, so these merge
 * item by item instead.
 *
 * Deleting is the hard part: an item that is on one phone only is either new there or deleted on the
 * other. The ids both phones had at the last sync (the baseline) tell them apart: one that is in the
 * baseline was deleted; one that is not was added. With no baseline yet (the first sync), nothing is
 * treated as deleted.
 */
export type Baseline = Record<string, string[]>;

/** Stores that are one list of items with an id: learn-a-topic courses, pinned answers, skills (named) and scheduled tasks. */
const ITEM_LISTS: Record<string, { field: string; id: (x: any) => string }> = {
  'atlas-topics': { field: 'courses', id: (x) => x.id },
  'atlas-pins': { field: 'pins', id: (x) => x.id },
  'atlas-skills': { field: 'skills', id: (x) => x.name },
  'atlas-schedule': { field: 'tasks', id: (x) => x.id },
};
export const LIST_STORES = new Set(['atlas-maps', 'atlas-checklists', 'atlas-survival-manual', ...Object.keys(ITEM_LISTS)]);

type Obj = Record<string, any>;
type WithId = { id: string };

/** `newer`'s items, plus the items only the older copy has that are new (not in the baseline). */
function mergeById<T>(newer: T[] = [], older: T[] = [], opts: { base?: string[]; id?: (x: T) => string } = {}): T[] {
  const { base } = opts;
  const id = opts.id ?? ((x: T) => (x as WithId).id);
  const have = new Set(newer.map(id));
  const known = new Set(base ?? []);
  return [...newer, ...older.filter((x) => !have.has(id(x)) && !(base && known.has(id(x))))];
}

/** The ids in a store that the baseline records, so the next merge can tell a new item from a deleted one. */
export function listIds(key: string, raw: string): Baseline {
  const state: Obj = JSON.parse(raw)?.state ?? {};
  const items = ITEM_LISTS[key];
  if (items) return { [`${key}/items`]: (state[items.field] ?? []).map(items.id) };
  if (key === 'atlas-maps') return { 'atlas-maps/waypoints': (state.waypoints ?? []).map((w: WithId) => w.id) };
  if (key !== 'atlas-checklists') return {};
  const out: Baseline = { 'atlas-checklists/lists': (state.lists ?? []).map((l: WithId) => l.id) };
  for (const list of state.lists ?? []) out[`atlas-checklists/${list.id}`] = (list.items ?? []).map((i: WithId) => i.id);
  return out;
}

const unionById = <T,>(a: T[] = [], b: T[] = [], id: (x: T) => string): T[] => {
  const seen = new Set(a.map(id));
  return [...a, ...b.filter((x) => !seen.has(id(x)))];
};

/**
 * One course from both phones: the newer copy's own fields, every written square from either, the best stars per
 * square, the squares of whichever copy has more (extra lessons added after a bad score), and the union of sources.
 */
export function mergeCourse(newer: Obj, older: Obj): Obj {
  const squares = unionById<Obj>(newer.squares, older.squares, (q) => q.key);
  const order = (newer.squares ?? []).length >= (older.squares ?? []).length ? newer.squares : older.squares;
  const rank = new Map<string, number>((order ?? []).map((q: Obj, i: number) => [q.key, i]));
  const progress: Obj = { ...older.progress };
  for (const [k, v] of Object.entries<any>(newer.progress ?? {})) progress[k] = { ...progress[k], ...v, stars: Math.max(v?.stars ?? 0, progress[k]?.stars ?? 0) };
  return {
    ...newer,
    squares: squares.sort((p, q) => (rank.get(p.key) ?? 1e9) - (rank.get(q.key) ?? 1e9)),
    content: { ...older.content, ...newer.content },
    progress,
    sources: unionById<Obj>(newer.sources, older.sources, (x) => x.id),
    lastPlayedAt: Math.max(newer.lastPlayedAt ?? 0, older.lastPlayedAt ?? 0) || undefined,
  };
}

/**
 * The store to save here from this phone's copy and the other phone's. `remoteNewer` says which
 * copy was changed last: its choices (ticks, the unit setting) win where both have the item.
 * Anything tied to this phone's files (the selected map, map file paths, scroll position) stays.
 */
export function mergeListStore(key: string, o: { local: string; remote: string; remoteNewer: boolean; baseline?: Baseline }): string {
  const local = JSON.parse(o.local);
  const remote = JSON.parse(o.remote);
  const mine: Obj = local.state ?? {};
  const theirs: Obj = remote.state ?? {};
  const newer = o.remoteNewer ? theirs : mine;
  const older = o.remoteNewer ? mine : theirs;
  const base = o.baseline ?? {};
  let state: Obj = mine;
  const items = ITEM_LISTS[key];
  if (items) {
    const both = new Map<string, Obj>((older[items.field] ?? []).map((x: Obj) => [items.id(x), x]));
    const merged = mergeById<any>(newer[items.field], older[items.field], { base: base[`${key}/items`], id: items.id }) as Obj[];
    state = { ...mine, [items.field]: merged.map((x) => {
      const other = both.get(items.id(x));
      const inNewer = (newer[items.field] ?? []).some((n: Obj) => items.id(n) === items.id(x));
      return key === 'atlas-topics' && other && inNewer ? mergeCourse(x, other) : x;
    }) };
  } else if (key === 'atlas-maps') {
    state = { ...mine, imperial: newer.imperial ?? mine.imperial,
      waypoints: mergeById(newer.waypoints, older.waypoints, { base: base['atlas-maps/waypoints'] }) };
  } else if (key === 'atlas-checklists') {
    const lists = mergeById<Obj>(newer.lists, older.lists, { base: base['atlas-checklists/lists'] });
    const olderById = new Map<string, Obj>((older.lists ?? []).map((l: Obj) => [l.id, l]));
    state = { ...mine, lists: lists.map((list: Obj) => {
      const other = olderById.get(list.id);
      // A list the older copy has too: its items merge (the list itself is the newer copy's).
      const fromNewer = (newer.lists ?? []).some((l: Obj) => l.id === list.id);
      return other && fromNewer
        ? { ...list, items: mergeById(list.items, other.items, { base: base[`atlas-checklists/${list.id}`] }) }
        : list;
    }) };
  } else if (key === 'atlas-survival-manual') {
    state = { ...mine, notes: { ...older.notes, ...newer.notes } };
  }
  return JSON.stringify({ ...local, state });
}
