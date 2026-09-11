import { NativeModules } from 'react-native';

export type AppOwnedFileRoot =
  | 'documents'
  | 'cache'
  | 'temporary'
  | 'shared_files';

export type ConfinedRegularFileDeleteOutcome =
  | { readonly status: 'deleted' | 'already_missing' }
  | {
      readonly status: 'refused';
      readonly code: string;
      readonly message: string;
    };

export type ConfinedRegularFileMoveOutcome =
  | { readonly status: 'moved' | 'already_moved' }
  | {
      readonly status: 'refused';
      readonly code: string;
      readonly message: string;
    };

export type LegacyQuarantineReceiptAdoptionOutcome =
  | { readonly status: 'adopted' | 'already_adopted' }
  | {
      readonly status: 'refused';
      readonly code: string;
      readonly message: string;
    };

export interface LegacyQuarantineReceiptAuthority {
  readonly root: 'shared_files';
  readonly expectedOriginalPath: string;
  readonly expectedQuarantinePath: string;
  readonly operationId: string;
  readonly expectedSize: number;
  readonly expectedSha256: string;
}

interface ConfinedMoveInput {
  readonly root: AppOwnedFileRoot;
  readonly expectedSourcePath: string;
  readonly expectedDestinationPath: string;
  readonly operationId: string;
}

interface NativeConfinedFileDeletion {
  deleteConfinedRegularFile(input: {
    readonly root: AppOwnedFileRoot;
    readonly expectedPath: string;
    readonly operationId: string;
  }): Promise<unknown>;
  moveConfinedRegularFile(input: ConfinedMoveInput): Promise<unknown>;
  restoreConfinedRegularFile(input: ConfinedMoveInput): Promise<unknown>;
  adoptLegacyConfinedQuarantineReceipt(
    input: LegacyQuarantineReceiptAuthority,
  ): Promise<unknown>;
}

const nativeBoundary = (): NativeConfinedFileDeletion | undefined => {
  const candidate = NativeModules.OffgridConfinedFile as
    | Partial<NativeConfinedFileDeletion>
    | undefined;
  return typeof candidate?.deleteConfinedRegularFile === 'function'
    ? (candidate as NativeConfinedFileDeletion)
    : undefined;
};

const refused = (
  code: string,
  message: string,
): {
  readonly status: 'refused';
  readonly code: string;
  readonly message: string;
} => ({
  status: 'refused',
  code,
  message,
});

