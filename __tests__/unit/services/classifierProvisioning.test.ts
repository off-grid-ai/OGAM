/**
 * classifierProvisioning tests — auto-downloads + selects the default SmolLM2
 * classifier so LLM routing works out of the box.
 */
let mockState: any;
jest.mock('../../../src/stores', () => ({
  useAppStore: { getState: () => mockState },
}));

jest.mock('../../../src/services/modelManager', () => ({
  modelManager: {
    isBackgroundDownloadSupported: () => true,
  },
}));

// The classifier now downloads through THE single entry point (startModelDownload),
// which registers the model AND clears the in-flight row on completion — the old
// parallel downloadModelBackground + watchDownload left a phantom "downloading 100%"
// row behind. The test drives startModelDownload's onRegistered hook.
const mockStartModelDownload = jest.fn();
jest.mock('../../../src/services/startModelDownload', () => ({
  startModelDownload: (...a: any[]) => mockStartModelDownload(...a),
}));

const mockGetModelFiles = jest.fn();
jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: { getModelFiles: (...a: any[]) => mockGetModelFiles(...a) },
}));

const mockUpdateSettings = jest.fn((patch: any) => { mockState.settings = { ...mockState.settings, ...patch }; });

const REPO = 'bartowski/SmolLM2-135M-Instruct-GGUF';

describe('ensureDefaultClassifier', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockState = {
      settings: { classifierModelId: null },
      downloadedModels: [],
      updateSettings: mockUpdateSettings,
    };
  });

  const load = () => require('../../../src/services/classifierProvisioning').ensureDefaultClassifier;

  it('no-ops when a usable classifier is already configured', async () => {
    mockState.settings.classifierModelId = 'x/y.gguf';
    mockState.downloadedModels = [{ id: 'x/y.gguf' }];
    await load()();
    expect(mockStartModelDownload).not.toHaveBeenCalled();
  });

  it('selects an already-downloaded default instead of re-downloading', async () => {
    mockState.downloadedModels = [{ id: `${REPO}/SmolLM2-135M-Instruct-Q8_0.gguf` }];
    await load()();
    expect(mockStartModelDownload).not.toHaveBeenCalled();
    expect(mockUpdateSettings).toHaveBeenCalledWith({ classifierModelId: `${REPO}/SmolLM2-135M-Instruct-Q8_0.gguf` });
  });

  it('downloads the Q8_0 GGUF through the single entry point and selects it on registration', async () => {
    mockGetModelFiles.mockResolvedValue([
      { name: 'SmolLM2-135M-Instruct-Q4_K_M.gguf', size: 90, downloadUrl: 'u1' },
      { name: 'SmolLM2-135M-Instruct-Q8_0.gguf', size: 145, downloadUrl: 'u2' },
    ]);

    await load()();

    // Routes through startModelDownload (which clears the in-flight row), NOT a parallel
    // downloadModelBackground/watchDownload that would leave a phantom row behind.
    expect(mockStartModelDownload).toHaveBeenCalledWith(
      REPO,
      expect.objectContaining({ name: 'SmolLM2-135M-Instruct-Q8_0.gguf' }),
      expect.objectContaining({ onRegistered: expect.any(Function), onError: expect.any(Function) }),
    );
    // The registered model's id selects the classifier (uses the model, not a re-derived string).
    const opts = mockStartModelDownload.mock.calls[0][2];
    opts.onRegistered({ id: `${REPO}/SmolLM2-135M-Instruct-Q8_0.gguf` });
    expect(mockUpdateSettings).toHaveBeenCalledWith({ classifierModelId: `${REPO}/SmolLM2-135M-Instruct-Q8_0.gguf` });
  });
});
