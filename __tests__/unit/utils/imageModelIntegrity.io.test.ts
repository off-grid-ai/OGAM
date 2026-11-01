/**
 * imageModelIntegrity IO wrappers — resolveImageModelDir / validateImageModelDir /
 * ensureImageExtractionComplete. The pure rule is covered in imageModelIntegrity.test;
 * this runs the real wrappers over the in-memory file system and the fake unzip (both device
 * boundaries), covering dir resolution, the coreml short-circuit, unreadable dirs, and the
 * re-unzip-once-then-throw gate. Nothing of ours is mocked.
 */
import { installNativeBoundary, type NativeBoundary } from '../../harness/nativeBoundary';
import { installImageDownloadDevice, type ImageDownloadDevice, type ZipEntries } from '../../harness/imageDownloadDevice';
import { SD_MNN_PACKAGE_FILES } from '../../harness/imageModelPackage';

type Integrity = typeof import('../../../src/services/imageModelIntegrity');

const COMPLETE_MNN: ZipEntries = Object.fromEntries(SD_MNN_PACKAGE_FILES.map(name => [name, 1]));
const without = (...names: string[]): ZipEntries =>
  Object.fromEntries(Object.entries(COMPLETE_MNN).filter(([name]) => !names.includes(name)));

let boundary: NativeBoundary;
let device: ImageDownloadDevice;
let integrity: Integrity;
let ImageModelIncompleteError: typeof import('../../../src/services/modelLoadErrors').ImageModelIncompleteError;

/** Put the files of `entries` into `dir` on the fake disk. */
function seedModelDir(dir: string, entries: ZipEntries) {
  for (const [name, size] of Object.entries(entries)) boundary.fs!.seedFile(`${dir}/${name}`, size);
}

/** How many extractions the native unzip module was asked for. */
const unzipCalls = () => (require('react-native-zip-archive').unzip as jest.Mock).mock.calls.length;

/** A directory the OS refuses to list (permission denied / storage gone). */
function makeUnreadable(dir: string) {
  const readDir = boundary.fs!.module.readDir;
  const real = readDir.getMockImplementation()!;
  readDir.mockImplementation(async (path: string) => {
    if (path === dir) throw new Error(`EACCES ${path}`);
    return real(path);
  });
}

beforeEach(() => {
  boundary = installNativeBoundary({ fs: true, download: true });
  device = installImageDownloadDevice(boundary);
  integrity = require('../../../src/services/imageModelIntegrity');
  ImageModelIncompleteError = require('../../../src/services/modelLoadErrors').ImageModelIncompleteError;
});

describe('resolveImageModelDir', () => {
  it('returns modelPath itself when the unet marker is directly inside', async () => {
    boundary.fs!.seedFile('/m/unet.mnn', 1);
    expect(await integrity.resolveImageModelDir('/m', 'mnn')).toBe('/m');
  });

  it('finds the marker one subdir down (e.g. AbsoluteReality/)', async () => {
    boundary.fs!.seedFile('/m/AbsoluteReality/unet.mnn', 1);
    expect(await integrity.resolveImageModelDir('/m', 'mnn')).toBe('/m/AbsoluteReality');
  });

  it('finds the marker two subdirs down (qnn output_512/qnn_models_min)', async () => {
    boundary.fs!.seedFile('/m/output_512/qnn_models_min/unet.bin', 1);
    expect(await integrity.resolveImageModelDir('/m', 'qnn')).toBe('/m/output_512/qnn_models_min');
  });

  it('returns null when no marker is found and skips unreadable subdirs', async () => {
    boundary.fs!.seedDir('/m/locked');
    makeUnreadable('/m/locked');
    expect(await integrity.resolveImageModelDir('/m', 'mnn')).toBeNull();
  });

  it('skips top-level files and non-marker sub-files while descending two levels', async () => {
    boundary.fs!.seedTextFile('/m/readme.txt', 'hello');
    boundary.fs!.seedFile('/m/sub/a-note.bin', 5); // listed before deep/
    boundary.fs!.seedFile('/m/sub/deep/unet.mnn', 1);
    expect(await integrity.resolveImageModelDir('/m', 'mnn')).toBe('/m/sub/deep');
  });

  it('returns null when modelPath itself does not exist', async () => {
    expect(await integrity.resolveImageModelDir('/nope', 'mnn')).toBeNull();
  });

  it('treats an exists() I/O failure as no-marker', async () => {
    // The storage layer errors on the top-level marker probe; /m itself is absent.
    boundary.fs!.module.exists.mockRejectedValueOnce(new Error('io error'));
    expect(await integrity.resolveImageModelDir('/m', 'mnn')).toBeNull();
  });
});