async function confinedMove(
  operation: 'moveConfinedRegularFile' | 'restoreConfinedRegularFile',
  input: ConfinedMoveInput,
): Promise<ConfinedRegularFileMoveOutcome> {
  if (
    !input.expectedSourcePath.startsWith('/') ||
    !input.expectedDestinationPath.startsWith('/') ||
    input.expectedSourcePath === input.expectedDestinationPath ||
    input.operationId.trim().length === 0
  ) {
    return refused(
      'INVALID_MOVE_IDENTITY',
      'Confined file movement requires exact absolute paths and an operation identity.',
    );
  }
  const candidate = NativeModules.OffgridConfinedFile as
    | Partial<NativeConfinedFileDeletion>
    | undefined;
  const boundary = candidate?.[operation];
  if (typeof boundary !== 'function') {
    return refused(
      'NATIVE_BOUNDARY_UNAVAILABLE',
      'The native confined-file movement boundary is unavailable.',
    );
  }
  try {
    const value = await boundary.call(candidate, input);
    const status = (value as { status?: unknown } | null)?.status;
    if (status === 'moved' || status === 'already_moved') return { status };
    if (
      status === 'refused' &&
      typeof (value as { code?: unknown }).code === 'string' &&
      typeof (value as { message?: unknown }).message === 'string'
    ) {
      return value as ConfinedRegularFileMoveOutcome;
    }
    return refused(
      'INVALID_NATIVE_OUTCOME',
      'The native confined-file boundary returned an invalid movement outcome.',
    );
  } catch (cause) {
    return refused(
      'NATIVE_MOVE_FAILED',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/** Atomically move an exact app-owned file into its operation-bound quarantine path. */
export const moveConfinedRegularFile = (
  input: ConfinedMoveInput,
): Promise<ConfinedRegularFileMoveOutcome> =>
  confinedMove('moveConfinedRegularFile', input);

/** Atomically restore the exact operation-bound quarantine file to its original path. */
export const restoreConfinedRegularFile = (
  input: ConfinedMoveInput,
): Promise<ConfinedRegularFileMoveOutcome> =>
  confinedMove('restoreConfinedRegularFile', input);

/**
 * Upgrade only. The caller must supply exact byte evidence from a decoded durable release journal.
 * Normal delete/move calls cannot request receipt adoption.
 */
export async function adoptLegacyConfinedQuarantineReceipt(
  input: LegacyQuarantineReceiptAuthority,
): Promise<LegacyQuarantineReceiptAdoptionOutcome> {
  if (
    !input.expectedOriginalPath.startsWith('/') ||
    !input.expectedQuarantinePath.startsWith('/') ||
    !input.operationId ||
    !Number.isSafeInteger(input.expectedSize) ||
    input.expectedSize <= 0 ||
    !/^[0-9a-f]{64}$/.test(input.expectedSha256)
  ) {
    return refused(
      'INVALID_ADOPTION_AUTHORITY',
      'Durable quarantine evidence is invalid.',
    );
  }
  const candidate = NativeModules.OffgridConfinedFile as
    | Partial<NativeConfinedFileDeletion>
    | undefined;
  if (typeof candidate?.adoptLegacyConfinedQuarantineReceipt !== 'function') {
    return refused(
      'NATIVE_BOUNDARY_UNAVAILABLE',
      'Native quarantine adoption is unavailable.',
    );
  }
  try {
    const value = await candidate.adoptLegacyConfinedQuarantineReceipt(input);
    const status = (value as { status?: unknown } | null)?.status;
    if (status === 'adopted' || status === 'already_adopted') return { status };
    if (
      status === 'refused' &&
      typeof (value as { code?: unknown }).code === 'string' &&
      typeof (value as { message?: unknown }).message === 'string'
    ) {
      return value as LegacyQuarantineReceiptAdoptionOutcome;
    }
    return refused(
      'INVALID_NATIVE_OUTCOME',
      'Native quarantine adoption returned an invalid outcome.',
    );
  } catch (cause) {
    return refused(
      'NATIVE_ADOPTION_FAILED',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/**
 * Delete only through the native no-follow owner. There is deliberately no RNFS fallback: native
 * absence keeps the durable caller's intent retryable instead of making a lexical safety claim.
 */
export async function deleteConfinedRegularFile(input: {
  readonly root: AppOwnedFileRoot;
  readonly expectedPath: string;
  readonly operationId: string;
}): Promise<ConfinedRegularFileDeleteOutcome> {
  if (!input.expectedPath.startsWith('/') || !input.operationId) {
    return {
      status: 'refused',
      code: 'INVALID_DELETE_IDENTITY',
      message:
        'Confined file deletion requires an absolute path and operation identity.',
    };
  }
  const boundary = nativeBoundary();
  if (!boundary) {
    return {
      status: 'refused',
      code: 'NATIVE_BOUNDARY_UNAVAILABLE',
      message: 'The native confined-file deletion boundary is unavailable.',
    };
  }
  try {
    const value = await boundary.deleteConfinedRegularFile(input);
    if (
      value &&
      typeof value === 'object' &&
      ((value as { status?: unknown }).status === 'deleted' ||
        (value as { status?: unknown }).status === 'already_missing')
    ) {
      return {
        status: (value as { status: 'deleted' | 'already_missing' }).status,
      };
    }
    if (
      value &&
      typeof value === 'object' &&
      (value as { status?: unknown }).status === 'refused' &&
      typeof (value as { code?: unknown }).code === 'string' &&
      typeof (value as { message?: unknown }).message === 'string'
    ) {
      return value as ConfinedRegularFileDeleteOutcome;
    }
    return {
      status: 'refused',
      code: 'INVALID_NATIVE_OUTCOME',
      message: 'The native confined-file boundary returned an invalid outcome.',
    };
  } catch (cause) {
    return {
      status: 'refused',
      code: 'NATIVE_DELETE_FAILED',
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
