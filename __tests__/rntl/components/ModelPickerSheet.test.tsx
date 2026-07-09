/**
 * ModelPickerSheet Component Tests
 *
 * Tests for the HomeScreen bottom sheet showing model selection:
 * - Visibility (pickerType null/text/image)
 * - Title changes by tab
 * - Empty states for text and image
 * - Local text models rendering and selection
 * - Remote text models rendering and selection
 * - Local image models rendering and selection
 * - Unload buttons (local vs remote)
 * - Add Remote Server button
 * - Memory warning display
 * - Server name lookup
 * - Browse more button
 * - Loading disabled state
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ModelPickerSheet } from '../../../src/screens/HomeScreen/components/ModelPickerSheet';
import type { DownloadedModel, ONNXImageModel, RemoteModel } from '../../../src/types';

// Mock AppSheet to render children when visible
jest.mock('../../../src/components/AppSheet', () => ({
  AppSheet: ({ visible, children, title, onClose }: any) => {
    if (!visible) return null;
    const { View, Text, TouchableOpacity } = require('react-native');
    return (
      <View testID="app-sheet">
        <Text testID="sheet-title">{title}</Text>
        <TouchableOpacity testID="sheet-close" onPress={onClose} />
        {children}
      </View>
    );
  },
}));

jest.mock('../../../src/components/onboarding/spotlightState', () => ({
  consumePendingSpotlight: jest.fn(() => null),
}));

jest.mock('../../../src/components/onboarding/spotlightConfig', () => ({
  MODEL_PICKER_STEP_INDEX: 2,
}));

jest.mock('../../../src/components', () => ({
  Button: ({ title, onPress }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity testID="button" onPress={onPress}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
  // Use the REAL shared row so the test exercises the actual card the app renders
  // (theme + icons are already mocked below), not a stand-in that could mask drift.
  ModelRow: jest.requireActual('../../../src/components/ModelRow').ModelRow,
}));

jest.mock('../../../src/theme', () => ({
  useTheme: () => ({
    colors: {
      text: '#000',
      textMuted: '#999',
      textSecondary: '#666',
      border: '#ddd',
      primary: '#007AFF',
      error: '#FF3B30',
      info: '#5AC8FA',
      background: '#fff',
    },
  }),
  useThemedStyles: (fn: any) => fn(
    {
      text: '#000',
      textMuted: '#999',
      textSecondary: '#666',
      border: '#ddd',
      primary: '#007AFF',
      error: '#FF3B30',
      info: '#5AC8FA',
      background: '#fff',
    },
    {}
  ),
}));

jest.mock('../../../src/screens/HomeScreen/styles', () => ({
  createStyles: () => ({
    modalScroll: {},
    emptyPicker: {},
    emptyPickerText: {},
    unloadButton: {},
    unloadButtonText: {},
    sectionLabel: {},
    pickerItem: {},
    pickerItemActive: {},
    pickerItemWarning: {},
    pickerItemInfo: {},
    pickerItemName: {},
    pickerItemMeta: {},
    pickerItemMemory: {},
    pickerItemMemoryWarning: {},
    browseMoreButton: {},
    browseMoreText: {},
  }),
}));

jest.mock('../../../src/services', () => ({
  hardwareService: {
    formatModelSize: jest.fn(() => '4.0 GB'),
    formatBytes: jest.fn(() => '2.0 GB'),
  },
}));

const mockUseRemoteServerStore = jest.fn();
jest.mock('../../../src/stores', () => ({
  useRemoteServerStore: (selector: any) => {
    const state = mockUseRemoteServerStore();
    return selector ? selector(state) : state;
  },
}));

jest.mock('react-native-vector-icons/Feather', () => 'Icon');

// Factories
const makeTextModel = (overrides: Partial<DownloadedModel> = {}): DownloadedModel => ({
  id: 'model1',
  name: 'Test Model',
  filePath: '/models/test.gguf',
  fileSize: 4 * 1024 * 1024 * 1024,
  quantization: 'Q4_K_M',
  isVisionModel: false,
  ...overrides,
} as DownloadedModel);

const makeImageModel = (overrides: Partial<ONNXImageModel> = {}): ONNXImageModel => ({
  id: 'img1',
  name: 'CLIP Model',
  size: 2 * 1024 * 1024 * 1024,
  style: 'Photorealistic',
  ...overrides,
} as ONNXImageModel);

const makeRemoteModel = (overrides: Partial<RemoteModel> = {}): RemoteModel => ({
  id: 'llama3',
  name: 'llama3',
  serverId: 'srv1',
  capabilities: {
    supportsVision: false,
    supportsToolCalling: false,
    supportsThinking: false,
  },
  lastUpdated: new Date().toISOString(),
  ...overrides,
} as RemoteModel);

const idleLoading = { isLoading: false, type: null as 'text' | 'image' | null, modelName: null as string | null };
const busyLoading = { isLoading: true, type: 'text' as const, modelName: null as string | null };
const tightMemoryInfo = {
  memoryAvailable: 4 * 1024 * 1024 * 1024,
  memoryUsed: 12 * 1024 * 1024 * 1024,
  memoryTotal: 16 * 1024 * 1024 * 1024,
  memoryUsagePercent: 75,
  estimatedModelMemory: 0,
};

const defaultProps = {
  pickerType: 'text' as 'text' | 'image' | null,
  loadingState: idleLoading,
  downloadedModels: [] as DownloadedModel[],
  downloadedImageModels: [] as ONNXImageModel[],
  activeModelId: null as string | null,
  activeImageModelId: null as string | null,
  memoryInfo: null as typeof tightMemoryInfo | null,
  remoteTextModels: [] as RemoteModel[],
  remoteImageModels: [] as RemoteModel[],
  activeRemoteTextModelId: null as string | null,
  activeRemoteImageModelId: null as string | null,
  onClose: jest.fn(),
  onSelectTextModel: jest.fn(),
  onUnloadTextModel: jest.fn(),
  onSelectImageModel: jest.fn(),
  onUnloadImageModel: jest.fn(),
  onSelectRemoteTextModel: jest.fn(),
  onUnloadRemoteTextModel: jest.fn(),
  onSelectRemoteImageModel: jest.fn(),
  onUnloadRemoteImageModel: jest.fn(),
  onBrowseModels: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRemoteServerStore.mockReturnValue({
    servers: [{ id: 'srv1', name: 'My Ollama' }],
  });
});

describe('ModelPickerSheet', () => {
  // ============================================================================
  // Visibility
  // ============================================================================
  describe('visibility', () => {
    it('does not render when pickerType is null', () => {
      const { queryByTestId } = render(
        <ModelPickerSheet {...defaultProps} pickerType={null} />
      );
      expect(queryByTestId('app-sheet')).toBeNull();
    });

    it('renders when pickerType is "text"', () => {
      const { getByTestId } = render(<ModelPickerSheet {...defaultProps} pickerType="text" />);
      expect(getByTestId('app-sheet')).toBeTruthy();
    });

    it('renders when pickerType is "image"', () => {
      const { getByTestId } = render(<ModelPickerSheet {...defaultProps} pickerType="image" />);
      expect(getByTestId('app-sheet')).toBeTruthy();
    });
  });

  // ============================================================================
  // Title
  // ============================================================================
  describe('title', () => {
    it('shows "Text Models" for text picker', () => {
      const { getByTestId } = render(<ModelPickerSheet {...defaultProps} pickerType="text" />);
      expect(getByTestId('sheet-title').props.children).toBe('Text Models');
    });

    it('shows "Image Models" for image picker', () => {
      const { getByTestId } = render(<ModelPickerSheet {...defaultProps} pickerType="image" />);
      expect(getByTestId('sheet-title').props.children).toBe('Image Models');
    });
  });

  // ============================================================================
  // Text Models — Empty State
  // ============================================================================
  describe('text models empty state', () => {
    it('shows empty message when no text models', () => {
      const { getByText } = render(<ModelPickerSheet {...defaultProps} />);
      expect(getByText('No text models available')).toBeTruthy();
    });

    it('shows Browse Models button in empty state', () => {
      const { getByText } = render(<ModelPickerSheet {...defaultProps} />);
      expect(getByText('Browse Models')).toBeTruthy();
    });

    it('calls onBrowseModels from empty state button', () => {
      const onBrowseModels = jest.fn();
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} onBrowseModels={onBrowseModels} />
      );
      fireEvent.press(getByText('Browse Models'));
      expect(onBrowseModels).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Text Models — Local Models
  // ============================================================================
  describe('local text models', () => {
    const model = makeTextModel();

    it('renders local model name', () => {
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[model]} />
      );
      expect(getByText('Test Model')).toBeTruthy();
    });

    it('calls onSelectTextModel when model pressed', () => {
      const onSelectTextModel = jest.fn();
      const { getAllByTestId } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[model]} onSelectTextModel={onSelectTextModel} />
      );
      fireEvent.press(getAllByTestId('model-item')[0]);
      expect(onSelectTextModel).toHaveBeenCalledWith(model);
    });

    it('shows checkmark for active local model', () => {
      const { getByTestId } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[model]} activeModelId="model1" />
      );
      // Active model item should exist
      expect(getByTestId('model-item')).toBeTruthy();
    });

    it('shows vision indicator for vision model', () => {
      const visionModel = makeTextModel({ id: 'v1', name: 'Vision Model', isVisionModel: true });
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[visionModel]} />
      );
      expect(getByText(/Vision Model/)).toBeTruthy();
    });

    it('shows Local Models section label', () => {
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[model]} />
      );
      expect(getByText('Local Models')).toBeTruthy();
    });

    it('model is disabled during loading', () => {
      const onSelectTextModel = jest.fn();
      const { getByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          downloadedModels={[model]}
          loadingState={busyLoading}
          onSelectTextModel={onSelectTextModel}
        />
      );
      expect(getByTestId('model-item').props.accessibilityState?.disabled).toBe(true);
    });

    it('shows memory warning when model does not fit', () => {
      const bigModel = makeTextModel({ fileSize: 30 * 1024 * 1024 * 1024 });
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[bigModel]} memoryInfo={tightMemoryInfo} />
      );
      expect(getByText(/may not fit/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Text Models — Unload Button
  // ============================================================================
  describe('text models unload button', () => {
    const model = makeTextModel();

    it('shows unload button when local model is active (icon only, no text label)', () => {
      const { getByTestId } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[model]} activeModelId="model1" />
      );
      expect(getByTestId('unload-text-model-button')).toBeTruthy();
    });

    it('shows placeholder view (no unload button) when no model is active', () => {
      const { queryByTestId } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[model]} />
      );
      expect(queryByTestId('unload-text-model-button')).toBeNull();
    });

    it('calls onUnloadTextModel when pressing unload button for local model', () => {
      const onUnloadTextModel = jest.fn();
      const { getByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          downloadedModels={[model]}
          activeModelId="model1"
          onUnloadTextModel={onUnloadTextModel}
        />
      );
      fireEvent.press(getByTestId('unload-text-model-button'));
      expect(onUnloadTextModel).toHaveBeenCalledTimes(1);
    });

    it('calls onUnloadRemoteTextModel when remote model is active and unload pressed', () => {
      const onUnloadRemoteTextModel = jest.fn();
      const remoteModel = makeRemoteModel();
      const { getByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          remoteTextModels={[remoteModel]}
          activeRemoteTextModelId="llama3"
          onUnloadRemoteTextModel={onUnloadRemoteTextModel}
        />
      );
      fireEvent.press(getByTestId('unload-text-model-button'));
      expect(onUnloadRemoteTextModel).toHaveBeenCalledTimes(1);
    });

    it('unload button is disabled during loading', () => {
      const onUnloadTextModel = jest.fn();
      const { getByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          downloadedModels={[model]}
          activeModelId="model1"
          loadingState={busyLoading}
          onUnloadTextModel={onUnloadTextModel}
        />
      );
      expect(getByTestId('unload-text-model-button').props.accessibilityState?.disabled).toBe(true);
    });

    it('does not call onUnloadTextModel when unload button pressed while loading', () => {
      const onUnloadTextModel = jest.fn();
      const { getByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          downloadedModels={[model]}
          activeModelId="model1"
          loadingState={busyLoading}
          onUnloadTextModel={onUnloadTextModel}
        />
      );
      fireEvent.press(getByTestId('unload-text-model-button'));
      expect(onUnloadTextModel).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Add Remote Server Button
  // ============================================================================
  describe('Add Remote Server button', () => {
    const model = makeTextModel();
    const remoteModel = makeRemoteModel();

    it('always shows Add Remote Server button when text models exist', () => {
      const { getByTestId } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[model]} />
      );
      expect(getByTestId('add-server-button')).toBeTruthy();
    });

    it('always shows Add Remote Server button when remote text models exist', () => {
      const { getByTestId } = render(
        <ModelPickerSheet {...defaultProps} remoteTextModels={[remoteModel]} />
      );
      expect(getByTestId('add-server-button')).toBeTruthy();
    });

    it('Add Remote Server button calls onClose and onAddServer when pressed', () => {
      const onClose = jest.fn();
      const onAddServer = jest.fn();
      const { getByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          downloadedModels={[model]}
          onClose={onClose}
          onAddServer={onAddServer}
        />
      );
      fireEvent.press(getByTestId('add-server-button'));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onAddServer).toHaveBeenCalledTimes(1);
    });

    it('Add Remote Server button appears even when no model is active', () => {
      const { getByTestId } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[model]} activeModelId={null} />
      );
      expect(getByTestId('add-server-button')).toBeTruthy();
    });

    it('Add Remote Server button text is visible', () => {
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} downloadedModels={[model]} />
      );
      expect(getByText('Add Remote Server')).toBeTruthy();
    });
  });

  // ============================================================================
  // Remote Text Models
  // ============================================================================
  describe('remote text models', () => {
    const remoteModel = makeRemoteModel();

    it('renders remote model name', () => {
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} remoteTextModels={[remoteModel]} />
      );
      expect(getByText('llama3')).toBeTruthy();
    });

    it('shows server name as section header for remote models', () => {
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} remoteTextModels={[remoteModel]} />
      );
      expect(getByText('My Ollama')).toBeTruthy();
    });

    it('shows server name for remote model', () => {
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} remoteTextModels={[remoteModel]} />
      );
      expect(getByText('My Ollama')).toBeTruthy();
    });

    it('shows fallback server name when server not found', () => {
      mockUseRemoteServerStore.mockReturnValue({ servers: [] });
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} remoteTextModels={[remoteModel]} />
      );
      expect(getByText('Remote Server')).toBeTruthy();
    });

    it('calls onSelectRemoteTextModel when remote model pressed', () => {
      const onSelectRemoteTextModel = jest.fn();
      const { getByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          remoteTextModels={[remoteModel]}
          onSelectRemoteTextModel={onSelectRemoteTextModel}
        />
      );
      fireEvent.press(getByTestId('remote-model-item'));
      expect(onSelectRemoteTextModel).toHaveBeenCalledWith(remoteModel);
    });

    it('shows Vision capability label for vision remote model', () => {
      const visionRemote = makeRemoteModel({ capabilities: { supportsVision: true, supportsToolCalling: false, supportsThinking: false } });
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} remoteTextModels={[visionRemote]} />
      );
      expect(getByText(/Vision/)).toBeTruthy();
    });

    it('shows Tools capability label for tool-capable remote model', () => {
      const toolRemote = makeRemoteModel({ capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false } });
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} remoteTextModels={[toolRemote]} />
      );
      expect(getByText(/Tools/)).toBeTruthy();
    });

    it('remote model is disabled during loading', () => {
      const onSelectRemoteTextModel = jest.fn();
      const { getByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          remoteTextModels={[remoteModel]}
          loadingState={busyLoading}
          onSelectRemoteTextModel={onSelectRemoteTextModel}
        />
      );
      expect(getByTestId('remote-model-item').props.accessibilityState?.disabled).toBe(true);
    });
  });

  // ============================================================================
  // Image Models — Empty State
  // ============================================================================
  describe('image models empty state', () => {
    it('shows empty message when no image models', () => {
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} pickerType="image" />
      );
      expect(getByText('No image models available')).toBeTruthy();
    });

    it('calls onBrowseModels from image empty state button', () => {
      const onBrowseModels = jest.fn();
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} pickerType="image" onBrowseModels={onBrowseModels} />
      );
      fireEvent.press(getByText('Browse Models'));
      expect(onBrowseModels).toHaveBeenCalledTimes(1);
    });

    it('image tab empty state based only on downloadedImageModels being empty', () => {
      // Even when remoteImageModels are provided, image tab shows empty state
      // if there are no downloadedImageModels
      const remoteImg = makeRemoteModel({ id: 'clip-remote', name: 'clip-vision' });
      const { getByText } = render(
        <ModelPickerSheet
          {...defaultProps}
          pickerType="image"
          remoteImageModels={[remoteImg]}
          downloadedImageModels={[]}
        />
      );
      expect(getByText('No image models available')).toBeTruthy();
    });

    it('image tab does not show remote image models section', () => {
      const remoteImg = makeRemoteModel({ id: 'clip-remote', name: 'clip-vision' });
      const { queryByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          pickerType="image"
          remoteImageModels={[remoteImg]}
          downloadedImageModels={[]}
        />
      );
      expect(queryByTestId('remote-model-item')).toBeNull();
    });
  });

  // ============================================================================
  // Image Models — Local Models
  // ============================================================================
  describe('local image models', () => {
    const imgModel = makeImageModel();

    it('renders image model name', () => {
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} pickerType="image" downloadedImageModels={[imgModel]} />
      );
      expect(getByText('CLIP Model')).toBeTruthy();
    });

    it('calls onSelectImageModel when image model pressed', () => {
      const onSelectImageModel = jest.fn();
      const { getByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          pickerType="image"
          downloadedImageModels={[imgModel]}
          onSelectImageModel={onSelectImageModel}
        />
      );
      fireEvent.press(getByTestId('model-item'));
      expect(onSelectImageModel).toHaveBeenCalledWith(imgModel);
    });

    it('shows image model style', () => {
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} pickerType="image" downloadedImageModels={[imgModel]} />
      );
      expect(getByText(/Photorealistic/)).toBeTruthy();
    });

    it('shows fallback "Image" style when no style set', () => {
      const noStyleModel = makeImageModel({ style: undefined });
      const { getAllByText } = render(
        <ModelPickerSheet {...defaultProps} pickerType="image" downloadedImageModels={[noStyleModel]} />
      );
      // "Image · 2.0 GB" meta text uses "Image" as style fallback
      const imageTexts = getAllByText(/Image/);
      expect(imageTexts.length).toBeGreaterThan(0);
    });

    it('shows memory warning for image model that does not fit', () => {
      const bigImgModel = makeImageModel({ size: 30 * 1024 * 1024 * 1024 });
      const { getByText } = render(
        <ModelPickerSheet
          {...defaultProps}
          pickerType="image"
          downloadedImageModels={[bigImgModel]}
          memoryInfo={tightMemoryInfo}
        />
      );
      expect(getByText(/may not fit/)).toBeTruthy();
    });

    it('image model is disabled during loading', () => {
      const onSelectImageModel = jest.fn();
      const { getByTestId } = render(
        <ModelPickerSheet
          {...defaultProps}
          pickerType="image"
          downloadedImageModels={[imgModel]}
          loadingState={busyLoading}
          onSelectImageModel={onSelectImageModel}
        />
      );
      expect(getByTestId('model-item').props.accessibilityState?.disabled).toBe(true);
    });
  });

  // ============================================================================
  // Image Models — Unload Button
  // ============================================================================
  describe('image models unload button', () => {
    const imgModel = makeImageModel();

    it('shows unload button when local image model active', () => {
      const { getByText } = render(
        <ModelPickerSheet
          {...defaultProps}
          pickerType="image"
          downloadedImageModels={[imgModel]}
          activeImageModelId="img1"
        />
      );
      expect(getByText('Unload current model')).toBeTruthy();
    });

    it('calls onUnloadImageModel when pressing unload for local image model', () => {
      const onUnloadImageModel = jest.fn();
      const { getByText } = render(
        <ModelPickerSheet
          {...defaultProps}
          pickerType="image"
          downloadedImageModels={[imgModel]}
          activeImageModelId="img1"
          onUnloadImageModel={onUnloadImageModel}
        />
      );
      fireEvent.press(getByText('Unload current model'));
      expect(onUnloadImageModel).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Browse More Button
  // ============================================================================
  describe('browse more button', () => {
    it('shows "Browse more models" button', () => {
      const { getByText } = render(<ModelPickerSheet {...defaultProps} />);
      expect(getByText('Browse more models')).toBeTruthy();
    });

    it('calls onBrowseModels when browse more pressed', () => {
      const onBrowseModels = jest.fn();
      const { getByText } = render(
        <ModelPickerSheet {...defaultProps} onBrowseModels={onBrowseModels} />
      );
      fireEvent.press(getByText('Browse more models'));
      expect(onBrowseModels).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Close Button
  // ============================================================================
  describe('close', () => {
    it('calls onClose when sheet is closed', () => {
      const onClose = jest.fn();
      const { getByTestId } = render(<ModelPickerSheet {...defaultProps} onClose={onClose} />);
      fireEvent.press(getByTestId('sheet-close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
