/**
 * Unit tests for importHelpers.ts
 *
 * Tests pure helpers (isMmProj, classifyGgufPair, getErrorMessage) directly,
 * and importGgufFiles via mocked dependencies.
 */

// ── Mocks (hoisted before imports) ─────────────────────────────────────────

const mockImportSelectedModelFiles = jest.fn();
jest.mock('../../../../src/services', () => ({
  modelLibrary: {
    getModelsDirectory: jest.fn(() => '/models'),
    getImageModelsDirectory: jest.fn(() => '/models'),
  },
}));
jest.mock('../../../../src/services/adapters/models/library/modelFileImportApplicationAdapter', () => ({
  importSelectedModelFiles: (...args: any[]) => mockImportSelectedModelFiles(...args),
}));

jest.mock('../../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn(),
  initialAlertState: { visible: false },
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { Alert } from 'react-native';
import {
  isMmProj,
  classifyGgufPair,
  getErrorMessage,
  importGgufFiles,
  GgufFileRef,
} from '../../../../src/screens/ModelsScreen/importHelpers';
import { showAlert } from '../../../../src/components/CustomAlert';

const mockShowAlert = showAlert as jest.Mock;
const mockAlertAlert = jest.spyOn(Alert, 'alert') as jest.Mock;

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

  it('uses the Shared classifier tie-break when sizes are both 0', () => {
    const f1 = makeFile('a.gguf', 0);
    const f2 = makeFile('b.gguf', 0);
    const { mainFile, mmProjFile } = classifyGgufPair(f1, f2);
    expect(mainFile.name).toBe('b.gguf');
    expect(mmProjFile.name).toBe('a.gguf');
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
  const mockSetAlertState = jest.fn();
  const mockSetImportProgress = jest.fn();
  const mockAddDownloadedModel = jest.fn();

  const deps = {
    setAlertState: mockSetAlertState,
    setImportProgress: mockSetImportProgress,
    addDownloadedModel: mockAddDownloadedModel,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockShowAlert.mockReturnValue({ visible: true });
  });

  // ── single GGUF ────────────────────────────────────────────────────────

  it('single GGUF: passes the picker artifact to the import application and shows success', async () => {
    const fakeModel = { id: 'm1', name: 'MyModel' };
    mockImportSelectedModelFiles.mockImplementationOnce(async (input: any) => {
      input.refresh(fakeModel);
      return { status: 'completed', model: fakeModel, projector: false };
    });

    await importGgufFiles(
      [{ uri: 'file://my-model.gguf', name: 'my-model.gguf', size: 4000 }],
      deps,
    );

    expect(mockImportSelectedModelFiles).toHaveBeenCalledWith(expect.objectContaining({
      modelsDir: '/models',
      artifacts: [{ uri: 'file://my-model.gguf', name: 'my-model.gguf', sizeBytes: 4000 }],
      decide: expect.any(Function),
      onProgress: mockSetImportProgress,
      refresh: mockAddDownloadedModel,
    }));
    expect(mockAddDownloadedModel).toHaveBeenCalledWith(fakeModel);
    expect(mockSetAlertState).toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
    expect(mockShowAlert).toHaveBeenCalledWith('Success', 'MyModel imported successfully!');
  });

  it('single GGUF: null name falls back to "unknown"', async () => {
    const model = { id: 'x', name: 'X' };
    mockImportSelectedModelFiles.mockResolvedValueOnce({ status: 'completed', model, projector: false });
    await importGgufFiles([{ uri: 'file://x.gguf', name: null, size: 0 }], deps);
    expect(mockImportSelectedModelFiles).toHaveBeenCalledWith(expect.objectContaining({
      artifacts: [{ uri: 'file://x.gguf', name: 'unknown', sizeBytes: 0 }],
    }));
  });

  // ── two GGUFs — user confirms ──────────────────────────────────────────

  it('two GGUFs: shows confirmation dialog and on confirm imports with mmproj args', async () => {
    const fakeModel = { id: 'm2', name: 'VisionModel' };
    mockImportSelectedModelFiles.mockImplementationOnce(async (input: any) => {
      const accepted = await input.decide({
        type: 'confirm-projector',
        primary: { uri: file1.uri, name: file1.name, sizeBytes: file1.size },
        projector: { uri: file2.uri, name: file2.name, sizeBytes: file2.size },
      });
      if (!accepted) return { status: 'cancelled' };
      input.refresh(fakeModel);
      return { status: 'completed', model: fakeModel, projector: true };
    });

    // Simulate user tapping "Import" in the native Alert dialog
    mockAlertAlert.mockImplementationOnce((_title: string, _msg: string, buttons: any[]) => {
      buttons?.find((b: any) => b.text === 'Import')?.onPress?.();
    });

    const file1 = { uri: 'file://llava-7b-Q4.gguf', name: 'llava-7b-Q4.gguf', size: 4200 };
    const file2 = { uri: 'file://llava-mmproj-f16.gguf', name: 'llava-mmproj-f16.gguf', size: 300 };

    await importGgufFiles([file1, file2], deps);

    // Confirmation dialog shown via Alert.alert
    expect(Alert.alert).toHaveBeenCalledWith(
      'Import Vision Model?',
      expect.stringContaining('llava-7b-Q4.gguf'),
      expect.any(Array),
      expect.any(Object),
    );

    expect(mockImportSelectedModelFiles).toHaveBeenCalledWith(expect.objectContaining({
      artifacts: [
        { uri: file1.uri, name: file1.name, sizeBytes: file1.size },
        { uri: file2.uri, name: file2.name, sizeBytes: file2.size },
      ],
    }));

    expect(mockAddDownloadedModel).toHaveBeenCalledWith(fakeModel);
    expect(mockShowAlert).toHaveBeenCalledWith('Success', 'VisionModel imported with vision projector!');
  });

  it('two GGUFs: classifies correctly — mmproj name in file1 position swaps to projector', async () => {
    // file1 has mmproj in name → should become the projector, file2 is main
    const mmproj = { uri: 'file://mmproj-f16.gguf', name: 'mmproj-f16.gguf', size: 200 };
    const main = { uri: 'file://model-Q4.gguf', name: 'model-Q4.gguf', size: 4000 };

    mockImportSelectedModelFiles.mockImplementationOnce(async (input: any) => {
      const accepted = await input.decide({
        type: 'confirm-projector',
        primary: { uri: main.uri, name: main.name, sizeBytes: main.size },
        projector: { uri: mmproj.uri, name: mmproj.name, sizeBytes: mmproj.size },
      });
      return accepted
        ? { status: 'completed', model: { id: 'v', name: 'VisionModel' }, projector: true }
        : { status: 'cancelled' };
    });

    mockAlertAlert.mockImplementationOnce((_: string, __: string, buttons: any[]) => {
      buttons?.find((b: any) => b.text === 'Import')?.onPress?.();
    });

    await importGgufFiles([mmproj, main], deps);

    expect(Alert.alert).toHaveBeenCalledWith(
      'Import Vision Model?',
      expect.stringContaining(`Main model:  ${main.name}`),
      expect.any(Array),
      expect.any(Object),
    );
  });

  // ── two GGUFs — user cancels ───────────────────────────────────────────

  it('two GGUFs: cancellation stops before registry refresh', async () => {
    mockImportSelectedModelFiles.mockImplementationOnce(async (input: any) => {
      const accepted = await input.decide({
        type: 'confirm-projector',
        primary: { uri: file1.uri, name: file1.name, sizeBytes: file1.size },
        projector: { uri: file2.uri, name: file2.name, sizeBytes: file2.size },
      });
      return accepted ? { status: 'completed', model: {}, projector: true } : { status: 'cancelled' };
    });
    mockAlertAlert.mockImplementationOnce((_title: string, _msg: string, buttons: any[]) => {
      buttons?.find((b: any) => b.text === 'Cancel')?.onPress?.();
    });

    const file1 = { uri: 'file://llava-7b-Q4.gguf', name: 'llava-7b-Q4.gguf', size: 4200 };
    const file2 = { uri: 'file://llava-mmproj-f16.gguf', name: 'llava-mmproj-f16.gguf', size: 300 };

    await importGgufFiles([file1, file2], deps);

    expect(mockImportSelectedModelFiles).toHaveBeenCalledTimes(1);
    expect(mockAddDownloadedModel).not.toHaveBeenCalled();
  });

  // ── onProgress wiring ──────────────────────────────────────────────────

  it('single GGUF: onProgress callback forwards progress to setImportProgress', async () => {
    mockImportSelectedModelFiles.mockImplementationOnce(async (input: any) => {
      input.onProgress({ fraction: 0.5, fileName: 'my-model.gguf' });
      return { status: 'completed', model: { id: 'x', name: 'X' }, projector: false };
    });

    await importGgufFiles(
      [{ uri: 'file://my-model.gguf', name: 'my-model.gguf', size: 100 }],
      deps,
    );

    expect(mockSetImportProgress).toHaveBeenCalledWith({ fraction: 0.5, fileName: 'my-model.gguf' });
  });
});
