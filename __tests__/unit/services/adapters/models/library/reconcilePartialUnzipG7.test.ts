/**
 * B15 / G7 — reconcileFinishedImageDownloads must NOT register a partially-extracted image model.
 *
 * The recovery path re-unzips a `_zip_name` remnant (a mid-unzip kill) and used to register the
 * model on isValidZip alone (size>0 + PK header) — skipping the completeness gate the live/resume
 * paths run. A truncated-but-PK zip yields a PARTIAL mnn tree (missing base files / weight pairs),
 * registered as usable → native crash at generation. The fix runs ensureImageExtractionComplete
 * after the recovery unzip; a still-incomplete extraction is cleaned up and NEVER marked _ready.
 *
 * This drives the REAL reconcile + the REAL completeness gate (ensureImageExtractionComplete /
 * validateImageModelDir are NOT mocked). Only the third-party boundary — react-native-fs and the
 * native unzip — is faked, via a path-addressed in-memory FS (order-independent, not brittle
 * sequential mocks). addImageModel is the injected sink, so we assert the real outcome: a partial
 * model is neither registered nor left on disk; a complete one is.
 */
jest.mock('react-native-fs', () => {
  const files = new Map<string, { isFile: boolean; size: number }>();
  const norm = (p: string) => p.replace(/\/+$/, '');
  return {
    __files: files,
    exists: jest.fn(async (p: string) => files.has(norm(p))),
    stat: jest.fn(async (p: string) => {
      const f = files.get(norm(p));
      if (!f) throw new Error('ENOENT');
      return { size: f.size, isFile: () => f.isFile, isDirectory: () => !f.isFile };
    }),
    read: jest.fn(async (p: string) => (norm(p).endsWith('.zip') ? 'PK' : '')),
    readFile: jest.fn(async (p: string) => {
      const f = files.get(norm(p));
      return f && (f as any).content !== undefined ? (f as any).content : '';
    }),
    readDir: jest.fn(async (p: string) => {
      const base = norm(p);
      const seen = new Set<string>();
      const out: any[] = [];
      for (const path of files.keys()) {
        if (path === base || !path.startsWith(`${base}/`)) continue;
        const rest = path.slice(base.length + 1);
        const first = rest.split('/')[0];
        const childPath = `${base}/${first}`;
        if (seen.has(childPath)) continue;
        seen.add(childPath);
        const childMeta = files.get(childPath);
        const isFile = rest.includes('/') ? false : (childMeta?.isFile ?? true);
        out.push({
          name: first,
          path: childPath,
          size: childMeta?.size ?? 0,
          isFile: () => isFile,
          isDirectory: () => !isFile,
        });
      }
      return out;
    }),
    writeFile: jest.fn(async (p: string, content = '') => { files.set(norm(p), { isFile: true, size: content.length || 1, ...(content ? { content } : {}) } as any); }),
    unlink: jest.fn(async (p: string) => {
      const base = norm(p);
      for (const key of [...files.keys()]) if (key === base || key.startsWith(`${base}/`)) files.delete(key);
    }),
  };
});
jest.mock('react-native-zip-archive', () => ({ unzip: jest.fn(async () => '') }));
jest.mock('../../../../../../src/services/adapters/models/library/modelRegistryStorageAdapter', () => ({
  buildDownloadedModel: jest.fn(), persistDownloadedModel: jest.fn(),
  loadDownloadedModels: jest.fn(async () => []), saveModelsList: jest.fn(),
}));
jest.mock('../../../../../../src/utils/coreMLModelUtils', () => ({ resolveCoreMLModelDir: jest.fn(async (d: string) => d) }));

import RNFS from 'react-native-fs';
import { reconcileFinishedImageDownloads } from '../../../../../../src/services/adapters/models/library/modelScanAdapter';

const files: Map<string, { isFile: boolean; size: number; content?: string }> = (RNFS as any).__files;
const IMG = '/img';
const ID = 'Sd_Test_Mnn'; // detectBackend → 'mnn'
const DIR = `${IMG}/${ID}`;
const ZIP = `${IMG}/archive.zip`;

const seed = (p: string, size = 1024, content?: string) =>
  files.set(p, { isFile: true, size, ...(content !== undefined ? { content } : {}) });

const COMPLETE_MNN = [
  'pos_emb.bin', 'token_emb.bin', 'tokenizer.json',
  'unet.mnn', 'unet.mnn.weight',
  'vae_decoder.mnn', 'vae_decoder.mnn.weight',
  'clip_v2.mnn', 'clip_v2.mnn.weight',
];

function stageCommon() {
  files.clear();
  files.set(IMG, { isFile: false, size: 0 });
  files.set(DIR, { isFile: false, size: 0 });
  seed(`${DIR}/_zip_name`, 12, 'archive.zip'); // remnant of a mid-unzip kill (no _ready)
  seed(ZIP, 24 * 1024 * 1024);                 // valid PK zip, non-zero
}

const opts = () => ({
  imageModelsDir: IMG,
  getImageModels: jest.fn(async (): Promise<any[]> => []),
  addImageModel: jest.fn(async () => {}),
  activeModelIds: new Set<string>(),
});

describe('reconcileFinishedImageDownloads — partial re-unzip completeness gate (B15/G7)', () => {
  it('does NOT register a partially-extracted mnn model, and cleans the dir up', async () => {
    stageCommon();
    // Partial extraction: only the unet graph landed — base files, weight pairs, clip, vae missing.
    seed(`${DIR}/unet.mnn`, 4096);
    const o = opts();

    const out = await reconcileFinishedImageDownloads(o);

    expect(o.addImageModel).not.toHaveBeenCalled();          // never published
    expect(out).toEqual([]);
    expect(files.has(`${DIR}/_ready`)).toBe(false);           // never marked ready
    expect(files.has(DIR)).toBe(false);                        // unusable dir removed → re-downloadable
    expect(files.has(ZIP)).toBe(false);                        // and the bad zip cleaned up
  });

  it('DOES register a fully-extracted mnn model (gate passes — no over-block)', async () => {
    stageCommon();
    COMPLETE_MNN.forEach(f => seed(`${DIR}/${f}`, 4096));
    const o = opts();

    const out = await reconcileFinishedImageDownloads(o);

    expect(o.addImageModel).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(ID);
    expect(out[0].backend).toBe('mnn');
    expect(files.has(`${DIR}/_ready`)).toBe(true);             // marked ready
    expect(files.has(DIR)).toBe(true);                          // kept
  });
});
