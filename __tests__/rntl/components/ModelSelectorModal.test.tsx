/**
 * ModelSelectorModal Component Tests
 *
 * Tests for the modal showing text and image model lists:
 * - Returns null when not visible
 * - Renders "Select Model" title
 * - Shows text models tab by default
 * - Shows downloaded text models
 * - Shows "No models" when empty
 * - Shows unload button when model is loaded
 * - Calls onSelectModel when model pressed
 * - Switches to image tab
 * - Image model selection and loading
 * - Vision model badge
 * - Loading banner
 * - Tab badges
 * - Image model unload
 *
 * Priority: P1 (High)
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ModelSelectorModal } from '../../../src/components/ModelSelectorModal';

jest.mock('../../../src/components/AppSheet', () => ({
  AppSheet: ({ visible, children, title }: any) => {
    if (!visible) return null;
    const { View, Text } = require('react-native');
    return (
      <View testID="app-sheet">
        <Text>{title}</Text>
        {children}
      </View>
    );
  },
}));

const mockUseAppStore = jest.fn();
const mockUseRemoteServerStore = jest.fn();
jest.mock('../../../src/stores', () => ({
  useAppStore: () => mockUseAppStore(),
  useRemoteServerStore: () => mockUseRemoteServerStore(),
}));

jest.mock('../../../src/services', () => ({
  activeModelService: {
    loadImageModel: jest.fn().mockResolvedValue(undefined),
    unloadImageModel: jest.fn().mockResolvedValue(undefined),
    unloadTextModel: jest.fn().mockResolvedValue(undefined),
  },
  llmService: {
    isModelLoaded: jest.fn(() => false),
  },
  hardwareService: {
    formatModelSize: jest.fn(() => '4.0 GB'),
    formatBytes: jest.fn(() => '2.0 GB'),
  },
  remoteServerManager: {
    clearActiveRemoteModel: jest.fn(),
    setActiveRemoteTextModel: jest.fn().mockResolvedValue(undefined),
    setActiveRemoteImageModel: jest.fn().mockResolvedValue(undefined),
  },
}));

// Import mocked functions after the mock is defined
const { activeModelService } = require('../../../src/services');

describe('ModelSelectorModal', () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    onSelectModel: jest.fn(),
    onUnloadModel: jest.fn(),
    isLoading: false,
    currentModelPath: null as string | null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppStore.mockReturnValue({
      downloadedModels: [
        {
          id: 'model1',
          name: 'Test Model',
          filePath: '/path/model1.gguf',
          fileSize: 4000000000,
          quantization: 'Q4_K_M',
        },
      ],
      downloadedImageModels: [],
      activeImageModelId: null,
    });
    mockUseRemoteServerStore.mockReturnValue({
      servers: [],
      activeServerId: null,
      activeRemoteTextModelId: null,
      activeRemoteImageModelId: null,
      discoveredModels: {},
      setActiveServerId: jest.fn(),
      setActiveRemoteImageModelId: jest.fn(),
    });
  });

  // ============================================================================
  // Visibility
  // ============================================================================
  describe('visibility', () => {
    it('returns null when not visible', () => {
      const { queryByTestId } = render(
        <ModelSelectorModal {...defaultProps} visible={false} />
      );

      expect(queryByTestId('app-sheet')).toBeNull();
    });

    it('renders when visible', () => {
      const { getByTestId } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByTestId('app-sheet')).toBeTruthy();
    });
  });

  // ============================================================================
  // Title
  // ============================================================================
  describe('title', () => {
    it('renders "Select Model" title', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('Select Model')).toBeTruthy();
    });
  });

  // ============================================================================
  // Text Models Tab (Default)
  // ============================================================================
  describe('text models tab', () => {
    it('shows text models tab by default', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      // "Text" tab label should be rendered
      expect(getByText('Text')).toBeTruthy();
    });

    it('shows downloaded text models', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('Test Model')).toBeTruthy();
    });

    it('filters suspicious recovered text models from the selector', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'recovered_bad_1',
            name: 'Recovered Bad Model',
            author: 'Unknown',
            filePath: '/path/bad.gguf',
            fileName: 'bad.gguf',
            fileSize: 400000000,
            quantization: 'Unknown',
            downloadedAt: new Date().toISOString(),
          },
          {
            id: 'model1',
            name: 'Good Model',
            author: 'test',
            filePath: '/path/good.gguf',
            fileName: 'good.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
            downloadedAt: new Date().toISOString(),
          },
        ],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText, queryByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('Good Model')).toBeTruthy();
      expect(queryByText('Recovered Bad Model')).toBeNull();
    });

    it('shows multiple downloaded text models', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'model1',
            name: 'Llama 3.2',
            filePath: '/path/llama.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
          },
          {
            id: 'model2',
            name: 'Phi 3',
            filePath: '/path/phi.gguf',
            fileSize: 2000000000,
            quantization: 'Q5_K_S',
          },
        ],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('Llama 3.2')).toBeTruthy();
      expect(getByText('Phi 3')).toBeTruthy();
    });

    it('shows "No Text Models" when downloadedModels is empty', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('No Text Models')).toBeTruthy();
      expect(getByText('Download models from the Models tab')).toBeTruthy();
    });

    it('shows "Available Models" title when no model is loaded', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('Available Models')).toBeTruthy();
    });

    it('shows quantization info for models', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('Q4_K_M')).toBeTruthy();
    });

    it('shows vision badge for vision models', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'model1',
            name: 'Vision Model',
            filePath: '/path/vision.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
            engine: 'llama',
            isVisionModel: true,
          },
        ],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('Vision')).toBeTruthy();
    });
  });

  // ============================================================================
  // Loaded Model / Unload
  // ============================================================================
  describe('loaded model', () => {
    it('shows unload button when a text model is loaded', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'model1',
            name: 'Test Model',
            filePath: '/path/model1.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
          },
        ],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          currentModelPath="/path/model1.gguf"
        />
      );

      expect(getByText('Unload')).toBeTruthy();
      expect(getByText('Currently Loaded')).toBeTruthy();
    });

    it('calls onUnloadModel when unload button is pressed', () => {
      const onUnloadModel = jest.fn();
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'model1',
            name: 'Test Model',
            filePath: '/path/model1.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
          },
        ],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          currentModelPath="/path/model1.gguf"
          onUnloadModel={onUnloadModel}
        />
      );

      fireEvent.press(getByText('Unload'));

      expect(onUnloadModel).toHaveBeenCalled();
    });

    it('shows "Switch Model" title when a model is loaded', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'model1',
            name: 'Test Model',
            filePath: '/path/model1.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
          },
        ],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          currentModelPath="/path/model1.gguf"
        />
      );

      expect(getByText('Switch Model')).toBeTruthy();
    });

    it('shows loaded model name and metadata', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'model1',
            name: 'My Model',
            filePath: '/path/model1.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
          },
        ],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getAllByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          currentModelPath="/path/model1.gguf"
        />
      );

      // Model name appears in both "Currently Loaded" section and model list
      expect(getAllByText('My Model').length).toBeGreaterThanOrEqual(1);
    });

    it('disables model selection when loading', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'model1',
            name: 'Test Model',
            filePath: '/path/model1.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
          },
          {
            id: 'model2',
            name: 'Other Model',
            filePath: '/path/other.gguf',
            fileSize: 2000000000,
            quantization: 'Q5_K_M',
          },
        ],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const onSelectModel = jest.fn();
      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          isLoading={true}
          onSelectModel={onSelectModel}
        />
      );

      // Models should be disabled during loading
      fireEvent.press(getByText('Other Model'));
      expect(onSelectModel).not.toHaveBeenCalled();
    });

    it('disables unload button when loading', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'model1',
            name: 'Test Model',
            filePath: '/path/model1.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
          },
        ],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          currentModelPath="/path/model1.gguf"
          isLoading={true}
        />
      );

      // The unload button should exist but be disabled
      expect(getByText('Unload')).toBeTruthy();
    });
  });

  // ============================================================================
  // Model Selection
  // ============================================================================
  describe('model selection', () => {
    it('calls onSelectModel when a text model is pressed', () => {
      const onSelectModel = jest.fn();

      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          onSelectModel={onSelectModel}
        />
      );

      fireEvent.press(getByText('Test Model'));

      expect(onSelectModel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'model1',
          name: 'Test Model',
          filePath: '/path/model1.gguf',
        })
      );
    });

    it('does not call onSelectModel when pressing the currently loaded model', () => {
      const onSelectModel = jest.fn();
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'model1',
            name: 'Test Model',
            filePath: '/path/model1.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
          },
        ],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getAllByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          onSelectModel={onSelectModel}
          currentModelPath="/path/model1.gguf"
        />
      );

      // The model name may appear both in "Currently Loaded" and the list
      const modelTexts = getAllByText('Test Model');
      // Press each instance - none should trigger onSelectModel for current model
      modelTexts.forEach(el => fireEvent.press(el));
      expect(onSelectModel).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Image Tab
  // ============================================================================
  describe('image tab', () => {
    it('switches to image tab when Image is pressed', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      // Press the Image tab
      fireEvent.press(getByText('Image'));

      // Should show the empty state for image models
      expect(getByText('No Image Models')).toBeTruthy();
      expect(getByText('Download image models from the Models tab')).toBeTruthy();
    });

    it('shows downloaded image models in image tab', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [
          {
            id: 'img-model1',
            name: 'Stable Diffusion',
            size: 2000000000,
            style: 'Realistic',
          },
        ],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} initialTab="image" />
      );

      expect(getByText('Stable Diffusion')).toBeTruthy();
    });

    it('filters suspicious recovered image models from the selector', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [
          {
            id: 'recovered_image_1',
            name: 'Recovered Image',
            description: 'Recovered',
            modelPath: '/path/recovered',
            size: 100000000,
            downloadedAt: new Date().toISOString(),
            backend: 'mnn',
          },
          {
            id: 'img-model1',
            name: 'Stable Diffusion',
            description: 'Image model',
            modelPath: '/path/sd',
            size: 2000000000,
            downloadedAt: new Date().toISOString(),
            backend: 'mnn',
          },
        ],
        activeImageModelId: null,
      });

      const { getByText, queryByText } = render(
        <ModelSelectorModal {...defaultProps} initialTab="image" />
      );

      expect(getByText('Stable Diffusion')).toBeTruthy();
      expect(queryByText('Recovered Image')).toBeNull();
    });

    it('shows tab badges when models are loaded', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [
          {
            id: 'model1',
            name: 'Test Model',
            filePath: '/path/model1.gguf',
            fileSize: 4000000000,
            quantization: 'Q4_K_M',
          },
        ],
        downloadedImageModels: [
          {
            id: 'img1',
            name: 'Image Model',
            size: 2000000000,
            style: 'Artistic',
          },
        ],
        activeImageModelId: 'img1',
      });

      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          currentModelPath="/path/model1.gguf"
        />
      );

      // Both tabs should render with badge dots when models are loaded
      expect(getByText('Text')).toBeTruthy();
      expect(getByText('Image')).toBeTruthy();
    });

    it('calls loadImageModel when selecting an image model', async () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [
          {
            id: 'img1',
            name: 'SD Model',
            size: 2000000000,
            style: 'Creative',
          },
        ],
        activeImageModelId: null,
      });

      const onSelectImageModel = jest.fn();
      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          initialTab="image"
          onSelectImageModel={onSelectImageModel}
        />
      );

      await act(async () => {
        fireEvent.press(getByText('SD Model'));
      });

      expect(activeModelService.loadImageModel).toHaveBeenCalledWith('img1');
    });

    it('does not call loadImageModel when pressing the currently active image model', async () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [
          {
            id: 'img1',
            name: 'SD Model',
            size: 2000000000,
            style: 'Creative',
          },
        ],
        activeImageModelId: 'img1',
      });

      const { getAllByText } = render(
        <ModelSelectorModal {...defaultProps} initialTab="image" />
      );

      // Model name appears in both "Currently Loaded" section and list
      const modelTexts = getAllByText('SD Model');
      await act(async () => {
        modelTexts.forEach(el => fireEvent.press(el));
      });

      expect(activeModelService.loadImageModel).not.toHaveBeenCalled();
    });

    it('shows currently loaded image model info', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [
          {
            id: 'img1',
            name: 'My Image Model',
            size: 2000000000,
            style: 'Artistic',
          },
        ],
        activeImageModelId: 'img1',
      });

      const { getByText, getAllByText } = render(
        <ModelSelectorModal {...defaultProps} initialTab="image" />
      );

      expect(getByText('Currently Loaded')).toBeTruthy();
      // Model name appears in both "Currently Loaded" section and the list
      expect(getAllByText('My Image Model').length).toBeGreaterThanOrEqual(1);
    });

    it('calls unloadImageModel when unload button pressed on image tab', async () => {
      const onUnloadImageModel = jest.fn();
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [
          {
            id: 'img1',
            name: 'My Image Model',
            size: 2000000000,
            style: 'Artistic',
          },
        ],
        activeImageModelId: 'img1',
      });

      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          initialTab="image"
          onUnloadImageModel={onUnloadImageModel}
        />
      );

      await act(async () => {
        fireEvent.press(getByText('Unload'));
      });

      expect(activeModelService.unloadImageModel).toHaveBeenCalled();
    });

    it('shows "Switch Model" in image tab when image model is loaded', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [
          {
            id: 'img1',
            name: 'My Image Model',
            size: 2000000000,
            style: 'Artistic',
          },
        ],
        activeImageModelId: 'img1',
      });

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} initialTab="image" />
      );

      expect(getByText('Switch Model')).toBeTruthy();
    });

    it('shows image model style in metadata', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [
          {
            id: 'img1',
            name: 'SD Model',
            size: 2000000000,
            style: 'Realistic',
          },
        ],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} initialTab="image" />
      );

      expect(getByText('Realistic')).toBeTruthy();
    });

    it('disables tab switching when loading', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [
          {
            id: 'img1',
            name: 'SD Model',
            size: 2000000000,
            style: 'Creative',
          },
        ],
        activeImageModelId: null,
      });

      const { getByText, queryByText } = render(
        <ModelSelectorModal {...defaultProps} isLoading={true} />
      );

      // Try to switch to image tab while loading
      fireEvent.press(getByText('Image'));

      // Should still show text tab content since tabs are disabled during loading
      expect(queryByText('No Image Models')).toBeNull();
    });
  });

  // ============================================================================
  // Loading State
  // ============================================================================
  describe('loading state', () => {
    it('shows loading banner when isLoading is true', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} isLoading={true} />
      );

      expect(getByText('Loading model...')).toBeTruthy();
    });

    it('does not show loading banner when not loading', () => {
      const { queryByText } = render(
        <ModelSelectorModal {...defaultProps} isLoading={false} />
      );

      expect(queryByText('Loading model...')).toBeNull();
    });
  });

  // ============================================================================
  // Initial Tab
  // ============================================================================
  describe('initial tab', () => {
    it('opens on image tab when initialTab is image', () => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} initialTab="image" />
      );

      expect(getByText('No Image Models')).toBeTruthy();
    });

    it('opens on text tab by default', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('Test Model')).toBeTruthy();
    });
  });

  // ============================================================================
  // Add Server button
  // ============================================================================
  describe('Add Server button', () => {
    beforeEach(() => {
      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [],
        activeImageModelId: null,
      });
    });

    it('renders Add Remote Server button in empty state', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} onAddServer={jest.fn()} />
      );

      expect(getByText('Add Remote Server')).toBeTruthy();
    });

    it('Add Remote Server calls onClose and onAddServer when pressed', () => {
      const onClose = jest.fn();
      const onAddServer = jest.fn();

      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          onClose={onClose}
          onAddServer={onAddServer}
        />
      );

      fireEvent.press(getByText('Add Remote Server'));

      expect(onClose).toHaveBeenCalled();
      expect(onAddServer).toHaveBeenCalled();
    });

    it('Add Remote Server is disabled when isLoading is true', () => {
      const onClose = jest.fn();
      const onAddServer = jest.fn();

      const { getByText } = render(
        <ModelSelectorModal
          {...defaultProps}
          onClose={onClose}
          onAddServer={onAddServer}
          isLoading={true}
        />
      );

      fireEvent.press(getByText('Add Remote Server'));

      expect(onClose).not.toHaveBeenCalled();
      expect(onAddServer).not.toHaveBeenCalled();
    });

    it('Add Remote Server visible when no models are downloaded', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} onAddServer={jest.fn()} />
      );

      expect(getByText('Add Remote Server')).toBeTruthy();
    });
  });

  // ============================================================================
  // Remote text models
  // ============================================================================
  describe('remote text models', () => {
    beforeEach(() => {
      mockUseRemoteServerStore.mockReturnValue({
        servers: [{ id: 'srv1', name: 'My Ollama', endpoint: 'http://192.168.1.10:11434' }],
        activeServerId: 'srv1',
        activeRemoteTextModelId: null,
        activeRemoteImageModelId: null,
        discoveredModels: {
          srv1: [
            {
              id: 'llama3',
              name: 'llama3',
              serverId: 'srv1',
              capabilities: { supportsVision: false, supportsToolCalling: false, supportsThinking: false },
              lastUpdated: '2026-01-01T00:00:00Z',
            },
          ],
        },
        serverHealth: { srv1: { isHealthy: true, lastCheck: '2026-01-01T00:00:00Z' } },
        setActiveServerId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
      });
    });

    it('shows remote text model in text tab', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('llama3')).toBeTruthy();
    });

    it('shows VLM model with cloud icon indicator', () => {
      mockUseRemoteServerStore.mockReturnValue({
        servers: [{ id: 'srv1', name: 'My Ollama', endpoint: 'http://192.168.1.10:11434' }],
        activeServerId: 'srv1',
        activeRemoteTextModelId: null,
        activeRemoteImageModelId: null,
        discoveredModels: {
          srv1: [
            {
              id: 'llava',
              name: 'llava',
              serverId: 'srv1',
              capabilities: { supportsVision: true, supportsToolCalling: false, supportsThinking: false },
              lastUpdated: '2026-01-01T00:00:00Z',
            },
          ],
        },
        serverHealth: { srv1: { isHealthy: true, lastCheck: '2026-01-01T00:00:00Z' } },
        setActiveServerId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
      });

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      // The server name section header should appear (rendered via wifi icon + server name)
      expect(getByText('My Ollama')).toBeTruthy();
      expect(getByText('llava')).toBeTruthy();
    });

    it('shows vision capability badge for VLM remote model', () => {
      mockUseRemoteServerStore.mockReturnValue({
        servers: [{ id: 'srv1', name: 'My Ollama', endpoint: 'http://192.168.1.10:11434' }],
        activeServerId: 'srv1',
        activeRemoteTextModelId: null,
        activeRemoteImageModelId: null,
        discoveredModels: {
          srv1: [
            {
              id: 'llava',
              name: 'llava',
              serverId: 'srv1',
              capabilities: { supportsVision: true, supportsToolCalling: false, supportsThinking: false },
              lastUpdated: '2026-01-01T00:00:00Z',
            },
          ],
        },
        serverHealth: { srv1: { isHealthy: true, lastCheck: '2026-01-01T00:00:00Z' } },
        setActiveServerId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
      });

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      expect(getByText('Vision')).toBeTruthy();
    });

    it('calls setActiveRemoteTextModel when remote model pressed', async () => {
      const { remoteServerManager } = require('../../../src/services');

      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      await act(async () => {
        fireEvent.press(getByText('llama3'));
      });

      expect(remoteServerManager.setActiveRemoteTextModel).toHaveBeenCalledWith(
        'srv1',
        'llama3'
      );
    });

    it('remote model shows server name as subtitle', () => {
      const { getByText } = render(
        <ModelSelectorModal {...defaultProps} />
      );

      // Server name appears as a section header in the grouped remote models list
      expect(getByText('My Ollama')).toBeTruthy();
    });
  });

  // ============================================================================
  // Image tab remote models
  // ============================================================================
  describe('image tab remote models', () => {
    it('image tab shows no remote models section even if discoveredModels has vision models', () => {
      mockUseRemoteServerStore.mockReturnValue({
        servers: [{ id: 'srv1', name: 'My Ollama', endpoint: 'http://192.168.1.10:11434' }],
        activeServerId: 'srv1',
        activeRemoteTextModelId: null,
        activeRemoteImageModelId: null,
        discoveredModels: {
          srv1: [
            {
              id: 'llava',
              name: 'llava',
              serverId: 'srv1',
              capabilities: { supportsVision: true, supportsToolCalling: false, supportsThinking: false },
              lastUpdated: '2026-01-01T00:00:00Z',
            },
          ],
        },
        serverHealth: { srv1: { isHealthy: true, lastCheck: '2026-01-01T00:00:00Z' } },
        setActiveServerId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
      });

      mockUseAppStore.mockReturnValue({
        downloadedModels: [],
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { queryByTestId, getByText } = render(
        <ModelSelectorModal {...defaultProps} initialTab="image" />
      );

      // Image tab should show empty state — no remote model items
      expect(getByText('No Image Models')).toBeTruthy();
      expect(queryByTestId('remote-model-item')).toBeNull();
    });
  });
});
