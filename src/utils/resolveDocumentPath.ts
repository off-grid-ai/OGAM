import RNFS from 'react-native-fs';

/**
 * Re-base a stored absolute app-container path onto the CURRENT app container.
 *
 * iOS assigns a new Data-container UUID on each (re)install and migrates the
 * Documents contents into it — so a path stored at write time
 * (`…/Application/<OLD-UUID>/Documents/audio-input/x.wav`) can reference a stale
 * UUID even though the file now lives under the current container. Storing
 * absolute container paths is therefore fragile; this resolves them at read time.
 *
 * Documents survive as durable files. Old chat attachments can also point at the app's tmp or
 * Library/Caches directory; iOS can keep those bytes while changing the container UUID, so those
 * paths need the same read-time repair. Paths outside an iOS app container are returned unchanged.
 * The result is a bare filesystem path (no `file://` scheme — callers add it if they need it).
 */
export function resolveDocumentPath(stored: string): string {
  if (!stored) return stored;
  const noScheme = stored.replace(/^file:\/\//, '');
  const match = /\/Containers\/Data\/Application\/[^/]+\/(Documents|Library\/Caches|tmp)\/(.+)$/.exec(noScheme);
  if (!match) return noScheme;
  const [, directory, relative] = match;
  const root = directory === 'Documents'
    ? RNFS.DocumentDirectoryPath
    : directory === 'Library/Caches'
      ? RNFS.CachesDirectoryPath
      : RNFS.TemporaryDirectoryPath;
  return `${root.replace(/\/+$/, '')}/${relative}`;
}

/**
 * Resolve a stored Documents path and prove that it remains inside one app-owned directory.
 *
 * iOS can report the same container through `/private/var/...` while RNFS reports `/var/...`.
 * Comparing those raw strings rejects a valid model path and leaves the model bytes on disk.
 * Rebasing first gives both spellings one identity. Rejecting traversal segments keeps this safe
 * for destructive operations such as model deletion.
 */
export function resolveOwnedDocumentPath(stored: string, ownedRoot: string): string | null {
  const resolved = resolveDocumentPath(stored);
  const root = ownedRoot.replace(/\/+$/, '');
  const prefix = `${root}/`;
  if (!resolved.startsWith(prefix)) return null;

  const relative = resolved.slice(prefix.length);
  const segments = relative.split('/');
  if (!relative || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  return resolved;
}
