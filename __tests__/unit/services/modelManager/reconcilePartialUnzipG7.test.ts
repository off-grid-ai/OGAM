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
 * validateImageModelDir), the real registry storage and Core ML resolver. Only the device is faked:
 * the disk (react-native-fs in memory) and the native unzip, which extracts the entries a fake zip on
 * that disk holds (harness/modelManagerDevice + harness/imageDownloadDevice). A truncated zip is one
 * that holds only part of the package.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';
import { installImageDownloadDevice, type ImageDownloadDevice } from '../../../harness/imageDownloadDevice';
import { SD_MNN_PACKAGE_FILES } from '../../../harness/imageModelPackage';
import type { ONNXImageModel } from '../../../../src/types';

type ScanModule = typeof import('../../../../src/services/modelManager/scan');

const ID = 'Sd_Test_Mnn'; // detectBackend -> 'mnn'

describe('reconcileFinishedImageDownloads — partial re-unzip completeness gate (B15/G7)', () => {
  let device: ModelManagerDevice;
  let images: ImageDownloadDevice;
  let scan: ScanModule;
  let dir: string;
  let zip: string;

  beforeEach(async () => {
    device = await installModelManagerDevice({ platform: 'android' });
    images = installImageDownloadDevice(device.boundary);
    scan = require('../../../../src/services/modelManager/scan');
    dir = `${device.imageModelsDir}/${ID}`;
    zip = `${device.imageModelsDir}/archive.zip`;
    // The remnant of a mid-unzip kill: the zip's name, and no _ready.
    device.fs.seedTextFile(`${dir}/_zip_name`, 'archive.zip');
  });

  async function reconcile() {
    const registered: ONNXImageModel[] = [];
    const out = await scan.reconcileFinishedImageDownloads({
      imageModelsDir: device.imageModelsDir,
      getImageModels: async () => registered,
      addImageModel: async model => { registered.push(model); },
      activeModelIds: new Set(),
    });
    return { out, registered };
  }

  it('does NOT register a partially-extracted mnn model, and cleans the dir up', async () => {
    // A truncated zip: only the unet graph is in it. Base files, weight pairs, clip and vae are missing.
    images.seedZip(zip, { 'unet.mnn': 4096 }, 24 * 1024 * 1024);
    expect(await device.fs.exists(dir)).toBe(true);

    const { out, registered } = await reconcile();

    expect(registered).toEqual([]);                                   // never published
    expect(out).toEqual([]);
    expect(await device.fs.exists(`${dir}/_ready`)).toBe(false);     // never marked ready
    expect(await device.fs.exists(dir)).toBe(false);                 // unusable dir removed -> re-downloadable
    expect(await device.fs.exists(zip)).toBe(false);                 // and the bad zip cleaned up
  });

  it('DOES register a fully-extracted mnn model (gate passes — no over-block)', async () => {
    images.seedZip(zip, Object.fromEntries(SD_MNN_PACKAGE_FILES.map(name => [name, 4096])), 24 * 1024 * 1024);

    const { out, registered } = await reconcile();

    expect(registered.map(m => [m.id, m.backend])).toEqual([[ID, 'mnn']]);
    expect(out).toHaveLength(1);
    expect(await device.fs.exists(`${dir}/_ready`)).toBe(true);      // marked ready
    expect(await device.fs.exists(`${dir}/unet.mnn.weight`)).toBe(true); // kept
    expect(await device.fs.exists(zip)).toBe(false);
  });
});
