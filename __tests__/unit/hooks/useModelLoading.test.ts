/**
 * useModelLoading Hook Unit Tests
 *
 * Selecting a model only MARKS it active (no eager load); the load is deferred
 * to the first message in chat. Unload still tears down immediately.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useModelLoading } from '../../../src/screens/HomeScreen/hooks/useModelLoading';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../src/services', () => ({
  activeModelService: {
    loadTextModel: jest.fn().mockResolvedValue(undefined),
    unloadTextModel: jest.fn().mockResolvedValue(undefined),
    loadImageModel: jest.fn().mockResolvedValue(undefined),
    unloadImageModel: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../src/components', () => ({
  showAlert: jest.fn((title: string, message: string, buttons?: any[]) => ({
    visible: true, title, message, buttons: buttons ?? [],
  })),
}));

const mockSetActiveModelId = jest.fn();
const mockSetLastTextModelId = jest.fn();
const mockSetActiveImageModelId = jest.fn();
jest.mock('../../../src/stores', () => ({
  useAppStore: {
    getState: () => ({
      setActiveModelId: mockSetActiveModelId,
      setLastTextModelId: mockSetLastTextModelId,
      setActiveImageModelId: mockSetActiveImageModelId,
    }),
  },
}));

const { activeModelService } = require('../../../src/services');
const mockLoadTextModel: jest.Mock = activeModelService.loadTextModel;
const mockUnloadTextModel: jest.Mock = activeModelService.unloadTextModel;
const mockLoadImageModel: jest.Mock = activeModelService.loadImageModel;
const mockUnloadImageModel: jest.Mock = activeModelService.unloadImageModel;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTextModel(overrides: Partial<any> = {}): any {
  return { id: 'text-1', name: 'Test LLM', filePath: '/path/model.gguf', ...overrides };
}

function makeImageModel(overrides: Partial<any> = {}): any {
  return { id: 'img-1', name: 'SDXL', ...overrides };
}

function makeSetters() {
  return {
    setLoadingState: jest.fn(),
    setPickerType: jest.fn(),
    setAlertState: jest.fn(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useModelLoading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleSelectTextModel', () => {
    it('marks the text model active without loading it', () => {
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      act(() => {
        result.current.handleSelectTextModel(makeTextModel());
      });

      expect(mockSetActiveModelId).toHaveBeenCalledWith('text-1');
      expect(mockSetLastTextModelId).toHaveBeenCalledWith('text-1');
      expect(setters.setPickerType).toHaveBeenCalledWith(null);
      // Deferred to first send in chat — no eager load here.
      expect(mockLoadTextModel).not.toHaveBeenCalled();
    });
  });

  describe('handleSelectImageModel', () => {
    it('marks the image model active without loading it', () => {
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      act(() => {
        result.current.handleSelectImageModel(makeImageModel());
      });

      expect(mockSetActiveImageModelId).toHaveBeenCalledWith('img-1');
      expect(setters.setPickerType).toHaveBeenCalledWith(null);
      expect(mockLoadImageModel).not.toHaveBeenCalled();
    });
  });

  describe('handleUnloadTextModel', () => {
    it('unloads text model and resets loading state', async () => {
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleUnloadTextModel();
        jest.advanceTimersByTime(800);
        await p;
      });

      expect(mockUnloadTextModel).toHaveBeenCalled();
    });

    it('shows error alert when unload throws', async () => {
      mockUnloadTextModel.mockRejectedValueOnce(new Error('fail'));
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleUnloadTextModel();
        jest.advanceTimersByTime(800);
        await p;
      });

      expect(setters.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' }),
      );
    });
  });

  describe('handleUnloadImageModel', () => {
    it('unloads image model', async () => {
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleUnloadImageModel();
        jest.advanceTimersByTime(800);
        await p;
      });

      expect(mockUnloadImageModel).toHaveBeenCalled();
    });
  });
});
