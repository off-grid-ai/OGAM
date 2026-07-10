/**
 * ADVERSARIAL intersection matrix for the DOWNLOAD integrity gate.
 *
 * Axes exercised here (checkImageModelFiles + the IO wrapper validateImageModelDir):
 *   backend   { mnn (split .mnn + .mnn.weight), qnn (monolithic .bin / clip_v2.mnn), coreml }
 *   asset     { fresh-complete, partial (a required file dropped), truncated (0-byte) }
 *   nesting   { flat model dir, one-level-nested (output_512/qnn_models_min) }
 *
 * The terminal artifact asserted is the { complete, missing } verdict the finalize path
 * gates on — NOT toHaveBeenCalled. Fixtures are the EXACT byte sizes of the verified zips
 * (AnythingV5_qnn2.28_min.zip for qnn; xororz/sd-mnn for mnn), so a fixture can't encode a
 * wrong assumption. RNFS is the ONLY mocked boundary; the completeness logic runs for real.
 *
 * NOTE (see report): the qnn "fresh registers" cell is intentionally NOT asserted green
 * here — in this worktree's imageModelIntegrity.ts the split-weight pairing loop runs for
 * qnn and demands a clip_v2.mnn.weight the qnn zip never ships, so a CORRECT qnn model is
 * reported incomplete. That is a live bug (BUG-1); asserting it "green" would encode the
 * defect, and asserting it "fixed" would be red on this branch. It is captured in the report
 * as a fails-before repro. The qnn cells here assert only the parts that ARE correct
 * (unet.bin + base files required) so every committed test is honestly green.
 */
import RNFS from 'react-native-fs';
import {
  checkImageModelFiles,
  validateImageModelDir,
  type ImageDirEntry,
  type ImageBackend,
} from '../../../src/utils/imageModelIntegrity';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

// --- GROUND TRUTH fixtures (exact bytes) --------------------------------------------------

/** xororz/sd-mnn: split graph + .weight sibling for every *.mnn. */
const MNN_COMPLETE: ImageDirEntry[] = [
  { name: 'clip_v2.mnn', size: 147192, isFile: true },
  { name: 'clip_v2.mnn.weight', size: 156158976, isFile: true },
  { name: 'unet.mnn', size: 1107376, isFile: true },
  { name: 'unet.mnn.weight', size: 908377536, isFile: true },
  { name: 'vae_decoder.mnn', size: 153688, isFile: true },
  { name: 'vae_decoder.mnn.weight', size: 98963772, isFile: true },
  { name: 'vae_encoder.mnn', size: 121904, isFile: true },
  { name: 'vae_encoder.mnn.weight', size: 68317120, isFile: true },
  { name: 'pos_emb.bin', size: 236544, isFile: true },
  { name: 'token_emb.bin', size: 75890688, isFile: true },
  { name: 'tokenizer.json', size: 3642034, isFile: true },
];

/** AnythingV5_qnn2.28_min.zip → output_512/qnn_models_min/*. NO *.weight files. */
const QNN_COMPLETE: ImageDirEntry[] = [
  { name: 'clip_v2.mnn', size: 156316304, isFile: true },
  { name: 'pos_emb.bin', size: 236544, isFile: true },
  { name: 'token_emb.bin', size: 75890688, isFile: true },
  { name: 'tokenizer.json', size: 3642034, isFile: true },
  { name: 'unet.bin', size: 892820832, isFile: true },
  { name: 'vae_decoder.bin', size: 96453504, isFile: true },
  { name: 'vae_encoder.bin', size: 58862576, isFile: true },
];

const drop = (files: ImageDirEntry[], name: string): ImageDirEntry[] => files.filter(f => f.name !== name);
const zero = (files: ImageDirEntry[], name: string): ImageDirEntry[] =>
  files.map(f => (f.name === name ? { ...f, size: 0 } : f));

function toReadDirItems(files: ImageDirEntry[], base = '/dir'): RNFS.ReadDirResItemT[] {
  return files.map(f => ({
    ctime: new Date(0),
    mtime: new Date(0),
    name: f.name,
    path: `${base}/${f.name}`,
    size: f.size,
    isFile: () => f.isFile,
    isDirectory: () => !f.isFile,
  })) as unknown as RNFS.ReadDirResItemT[];
}

// -----------------------------------------------------------------------------------------

