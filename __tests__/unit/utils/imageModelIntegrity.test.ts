/**
 * Image-model extraction integrity — the pure completeness check that stops a partial
 * unzip from being marked `_ready` (and later crashing the native server behind a
 * misleading "your device may not support this backend" error).
 *
 * Reproduces the EXACT on-device defect: the mnn model extracted missing `pos_emb.bin`
 * AND `clip_v2.mnn.weight` while every other file was present, yet nothing flagged it.
 */
import { checkImageModelFiles, type ImageDirEntry } from '../../../src/utils/imageModelIntegrity';

// The complete, correct mnn model file set (from the verified xororz/sd-mnn zip).
const COMPLETE_MNN: ImageDirEntry[] = [
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

describe('checkImageModelFiles — mnn', () => {
  it('passes a complete extraction', () => {
    expect(checkImageModelFiles(COMPLETE_MNN, 'mnn')).toEqual({ complete: true, missing: [] });
  });

  it('FAILS the exact on-device bug: pos_emb.bin + clip_v2.mnn.weight dropped', () => {
    const partial = COMPLETE_MNN.filter(f => f.name !== 'pos_emb.bin' && f.name !== 'clip_v2.mnn.weight');
    const res = checkImageModelFiles(partial, 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toContain('pos_emb.bin');
    expect(res.missing).toContain('clip_v2.mnn.weight');
  });

  it('catches a dropped *.mnn.weight via the split-weight pairing rule', () => {
    const partial = COMPLETE_MNN.filter(f => f.name !== 'unet.mnn.weight');
    expect(checkImageModelFiles(partial, 'mnn').missing).toContain('unet.mnn.weight');
  });

  it('treats a zero-byte file as missing (truncated write)', () => {
    const truncated = COMPLETE_MNN.map(f => (f.name === 'pos_emb.bin' ? { ...f, size: 0 } : f));
    const res = checkImageModelFiles(truncated, 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toContain('pos_emb.bin');
  });

  it('requires the primary unet.mnn', () => {
    const partial = COMPLETE_MNN.filter(f => f.name !== 'unet.mnn');
    expect(checkImageModelFiles(partial, 'mnn').missing).toContain('unet.mnn');
  });

  it('requires the clip GRAPH itself, not just its weight (dropped clip_v2.mnn slips the pairing loop otherwise)', () => {
    const partial = COMPLETE_MNN.filter(f => f.name !== 'clip_v2.mnn'); // weight still present
    const res = checkImageModelFiles(partial, 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toContain('clip_v2.mnn');
  });

  it('accepts clip.mnn as the clip graph when clip_v2.mnn is absent (base vs upgraded)', () => {
    const withBaseClip = COMPLETE_MNN
      .filter(f => f.name !== 'clip_v2.mnn' && f.name !== 'clip_v2.mnn.weight')
      .concat([{ name: 'clip.mnn', size: 147192, isFile: true }, { name: 'clip.mnn.weight', size: 156158976, isFile: true }]);
    expect(checkImageModelFiles(withBaseClip, 'mnn').complete).toBe(true);
  });

  it('requires the vae_decoder.mnn graph (always loaded by the native server)', () => {
    const partial = COMPLETE_MNN.filter(f => f.name !== 'vae_decoder.mnn');
    expect(checkImageModelFiles(partial, 'mnn').missing).toContain('vae_decoder.mnn');
  });

  it('does NOT require vae_encoder.mnn (optional — native adds --vae_encoder only if present)', () => {
    const noEncoder = COMPLETE_MNN.filter(f => f.name !== 'vae_encoder.mnn' && f.name !== 'vae_encoder.mnn.weight');
    expect(checkImageModelFiles(noEncoder, 'mnn').complete).toBe(true);
  });

  it('ignores directory entries (only files count)', () => {
    const withDir = [...COMPLETE_MNN, { name: 'nested', size: 0, isFile: false }];
    expect(checkImageModelFiles(withDir, 'mnn').complete).toBe(true);
  });
});

describe('checkImageModelFiles — qnn (NPU)', () => {
  // The REAL, COMPLETE qnn file set — the exact bytes of the verified xororz/sd-qnn zip
  // (AnythingV5_qnn2.28_min.zip) AND of the working absolutereality_npu_min model on-device.
  // Note there is NO `clip_v2.mnn.weight`: qnn ships clip_v2.mnn as a MONOLITHIC graph.
  const COMPLETE_QNN: ImageDirEntry[] = [
    { name: 'clip_v2.mnn', size: 156316304, isFile: true },
    { name: 'pos_emb.bin', size: 236544, isFile: true },
    { name: 'token_emb.bin', size: 75890688, isFile: true },
    { name: 'tokenizer.json', size: 3642034, isFile: true },
    { name: 'unet.bin', size: 892820832, isFile: true },
    { name: 'vae_decoder.bin', size: 96453504, isFile: true },
    { name: 'vae_encoder.bin', size: 58862576, isFile: true },
  ];

  // B8 regression (fails-before / passes-after): before the fix, the shared split-weight
  // pairing loop ran for qnn and demanded a clip_v2.mnn.weight that the qnn zip NEVER ships,
  // so this exact (correct, fully-extracted) model was reported incomplete=[clip_v2.mnn.weight]
  // and every fresh Android NPU image download failed with a bogus "download corrupted /
  // connection dropped" alert. The download and extraction were always perfect.
  it('passes the exact on-device NPU model that has clip_v2.mnn but NO clip_v2.mnn.weight', () => {
    expect(checkImageModelFiles(COMPLETE_QNN, 'qnn')).toEqual({ complete: true, missing: [] });
  });

  it('does NOT demand any *.mnn.weight for qnn (monolithic graph, weights baked in)', () => {
    expect(checkImageModelFiles(COMPLETE_QNN, 'qnn').missing).not.toContain('clip_v2.mnn.weight');
  });

  it('requires unet.bin (not unet.mnn) for qnn', () => {
    const partial = COMPLETE_QNN.filter(f => f.name !== 'unet.bin');
    expect(checkImageModelFiles(partial, 'qnn').missing).toContain('unet.bin');
  });

  it('requires vae_decoder.bin (always loaded by the native qnn server)', () => {
    const partial = COMPLETE_QNN.filter(f => f.name !== 'vae_decoder.bin');
    expect(checkImageModelFiles(partial, 'qnn').missing).toContain('vae_decoder.bin');
  });

  it('requires the clip graph (a dropped clip_v2.mnn is a real incomplete extraction)', () => {
    const partial = COMPLETE_QNN.filter(f => f.name !== 'clip_v2.mnn');
    expect(checkImageModelFiles(partial, 'qnn').missing).toContain('clip_v2.mnn');
  });

  it('accepts a self-contained clip.bin as the clip graph (native qnn fallback)', () => {
    const withBinClip = COMPLETE_QNN
      .filter(f => f.name !== 'clip_v2.mnn')
      .concat([{ name: 'clip.bin', size: 160000000, isFile: true }]);
    expect(checkImageModelFiles(withBinClip, 'qnn').complete).toBe(true);
  });

  it('does NOT require vae_encoder.bin (optional — native adds --vae_encoder only if present)', () => {
    const noEncoder = COMPLETE_QNN.filter(f => f.name !== 'vae_encoder.bin');
    expect(checkImageModelFiles(noEncoder, 'qnn').complete).toBe(true);
  });

  it('treats a zero-byte unet.bin as missing (truncated write)', () => {
    const truncated = COMPLETE_QNN.map(f => (f.name === 'unet.bin' ? { ...f, size: 0 } : f));
    expect(checkImageModelFiles(truncated, 'qnn').missing).toContain('unet.bin');
  });
});

describe('checkImageModelFiles — coreml (iOS, different layout)', () => {
  it('only requires a non-empty dir (not the mnn/qnn file set)', () => {
    expect(checkImageModelFiles([{ name: 'x', size: 1, isFile: true }], 'coreml').complete).toBe(true);
    expect(checkImageModelFiles([], 'coreml').complete).toBe(false);
  });
});
