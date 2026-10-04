/**
 * The one contract for deleting a generated image's bytes on the device.
 *
 * Deletion is driven by a DURABLE intent that outlives the process, so it is retried. The retry
 * must be able to settle: a first attempt that unlinked the file and then died before the journal
 * acknowledged it leaves an intent whose file is already gone. `already_missing` is therefore a
 * SUCCESS - the requested end-state (no bytes at that path) holds - and it is what makes the whole
 * operation idempotent.
 *
 * `failure` is the opposite claim: bytes may still exist and this attempt did not remove them
 * (permission denied, a busy or locked file, an I/O error, no native module to ask). It carries the
 * native reason so the caller keeps the intent and retries instead of dropping a real file.
 *
 * The three cases are distinct on purpose. Collapsing them - a boolean, or treating a missing file
 * as an error - either strands an intent forever or silently forgets bytes that are still on disk.
 */
export type NativeImageDeleteOutcome =
  | { status: 'deleted' }
  | { status: 'already_missing' }
  | { status: 'fenced' }
  | { status: 'failure'; code: string; message: string };

export const nativeImageDeleteFailure = (
  code: string,
  message: string,
): NativeImageDeleteOutcome => ({ status: 'failure', code, message });

export type NativeImageDeletePathProjection =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly outcome: NativeImageDeleteOutcome };

/** Admit only an exact file directly inside Mobile's canonical generated-image directory. */
export function projectNativeImageDeletePath(
  rawPath: unknown,
  generatedImageDirectory: string,
): NativeImageDeletePathProjection {
  let root = generatedImageDirectory;
  while (root.endsWith('/')) {
    root = root.slice(0, -1);
  }
  if (typeof rawPath !== 'string' || rawPath.includes('\0')) {
    return {
      ok: false,
      outcome: nativeImageDeleteFailure(
        'UNSAFE_DELETE_PATH',
        'The generated-image deletion path is not valid text.',
      ),
    };
  }
  const prefix = `${root}/`;
  const fileName = rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : '';
  if (
    !root.startsWith('/') ||
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.includes('/')
  ) {
    return {
      ok: false,
      outcome: nativeImageDeleteFailure(
        'UNSAFE_DELETE_PATH',
        'The generated-image deletion path is outside the generated-image directory.',
      ),
    };
  }
  return {ok: true, path: rawPath};
}

/**
 * Project whatever the native module resolved into the contract.
 *
 * The bridge is untyped, and an old binary paired with new JS can resolve a boolean or nothing at
 * all. Anything this projection cannot READ as one of the three cases is a `failure`: an
 * unrecognised answer is not evidence that the bytes were removed, so it must keep the intent.
 */
export function projectNativeImageDeleteOutcome(
  raw: unknown,
): NativeImageDeleteOutcome {
  const status =
    typeof raw === 'object' && raw !== null
      ? (raw as { status?: unknown }).status
      : raw;

  if (status === 'deleted') return { status: 'deleted' };
  if (status === 'already_missing') return { status: 'already_missing' };
  if (status === 'failure') {
    const detail = (raw ?? {}) as { code?: unknown; message?: unknown };
    return nativeImageDeleteFailure(
      typeof detail.code === 'string' && detail.code !== ''
        ? detail.code
        : 'NATIVE_DELETE_FAILED',
      typeof detail.message === 'string' && detail.message !== ''
        ? detail.message
        : 'The native image store reported a delete failure.',
    );
  }
  return nativeImageDeleteFailure(
    'UNRECOGNISED_NATIVE_DELETE_RESULT',
    `The native image store answered with an unrecognised delete result: ${JSON.stringify(raw ?? null)}.`,
  );
}
