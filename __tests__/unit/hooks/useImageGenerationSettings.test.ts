/**
 * useImageGenerationSettings (useClearGpuCache) Unit Tests
 */

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));

let mockActiveImageRoute: { source: 'local'; id: string } | null = {
  source: 'local',
  id: 'model1',
};

jest.mock('../../../src/hooks/useActiveMobileModel', () => ({
  useActiveMobileModel: () => ({ model: mockActiveImageRoute }),
}));

let mockImageStoreState: {
  downloadedImageModels: Array<{ id: string; modelPath: string | null }>;
  activeImageModelId: string | null;
};

jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn((selector: (state: typeof mockImageStoreState) => unknown) =>
    selector(mockImageStoreState)),
}));

jest.mock('../../../src/services/localDreamGenerator', () => ({
  localDreamGeneratorService: {
    clearOpenCLCache: jest.fn(),
  },
}));

import { Alert } from 'react-native';
import { useAppStore } from '../../../src/stores';
import { localDreamGeneratorService } from '../../../src/services/localDreamGenerator';
import { renderHook, act } from '@testing-library/react-native';
import { useClearGpuCache } from '../../../src/hooks/useImageGenerationSettings';

const mockAlert = Alert.alert as jest.Mock;
const mockUseAppStore = useAppStore as unknown as jest.Mock;
const mockClearOpenCLCache = localDreamGeneratorService.clearOpenCLCache as jest.Mock;

const activeModel = { id: 'model1', modelPath: '/path/to/model' };

describe('useClearGpuCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveImageRoute = { source: 'local', id: 'model1' };
    mockImageStoreState = {
      downloadedImageModels: [activeModel],
      activeImageModelId: 'model1',
    };
    mockUseAppStore.mockImplementation(selector => selector(mockImageStoreState));
  });

  it('initializes with clearing=false', () => {
    const { result } = renderHook(() => useClearGpuCache());
    expect(result.current.clearing).toBe(false);
  });

  it('shows No Model alert when no active model', async () => {
    mockActiveImageRoute = null;
    mockImageStoreState = {
      downloadedImageModels: [],
      activeImageModelId: null,
    };
    const { result } = renderHook(() => useClearGpuCache());
    await act(async () => { result.current.handleClearCache(); });
    expect(mockAlert).toHaveBeenCalledWith('No Model', expect.any(String));
    expect(mockClearOpenCLCache).not.toHaveBeenCalled();
  });

  it('shows No Model alert when active model has no modelPath', async () => {
    mockImageStoreState = {
      downloadedImageModels: [{ id: 'model1', modelPath: null }],
      activeImageModelId: 'model1',
    };
    const { result } = renderHook(() => useClearGpuCache());
    await act(async () => { result.current.handleClearCache(); });
    expect(mockAlert).toHaveBeenCalledWith('No Model', expect.any(String));
  });

  it('calls clearOpenCLCache with model path', async () => {
    mockClearOpenCLCache.mockResolvedValue(2);
    const { result } = renderHook(() => useClearGpuCache());
    await act(async () => { await result.current.handleClearCache(); });
    expect(mockClearOpenCLCache).toHaveBeenCalledWith('/path/to/model');
  });

  it('shows Cache Cleared alert with count on success', async () => {
    mockClearOpenCLCache.mockResolvedValue(3);
    const { result } = renderHook(() => useClearGpuCache());
    await act(async () => { await result.current.handleClearCache(); });
    expect(mockAlert).toHaveBeenCalledWith('Cache Cleared', expect.stringContaining('3'));
  });

  it('resets clearing to false after success', async () => {
    mockClearOpenCLCache.mockResolvedValue(1);
    const { result } = renderHook(() => useClearGpuCache());
    await act(async () => { await result.current.handleClearCache(); });
    expect(result.current.clearing).toBe(false);
  });

  it('shows Error alert when clearOpenCLCache throws', async () => {
    mockClearOpenCLCache.mockRejectedValue(new Error('GPU error'));
    const { result } = renderHook(() => useClearGpuCache());
    await act(async () => { await result.current.handleClearCache(); });
    expect(mockAlert).toHaveBeenCalledWith('Error', expect.stringContaining('GPU error'));
  });

  it('resets clearing to false after error', async () => {
    mockClearOpenCLCache.mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useClearGpuCache());
    await act(async () => { await result.current.handleClearCache(); });
    expect(result.current.clearing).toBe(false);
  });
});
