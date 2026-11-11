/** Which home tiles show and in what order. Pure, so it is tested without a device. */
export interface HomeTilePrefs { order?: string[]; hidden?: string[] }

/** All tile keys in the person's order (new tiles from an update go last), with `hidden` ones left out unless `showHidden`. */
export function arrangeTiles(keys: string[], prefs: HomeTilePrefs | undefined, showHidden = false): string[] {
  const known = (prefs?.order ?? []).filter((k) => keys.includes(k));
  const ordered = [...known, ...keys.filter((k) => !known.includes(k))];
  const hidden = new Set(prefs?.hidden ?? []);
  return showHidden ? ordered : ordered.filter((k) => !hidden.has(k));
}

/** Moves one tile a place up or down among all tiles. */
export function moveTile(keys: string[], prefs: HomeTilePrefs | undefined, move: { key: string; by: -1 | 1 }): HomeTilePrefs {
  const { key, by } = move;
  const all = arrangeTiles(keys, prefs, true);
  const i = all.indexOf(key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= all.length) return { ...prefs, order: all };
  [all[i], all[j]] = [all[j], all[i]];
  return { ...prefs, order: all };
}

/** Shows or hides a tile. Settings is never hidden: it is the way back. */
export function toggleTile(prefs: HomeTilePrefs | undefined, key: string): HomeTilePrefs {
  if (key === 'settings') return prefs ?? {};
  const hidden = new Set(prefs?.hidden ?? []);
  if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
  return { ...prefs, hidden: [...hidden] };
}
