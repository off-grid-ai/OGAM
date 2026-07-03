import RNFS from 'react-native-fs';

/**
 * Re-base a stored absolute Documents path onto the CURRENT app container.
 *
 * iOS assigns a new Data-container UUID on each (re)install and migrates the
 * Documents contents into it — so a path stored at write time
 * (`…/Application/<OLD-UUID>/Documents/audio-input/x.wav`) can reference a stale
 * UUID even though the file now lives under the current container. Storing
 * absolute container paths is therefore fragile; this resolves them at read time.
 *
 * Strips everything up to and including the first `/Documents/` and re-roots the
 * remainder onto the current `RNFS.DocumentDirectoryPath`. Paths that aren't under
 * a Documents directory (or are empty) are returned unchanged. The result is a
 * bare filesystem path (no `file://` scheme — callers add it if they need it).
 */
export function resolveDocumentPath(stored: string): string {
  if (!stored) return stored;
  const noScheme = stored.replace(/^file:\/\//, '');
  const marker = '/Documents/';
  const idx = noScheme.indexOf(marker);
  if (idx === -1) return noScheme; // not under Documents — leave as-is (sans scheme)
  const relative = noScheme.slice(idx + marker.length);
  const base = RNFS.DocumentDirectoryPath.replace(/\/+$/, '');
  return `${base}/${relative}`;
}
