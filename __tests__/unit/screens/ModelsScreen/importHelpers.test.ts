/**
 * Unit tests for importHelpers.ts
 *
 * Tests pure helpers (isMmProj, classifyGgufPair, getErrorMessage) directly, and importGgufFiles
 * on the real modelManager import over harness/modelManagerDevice: the picked files sit on the
 * in-memory disk, the import copies them into the models folder and writes the registry. The OS
 * dialog (Alert.alert) is the other device piece: the test answers it.
 */

import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';
import {
  isMmProj,
  classifyGgufPair,
  getErrorMessage,
  GgufFileRef,
} from '../../../../src/screens/ModelsScreen/importHelpers';
import type { AlertState } from '../../../../src/components/CustomAlert';
import type { DownloadedModel } from '../../../../src/types';

type ImportHelpers = typeof import('../../../../src/screens/ModelsScreen/importHelpers');

// ── Helpers ─────────────────────────────────────────────────────────────────

const makeFile = (name: string, size: number, uri = `file://${name}`): GgufFileRef => ({ uri, name, size });

// ── isMmProj ────────────────────────────────────────────────────────────────

describe('isMmProj', () => {
  it('returns true for filename containing "mmproj"', () => {
    expect(isMmProj('llava-mmproj-f16.gguf')).toBe(true);
  });

  it('returns true for filename containing "projector"', () => {
    expect(isMmProj('vision_projector.gguf')).toBe(true);
  });

  it('returns true for filename containing "clip" ending in .gguf', () => {
    expect(isMmProj('clip-vit-large.gguf')).toBe(true);
  });

  it('returns false for "clip" in a non-.gguf file', () => {
    expect(isMmProj('clip-model.bin')).toBe(false);
  });

  it('returns false for a normal main model filename', () => {
    expect(isMmProj('llava-v1.5-7b-Q4_K_M.gguf')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isMmProj('MMPROJ-F16.GGUF')).toBe(true);
    expect(isMmProj('Vision_Projector.GGUF')).toBe(true);
  });
});

// ── classifyGgufPair ────────────────────────────────────────────────────────

describe('classifyGgufPair', () => {
  it('identifies mmproj by filename in file1 position', () => {
    const mmproj = makeFile('llava-mmproj-f16.gguf', 100);
    const main = makeFile('llava-7b-Q4_K_M.gguf', 4000);
    const { mainFile, mmProjFile } = classifyGgufPair(mmproj, main);
    expect(mainFile.name).toBe('llava-7b-Q4_K_M.gguf');
    expect(mmProjFile.name).toBe('llava-mmproj-f16.gguf');
  });

  it('identifies mmproj by filename in file2 position', () => {
    const main = makeFile('llava-7b-Q4_K_M.gguf', 4000);
    const mmproj = makeFile('llava-mmproj-f16.gguf', 100);
    const { mainFile, mmProjFile } = classifyGgufPair(main, mmproj);
    expect(mainFile.name).toBe('llava-7b-Q4_K_M.gguf');
    expect(mmProjFile.name).toBe('llava-mmproj-f16.gguf');
  });

  it('falls back to size comparison when neither name signals mmproj', () => {
    const big = makeFile('model-Q4.gguf', 5000);
    const small = makeFile('model-clip.bin', 200);
    const { mainFile, mmProjFile } = classifyGgufPair(big, small);
    expect(mainFile.name).toBe('model-Q4.gguf');
    expect(mmProjFile.name).toBe('model-clip.bin');
  });

  it('falls back to file1 as main when sizes are both 0', () => {
    const f1 = makeFile('a.gguf', 0);
    const f2 = makeFile('b.gguf', 0);
    const { mainFile, mmProjFile } = classifyGgufPair(f1, f2);
    expect(mainFile.name).toBe('a.gguf');
    expect(mmProjFile.name).toBe('b.gguf');
  });
});

// ── getErrorMessage ─────────────────────────────────────────────────────────

describe('getErrorMessage', () => {
  it('returns error.message for Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns "Unknown error" for non-Error values', () => {
    expect(getErrorMessage('string error')).toBe('Unknown error');
    expect(getErrorMessage(42)).toBe('Unknown error');
    expect(getErrorMessage(null)).toBe('Unknown error');
    expect(getErrorMessage(undefined)).toBe('Unknown error');
    expect(getErrorMessage({ message: 'obj' })).toBe('Unknown error');
  });
});

// ── importGgufFiles ─────────────────────────────────────────────────────────

