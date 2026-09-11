import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  sharedFileQuarantinePath,
  observeConditionalReleaseBytes,
  validateConditionalReleaseBytes,
  type ConditionalReleaseByteIO,
} from '../../../pro/sync/conditionalSharedFileReleaseBytes';

const nodeIO: ConditionalReleaseByteIO = {
  exists: async path => {
    try { statSync(path); return true; } catch { return false; }
  },
  size: async path => statSync(path).size,
  sha256: async path => createHash('sha256').update(readFileSync(path)).digest('hex'),
};

it('accepts exact reopened bytes and rejects changed quarantine bytes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'offgrid-release-bytes-'));
  const original = join(directory, 'image.png');
  const quarantine = sharedFileQuarantinePath(original, 'shared-delete-op');
  try {
    writeFileSync(quarantine, Buffer.from('kept bytes'));
    expect(quarantine).toContain('.offgrid-delete-shared-delete-op');
    const byteEvidence = await observeConditionalReleaseBytes(quarantine, nodeIO);
    await expect(validateConditionalReleaseBytes({byteEvidence}, quarantine, nodeIO))
      .resolves.toBeUndefined();

    writeFileSync(quarantine, Buffer.from('replacement bytes'));
    await expect(validateConditionalReleaseBytes({byteEvidence}, quarantine, nodeIO))
      .rejects.toThrow('byte evidence mismatch');
    expect(readFileSync(quarantine, 'utf8')).toBe('replacement bytes');
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