describe('validateImageModelDir', () => {
  it('coreml short-circuits to complete', async () => {
    expect(await integrity.validateImageModelDir('/m', 'coreml')).toEqual({ complete: true, missing: [] });
  });

  it('reports the unet as missing when no model dir resolves', async () => {
    const res = await integrity.validateImageModelDir('/m', 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toContain('unet.mnn');
  });

  it('names unet.bin (not unet.mnn) when a qnn model dir does not resolve', async () => {
    const res = await integrity.validateImageModelDir('/m', 'qnn');
    expect(res.missing).toContain('unet.bin');
  });

  it('counts a zero-byte file as missing', async () => {
    seedModelDir('/m', { ...COMPLETE_MNN, 'token_emb.bin': 0 });
    const res = await integrity.validateImageModelDir('/m', 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toEqual(['token_emb.bin']);
  });

  it('counts a file whose reported size is not a number as missing', async () => {
    seedModelDir('/m', COMPLETE_MNN);
    boundary.fs!.setReportedFileSize('/m/pos_emb.bin', 'unknown');
    const res = await integrity.validateImageModelDir('/m', 'mnn');
    expect(res.missing).toEqual(['pos_emb.bin']);
  });

  it('passes a complete extraction', async () => {
    seedModelDir('/m', COMPLETE_MNN);
    expect(await integrity.validateImageModelDir('/m', 'mnn')).toEqual({ complete: true, missing: [] });
  });

  it('flags the missing files of a partial extraction', async () => {
    seedModelDir('/m', without('pos_emb.bin', 'clip_v2.mnn.weight'));
    const res = await integrity.validateImageModelDir('/m', 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toEqual(expect.arrayContaining(['pos_emb.bin', 'clip_v2.mnn.weight']));
  });

  it('reports unreadable when the resolved dir cannot be listed', async () => {
    seedModelDir('/m', COMPLETE_MNN);
    makeUnreadable('/m');
    const res = await integrity.validateImageModelDir('/m', 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toContain('<unreadable model dir>');
  });
});

describe('ensureImageExtractionComplete', () => {
  const opts = (backend?: string) => ({ backend: backend as any, modelDir: '/m', zipPath: '/m.zip', modelId: 'id' });

  it('is a no-op for coreml / unknown backends (the zip is never opened)', async () => {
    // A corrupt zip on disk: any unzip would throw.
    boundary.fs!.seedTextFile('/m.zip', 'NOT A ZIP');
    await expect(integrity.ensureImageExtractionComplete(opts('coreml'))).resolves.toBeUndefined();
    await expect(integrity.ensureImageExtractionComplete(opts(undefined))).resolves.toBeUndefined();
    expect(boundary.fs!.listFiles('/m')).toEqual([]);
  });

  it('passes without re-unzip when already complete', async () => {
    seedModelDir('/m', COMPLETE_MNN);
    boundary.fs!.seedTextFile('/m.zip', 'NOT A ZIP'); // a re-unzip would throw
    await expect(integrity.ensureImageExtractionComplete(opts('mnn'))).resolves.toBeUndefined();
  });

  it('re-unzips ONCE and passes when the retry completes the model', async () => {
    seedModelDir('/m', without('pos_emb.bin')); // the first extraction was cut short
    device.seedZip('/m.zip', COMPLETE_MNN);
    await expect(integrity.ensureImageExtractionComplete(opts('mnn'))).resolves.toBeUndefined();
    expect(await boundary.fs!.exists('/m/pos_emb.bin')).toBe(true);
    expect((await integrity.validateImageModelDir('/m', 'mnn')).complete).toBe(true);
    expect(unzipCalls()).toBe(1);
  });

  it('throws ImageModelIncompleteError naming the file when still incomplete after the re-unzip', async () => {
    seedModelDir('/m', without('pos_emb.bin'));
    device.seedZip('/m.zip', without('pos_emb.bin')); // the archive itself lacks the file
    const error = await integrity.ensureImageExtractionComplete(opts('mnn')).catch(e => e);
    expect(error).toBeInstanceOf(ImageModelIncompleteError);
    expect(String(error.message)).toContain('pos_emb.bin');
    expect(unzipCalls()).toBe(1); // re-extracted once, then gave up
  });
});
