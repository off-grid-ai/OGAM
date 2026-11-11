/**
 * Published sizes and SHA-256 checksums of model files people have asked about, so "Test GPU on this model" can say whether
 * the copy on the phone is the real file. Add a row to cover another file; an unknown file is simply reported with its checksum.
 */
export interface KnownFile { name: string; bytes: number; sha256: string }

export const KNOWN_MODEL_FILES: KnownFile[] = [
  { name: 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf', bytes: 7381381760, sha256: '59656d7494d6376ca97e9e20b64ea2e16cd97f12ec6d47bfccba91cb785b5134' },
  { name: 'mmproj-Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-BF16.gguf', bytes: 175115264, sha256: 'b59e815479b7e5f0665bd29e6784c104a368092bcbc63120148c606f9276ab8e' },
  { name: 'mtp-gemma-4-12B-it.gguf', bytes: 253707328, sha256: 'c50c91c35f04903815b2e8930cbb8c8c5bee0e1aa00748c30a7b8ff05d2310b4' },
];

export type FileVerdict =
  | { kind: 'match'; name: string; bytes: number }
  | { kind: 'damaged'; name: string; bytes: number; sha256: string; expected: string }
  | { kind: 'wrong-size'; name: string; bytes: number; expectedBytes: number }
  | { kind: 'unknown'; bytes: number; sha256: string };

/** Judges a file by its size and checksum. The size alone identifies which published file it claims to be (names get changed). */
export function judgeFile(bytes: number, sha256: string | null): FileVerdict {
  const bySize = KNOWN_MODEL_FILES.find((f) => f.bytes === bytes);
  if (bySize) {
    if (sha256 == null) return { kind: 'match', name: bySize.name, bytes };
    return sha256.toLowerCase() === bySize.sha256
      ? { kind: 'match', name: bySize.name, bytes }
      : { kind: 'damaged', name: bySize.name, bytes, sha256, expected: bySize.sha256 };
  }
  return { kind: 'unknown', bytes, sha256: sha256 ?? 'not computed' };
}

export function describeFileVerdict(v: FileVerdict): string {
  switch (v.kind) {
    case 'match': return `OK: ${v.bytes.toLocaleString('en-US')} bytes, identical to the published ${v.name}`;
    case 'damaged': return `DAMAGED: same size as the published ${v.name} (${v.bytes.toLocaleString('en-US')} bytes) but a different checksum (${v.sha256}, published ${v.expected}). Some of its bytes are wrong: delete it and copy or download it again`;
    case 'wrong-size': return `WRONG SIZE: ${v.bytes.toLocaleString('en-US')} bytes, ${v.name} should be ${v.expectedBytes.toLocaleString('en-US')}`;
    default: return `not in the list of known files (${v.bytes.toLocaleString('en-US')} bytes, SHA-256 ${v.sha256}); compare it with the checksum on the download page`;
  }
}