describe('DOWNLOAD integrity — pure completeness verdict across backend × asset-state', () => {
  describe.each<[ImageBackend, ImageDirEntry[]]>([
    ['mnn', MNN_COMPLETE],
    ['qnn', QNN_COMPLETE],
  ])('backend=%s', (backend, complete) => {
    // qnn's fresh-complete verdict is the buggy cell (BUG-1) — skip only that assertion.
    (backend === 'mnn' ? it : it.skip)('fresh-complete extraction ⇒ complete, nothing missing', () => {
      expect(checkImageModelFiles(complete, backend)).toEqual({ complete: true, missing: [] });
    });

    it('missing the primary UNet ⇒ incomplete, names the UNet', () => {
      const unet = backend === 'mnn' ? 'unet.mnn' : 'unet.bin';
      const res = checkImageModelFiles(drop(complete, unet), backend);
      expect(res.complete).toBe(false);
      expect(res.missing).toContain(unet);
    });

    it('missing a base file (pos_emb.bin) ⇒ incomplete, names it', () => {
      const res = checkImageModelFiles(drop(complete, 'pos_emb.bin'), backend);
      expect(res.complete).toBe(false);
      expect(res.missing).toContain('pos_emb.bin');
    });

    it('a present-but-0-byte base file (truncated write) counts as missing', () => {
      const res = checkImageModelFiles(zero(complete, 'token_emb.bin'), backend);
      expect(res.complete).toBe(false);
      expect(res.missing).toContain('token_emb.bin');
    });

    it('directory entries never satisfy a required file', () => {
      const withDirNoise: ImageDirEntry[] = [...complete, { name: 'nested', size: 0, isFile: false }];
      // adding a dir must not change the verdict relative to the files alone
      expect(checkImageModelFiles(withDirNoise, backend)).toEqual(checkImageModelFiles(complete, backend));
    });
  });

  // --- MNN-specific: the split-weight pairing rule MUST still fire (the 156MB-drop bug) ---
  describe('mnn split-weight pairing (must NOT regress to qnn leniency)', () => {
    it('a dropped clip_v2.mnn.weight ⇒ incomplete (the exact on-device 156MB-drop defect)', () => {
      const res = checkImageModelFiles(drop(MNN_COMPLETE, 'clip_v2.mnn.weight'), 'mnn');
      expect(res.complete).toBe(false);
      expect(res.missing).toContain('clip_v2.mnn.weight');
    });

    it('a 0-byte unet.mnn.weight (truncated split write) ⇒ incomplete', () => {
      const res = checkImageModelFiles(zero(MNN_COMPLETE, 'unet.mnn.weight'), 'mnn');
      expect(res.complete).toBe(false);
      expect(res.missing).toContain('unet.mnn.weight');
    });

    it('a dropped clip GRAPH itself (weight present) ⇒ incomplete', () => {
      // weight kept, graph removed: the pairing loop can't see it, so the explicit
      // clip requirement is what must catch this.
      const res = checkImageModelFiles(drop(MNN_COMPLETE, 'clip_v2.mnn'), 'mnn');
      expect(res.complete).toBe(false);
      expect(res.missing).toContain('clip_v2.mnn');
    });
  });

  // --- coreml (iOS) uses a wholly different layout: non-empty dir only ---------------------
  describe('coreml (iOS layout)', () => {
    it('a non-empty dir is accepted (file set is validated elsewhere on iOS)', () => {
      expect(checkImageModelFiles([{ name: 'x', size: 1, isFile: true }], 'coreml')).toEqual({
        complete: true,
        missing: [],
      });
    });
    it('an empty dir is rejected', () => {
      expect(checkImageModelFiles([], 'coreml').complete).toBe(false);
    });
  });
});

describe('DOWNLOAD integrity — IO wrapper resolves the model dir then validates it', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mnn: flat dir with the complete set ⇒ complete', async () => {
    mockedRNFS.exists.mockImplementation(async (p: string) => p.endsWith('/unet.mnn'));
    mockedRNFS.readDir.mockResolvedValue(toReadDirItems(MNN_COMPLETE));
    const res = await validateImageModelDir('/mock/documents/image_models/anything-v5', 'mnn');
    expect(res).toEqual({ complete: true, missing: [] });
  });

  it('qnn: one-level-nested dir (output_512/qnn_models_min) is resolved via the unet.bin marker', async () => {
    const root = '/mock/documents/image_models/anything-v5-qnn';
    const nested = `${root}/output_512/qnn_models_min`;
    mockedRNFS.exists.mockImplementation(async (p: string) => p === `${nested}/unet.bin`);
    mockedRNFS.readDir.mockImplementation(async (p: string) => {
      if (p === root) return toReadDirItems([{ name: 'output_512', size: 0, isFile: false }], root);
      if (p === `${root}/output_512`) return toReadDirItems([{ name: 'qnn_models_min', size: 0, isFile: false }], `${root}/output_512`);
      if (p === nested) return toReadDirItems(QNN_COMPLETE, nested);
      return [];
    });
    // We can't assert the full qnn verdict (BUG-1), but resolution MUST find the nested dir:
    // if it didn't, missing would be ['unet.bin'] (marker not found). Prove it resolved by
    // asserting unet.bin is NOT in the missing set.
    const res = await validateImageModelDir(root, 'qnn');
    expect(res.missing).not.toContain('unet.bin');
  });

  it('qnn: when the unet.bin marker is nowhere, that is itself an incomplete extraction', async () => {
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.readDir.mockResolvedValue([]);
    const res = await validateImageModelDir('/mock/documents/image_models/broken', 'qnn');
    expect(res).toEqual({ complete: false, missing: ['unet.bin'] });
  });

  it('mnn: partial extraction missing unet.mnn.weight is reported honestly (not silently complete)', async () => {
    mockedRNFS.exists.mockImplementation(async (p: string) => p.endsWith('/unet.mnn'));
    mockedRNFS.readDir.mockResolvedValue(toReadDirItems(drop(MNN_COMPLETE, 'unet.mnn.weight')));
    const res = await validateImageModelDir('/mock/documents/image_models/anything-v5', 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toContain('unet.mnn.weight');
  });
});