describe('importGgufFiles', () => {
  let device: ModelManagerDevice;
  let importGgufFiles: ImportHelpers['importGgufFiles'];
  let alerts: AlertState[];
  let progress: Array<{ fraction: number; fileName: string }>;
  let added: DownloadedModel[];
  let dialogs: Array<{ title: string; message: string }>;
  let answer: string;

  const deps = () => ({
    setAlertState: (next: AlertState | ((prev: AlertState) => AlertState)) => {
      alerts.push(typeof next === 'function' ? next(alerts.at(-1)!) : next);
    },
    setImportProgress: (p: { fraction: number; fileName: string } | null) => { if (p) progress.push(p); },
    addDownloadedModel: (model: DownloadedModel) => { added.push(model); },
  });

  /** A file the document picker hands back: it sits on the phone's disk. */
  const picked = (name: string, size: number) => {
    device.fs.seedFile(`/picked/${name}`, size);
    return { uri: `file:///picked/${name}`, name, size };
  };

  beforeEach(async () => {
    device = await installModelManagerDevice();
    ({ importGgufFiles } = require('../../../../src/screens/ModelsScreen/importHelpers') as ImportHelpers);
    alerts = [];
    progress = [];
    added = [];
    dialogs = [];
    answer = 'Import';
    // The OS dialog: record it and tap the button the test chose.
    require('react-native').Alert.alert = (title: string, message: string, buttons?: Array<{ text: string; onPress?: () => void }>) => {
      dialogs.push({ title, message });
      buttons?.find(b => b.text === answer)?.onPress?.();
    };
  });

  const inModels = (name: string) => device.fs.exists(`${device.modelsDir}/${name}`);

  it('single GGUF: copies it into the models folder, registers it, reports progress and says it worked', async () => {
    const file = picked('my-model-Q4_K_M.gguf', 4000);

    await importGgufFiles([file], deps());

    expect(await inModels('my-model-Q4_K_M.gguf')).toBe(true);
    expect(added).toEqual([expect.objectContaining({ fileName: 'my-model-Q4_K_M.gguf', fileSize: 4000 })]);
    expect(await device.readRegistry()).toEqual([expect.objectContaining({ fileName: 'my-model-Q4_K_M.gguf' })]);
    expect(progress.at(-1)).toEqual(expect.objectContaining({ fraction: 1, fileName: 'my-model-Q4_K_M.gguf' }));
    expect(alerts).toEqual([expect.objectContaining({ visible: true, title: 'Success', message: `${added[0].name} imported successfully!` })]);
    expect(dialogs).toEqual([]);
  });

  it('single file with no name is refused as not a model, and nothing is copied', async () => {
    device.fs.seedFile('/picked/x', 10);

    await expect(importGgufFiles([{ uri: 'file:///picked/x', name: null, size: 0 }], deps()))
      .rejects.toThrow('Only .gguf and .litertlm files can be imported');
    expect(await inModels('unknown')).toBe(false);
    expect(added).toEqual([]);
  });

  it('two GGUFs: asks first, and on Import brings in the model with its projector linked', async () => {
    const main = picked('llava-7b-Q4_K_M.gguf', 4200);
    const mmproj = picked('llava-mmproj-f16.gguf', 300);

    await importGgufFiles([main, mmproj], deps());

    expect(dialogs).toEqual([expect.objectContaining({
      title: 'Import Vision Model?',
      message: expect.stringContaining('Main model:  llava-7b-Q4_K_M.gguf\nProjector:    llava-mmproj-f16.gguf'),
    })]);
    expect(await inModels('llava-7b-Q4_K_M.gguf')).toBe(true);
    expect(await inModels('llava-mmproj-f16.gguf')).toBe(true);
    expect(added).toEqual([expect.objectContaining({
      fileName: 'llava-7b-Q4_K_M.gguf', isVisionModel: true, mmProjPath: `${device.modelsDir}/llava-mmproj-f16.gguf`,
    })]);
    expect(alerts.at(-1)).toEqual(expect.objectContaining({ title: 'Success', message: `${added[0].name} imported with vision projector!` }));
  });

  it('two GGUFs: a projector picked first is still used as the projector', async () => {
    const mmproj = picked('mmproj-f16.gguf', 200);
    const main = picked('model-Q4_K_M.gguf', 4000);

    await importGgufFiles([mmproj, main], deps());

    expect(added).toEqual([expect.objectContaining({ fileName: 'model-Q4_K_M.gguf', mmProjPath: `${device.modelsDir}/mmproj-f16.gguf` })]);
  });

  it('two GGUFs: on Cancel nothing is copied or registered', async () => {
    answer = 'Cancel';
    const main = picked('llava-7b-Q4_K_M.gguf', 4200);
    const mmproj = picked('llava-mmproj-f16.gguf', 300);

    await importGgufFiles([main, mmproj], deps());

    expect(dialogs).toHaveLength(1);
    expect(await inModels('llava-7b-Q4_K_M.gguf')).toBe(false);
    expect(added).toEqual([]);
    expect(await device.readRegistry()).toEqual([]);
    expect(alerts).toEqual([]);
  });
});
