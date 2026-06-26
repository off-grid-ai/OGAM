/**
 * classifierProvisioning tests — auto-downloads + selects the default SmolLM2
 * classifier so LLM routing works out of the box.
 */
let mockState: any;
jest.mock('../../../src/stores', () => ({
  useAppStore: { getState: () => mockState },
}));

const mockDownloadModelBackground = jest.fn();
const mockWatchDownload = jest.fn();
jest.mock('../../../src/services/modelManager', () => ({
  modelManager: {
    isBackgroundDownloadSupported: () => true,
    downloadModelBackground: (...a: any[]) => mockDownloadModelBackground(...a),
    watchDownload: (...a: any[]) => mockWatchDownload(...a),
  },
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
    expect(mockDownloadModelBackground).not.toHaveBeenCalled();
  });

  it('selects an already-downloaded default instead of re-downloading', async () => {
    mockState.downloadedModels = [{ id: `${REPO}/SmolLM2-135M-Instruct-Q8_0.gguf` }];
    await load()();
    expect(mockDownloadModelBackground).not.toHaveBeenCalled();
    expect(mockUpdateSettings).toHaveBeenCalledWith({ classifierModelId: `${REPO}/SmolLM2-135M-Instruct-Q8_0.gguf` });
  });

  it('downloads the Q8_0 GGUF and selects it on completion', async () => {
    mockGetModelFiles.mockResolvedValue([
      { name: 'SmolLM2-135M-Instruct-Q4_K_M.gguf', size: 90, downloadUrl: 'u1' },
      { name: 'SmolLM2-135M-Instruct-Q8_0.gguf', size: 145, downloadUrl: 'u2' },
    ]);
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 'dl-1' });

    await load()();

    expect(mockDownloadModelBackground).toHaveBeenCalledWith(
      REPO,
      expect.objectContaining({ name: 'SmolLM2-135M-Instruct-Q8_0.gguf' }),
    );
    // Simulate the download completing.
    const onComplete = mockWatchDownload.mock.calls[0][1];
    onComplete();
    expect(mockUpdateSettings).toHaveBeenCalledWith({ classifierModelId: `${REPO}/SmolLM2-135M-Instruct-Q8_0.gguf` });
  });
});
