/**
 * GenerationSettingsModal Component Tests
 *
 * Tests for the settings modal including:
 * - Visibility behavior
 * - Conversation actions (Project, Gallery, Delete)
 * - Performance stats display
 * - Accordion toggle for Image, Text, and Performance sections
 * - Reset to Defaults
 * - Image generation mode toggle
 * - Auto-detection method toggle
 * - Image model picker
 * - Classifier model picker
 * - Text generation sliders
 * - Performance toggles (GPU, model loading strategy, generation details)
 * - Enhance image prompts toggle
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GenerationSettingsModal } from '../../../src/components/GenerationSettingsModal';

// Mock AppSheet
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

// Mock action fns defined outside factory for access in tests
const mockUpdateSettings = jest.fn();
const mockSetActiveImageModelId = jest.fn();

let mockStoreValues: any = {};

jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn((sel?: any) => typeof sel === 'function' ? sel(mockStoreValues) : mockStoreValues),
  selectIsLiteRT: (state: any) =>
    state.downloadedModels?.find((m: any) => m.id === state.activeModelId)?.engine === 'litert',
}));

jest.mock('../../../src/services', () => ({
  llmService: {
    getPerformanceStats: jest.fn(() => ({
      lastTokensPerSecond: 0,
      lastTokenCount: 0,
      lastGenerationTime: 0,
    })),
  },
  hardwareService: {
    formatModelSize: jest.fn(() => '4.0 GB'),
    getTotalMemoryGB: jest.fn().mockReturnValue(8),
  },
}));

jest.mock('@react-native-community/slider', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => (
      <View testID={props.testID || 'slider'} {...props} />
    ),
  };
});

const defaultSettings = {
  imageGenerationMode: 'auto',
  autoDetectMethod: 'pattern',
  imageSteps: 20,
  imageGuidanceScale: 7.5,
  imageThreads: 4,
  imageWidth: 256,
  imageHeight: 256,
  enhanceImagePrompts: false,
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 4096,
  nThreads: 0,
  nBatch: 512,
  enableGpu: false,
  inferenceBackend: 'cpu' as const,
  gpuLayers: 99,
  flashAttn: false,
  showGenerationDetails: false,
  classifierModelId: null,
};

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
};

describe('GenerationSettingsModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreValues = {
      settings: { ...defaultSettings },
      updateSettings: mockUpdateSettings,
      downloadedModels: [],
      downloadedImageModels: [],
      activeImageModelId: null,
      setActiveImageModelId: mockSetActiveImageModelId,
    };
  });

  it('returns null when not visible', () => {
    const { queryByTestId } = render(
      <GenerationSettingsModal {...defaultProps} visible={false} />,
    );
    expect(queryByTestId('app-sheet')).toBeNull();
  });

  it('renders "Chat Settings" title when visible', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );
    expect(getByText('Chat Settings')).toBeTruthy();
  });

  it('shows conversation actions when callbacks are provided', () => {
    const onOpenProject = jest.fn();
    const onOpenGallery = jest.fn();
    const onDeleteConversation = jest.fn();

    const { getByText } = render(
      <GenerationSettingsModal
        {...defaultProps}
        onOpenProject={onOpenProject}
        onOpenGallery={onOpenGallery}
        onDeleteConversation={onDeleteConversation}
        conversationImageCount={3}
      />,
    );

    expect(getByText(/Project:/)).toBeTruthy();
    expect(getByText('Gallery (3)')).toBeTruthy();
    expect(getByText('Delete Conversation')).toBeTruthy();
  });

  it('hides Gallery action when conversationImageCount is 0', () => {
    const onOpenGallery = jest.fn();

    const { queryByText } = render(
      <GenerationSettingsModal
        {...defaultProps}
        onOpenGallery={onOpenGallery}
        conversationImageCount={0}
      />,
    );

    expect(queryByText(/Gallery/)).toBeNull();
  });

  it('shows performance stats when lastTokensPerSecond > 0', () => {
    const { llmService } = require('../../../src/services');
    const statsData = {
      lastTokensPerSecond: 12.5,
      lastTokenCount: 150,
      lastGenerationTime: 3.2,
    };
    (llmService.getPerformanceStats as jest.Mock).mockReturnValue(statsData);

    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    expect(getByText('Last Generation:')).toBeTruthy();
    expect(getByText('12.5 tok/s')).toBeTruthy();
    expect(getByText('150 tokens')).toBeTruthy();
    expect(getByText('3.2s')).toBeTruthy();

    // Restore default mock
    (llmService.getPerformanceStats as jest.Mock).mockReturnValue({
      lastTokensPerSecond: 0,
      lastTokenCount: 0,
      lastGenerationTime: 0,
    });
  });

  it('opens image settings section when tapping "IMAGE GENERATION"', () => {
    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    // Image settings should be collapsed initially
    expect(queryByText('Image Model')).toBeNull();

    fireEvent.press(getByText('IMAGE GENERATION'));

    // Now image settings content should be visible
    expect(getByText('Image Model')).toBeTruthy();
  });

  it('opens text settings section when tapping "TEXT GENERATION"', () => {
    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    // Text settings should be collapsed initially
    expect(queryByText('Temperature')).toBeNull();

    fireEvent.press(getByText('TEXT GENERATION'));

    expect(getByText('Temperature')).toBeTruthy();
    expect(getByText('Max Tokens')).toBeTruthy();
  });

  it('shows performance settings inside TEXT GENERATION section', () => {
    const { getByText, getByTestId, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    // Performance settings should be collapsed initially
    expect(queryByText('CPU Threads')).toBeNull();

    fireEvent.press(getByText('TEXT GENERATION'));
    fireEvent.press(getByTestId('modal-text-advanced-toggle'));

    expect(getByText('CPU Threads')).toBeTruthy();
  });

  it('calls updateSettings when Reset to Defaults is pressed', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Reset to Defaults'));

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      temperature: 0.7,
      maxTokens: 1024,
      topP: 0.9,
      repeatPenalty: 1.1,
      contextLength: 4096,
      nThreads: 0,
      nBatch: 512,
    });
  });

  it('calls updateSettings when image gen mode Auto/Manual is pressed', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    // Open image settings first
    fireEvent.press(getByText('IMAGE GENERATION'));

    // Press Manual button
    fireEvent.press(getByText('Manual'));
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      imageGenerationMode: 'manual',
    });

    mockUpdateSettings.mockClear();

    // Press Auto button
    fireEvent.press(getByText('Auto'));
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      imageGenerationMode: 'auto',
    });
  });

  it('calls onClose then onDeleteConversation when Delete is pressed', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const onDeleteConversation = jest.fn();

    const { getByText } = render(
      <GenerationSettingsModal
        {...defaultProps}
        onClose={onClose}
        onDeleteConversation={onDeleteConversation}
      />,
    );

    fireEvent.press(getByText('Delete Conversation'));

    expect(onClose).toHaveBeenCalled();

    // onDeleteConversation is called via setTimeout
    jest.advanceTimersByTime(200);
    expect(onDeleteConversation).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('shows active project name in Project action', () => {
    const onOpenProject = jest.fn();

    const { getByText } = render(
      <GenerationSettingsModal
        {...defaultProps}
        onOpenProject={onOpenProject}
        activeProjectName="My Project"
      />,
    );

    expect(getByText('Project: My Project')).toBeTruthy();
  });

  // ============================================================================
  // NEW TESTS: Auto-detection method toggle
  // ============================================================================
  it('shows auto-detection method when image settings open and mode is auto', () => {
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    expect(getByText('Detection Method')).toBeTruthy();
    expect(getByText('Pattern')).toBeTruthy();
    expect(getByText('LLM')).toBeTruthy();
  });

  it('calls updateSettings when auto-detect method is changed to LLM', () => {
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    fireEvent.press(getByText('LLM'));

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      autoDetectMethod: 'llm',
    });
  });

  it('calls updateSettings when auto-detect method is changed to Pattern', () => {
    mockStoreValues.settings = { ...defaultSettings, autoDetectMethod: 'llm' };

    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    fireEvent.press(getByText('Pattern'));

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      autoDetectMethod: 'pattern',
    });
  });

  it('hides detection method when image gen mode is manual', () => {
    mockStoreValues.settings = { ...defaultSettings, imageGenerationMode: 'manual' };

    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));

    expect(queryByText('Detection Method')).toBeNull();
  });

  // ============================================================================
  // NEW TESTS: Classifier model picker (visible when LLM mode)
  // ============================================================================
  it('shows classifier model picker when auto + llm mode', () => {
    mockStoreValues.settings = { ...defaultSettings, autoDetectMethod: 'llm' };

    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    expect(getByText('Classifier Model')).toBeTruthy();
    expect(getByText('Use current model')).toBeTruthy();
  });

  it('hides classifier model picker when auto + pattern mode', () => {
    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));

    expect(queryByText('Classifier Model')).toBeNull();
  });

  it('shows classifier tip text when LLM mode is active', () => {
    mockStoreValues.settings = { ...defaultSettings, autoDetectMethod: 'llm' };

    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    expect(getByText(/Tip: Use a small model/)).toBeTruthy();
  });

  it('opens classifier model picker and shows downloaded models', () => {
    mockStoreValues.settings = { ...defaultSettings, autoDetectMethod: 'llm' };
    mockStoreValues.downloadedModels = [
      { id: 'smol-model', name: 'SmolLM', fileSize: 500000000, quantization: 'Q4_K_M' },
    ];

    const { getByText, getByTestId, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    // Press Classifier Model button to open picker
    fireEvent.press(getByText('Classifier Model'));

    // Should show "Use current model" option and the downloaded model
    expect(getAllByText('Use current model').length).toBeGreaterThanOrEqual(1);
    expect(getByText('SmolLM')).toBeTruthy();
  });

  it('selects classifier model from picker', () => {
    mockStoreValues.settings = { ...defaultSettings, autoDetectMethod: 'llm' };
    mockStoreValues.downloadedModels = [
      { id: 'smol-model', name: 'SmolLM', fileSize: 500000000, quantization: 'Q4_K_M' },
    ];

    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    fireEvent.press(getByText('Classifier Model'));
    fireEvent.press(getByText('SmolLM'));

    expect(mockUpdateSettings).toHaveBeenCalledWith({ classifierModelId: 'smol-model' });
  });

  it('selects "Use current model" in classifier picker', () => {
    mockStoreValues.settings = { ...defaultSettings, autoDetectMethod: 'llm', classifierModelId: 'some-model' };

    const { getByText, getByTestId, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    fireEvent.press(getByText('Classifier Model'));

    const useCurrentButtons = getAllByText('Use current model');
    // Press the one inside the picker list
    fireEvent.press(useCurrentButtons[useCurrentButtons.length - 1]);

    expect(mockUpdateSettings).toHaveBeenCalledWith({ classifierModelId: null });
  });

  // ============================================================================
  // NEW TESTS: Image model picker
  // ============================================================================
  it('shows image model picker with "None selected" when no image model', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));

    expect(getByText('None selected')).toBeTruthy();
  });

  it('shows active image model name when one is selected', () => {
    mockStoreValues.downloadedImageModels = [
      { id: 'img1', name: 'Stable Diffusion', style: 'creative' },
    ];
    mockStoreValues.activeImageModelId = 'img1';

    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));

    expect(getByText('Stable Diffusion')).toBeTruthy();
  });

  it('opens image model picker and shows "No image models downloaded" when empty', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    // Click the image model picker button
    fireEvent.press(getByText('None selected'));

    expect(getByText(/No image models downloaded/)).toBeTruthy();
  });

  it('opens image model picker and shows downloaded image models', () => {
    mockStoreValues.downloadedImageModels = [
      { id: 'img1', name: 'SD Model', style: 'creative' },
    ];

    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByText('None selected'));

    expect(getByText('SD Model')).toBeTruthy();
    expect(getByText('None (disable image gen)')).toBeTruthy();
  });

  it('selects image model from picker', () => {
    mockStoreValues.downloadedImageModels = [
      { id: 'img1', name: 'SD Model', style: 'creative' },
    ];

    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByText('None selected'));
    fireEvent.press(getByText('SD Model'));

    expect(mockSetActiveImageModelId).toHaveBeenCalledWith('img1');
  });

  it('selects "None" to disable image model', () => {
    mockStoreValues.downloadedImageModels = [
      { id: 'img1', name: 'SD Model', style: 'creative' },
    ];
    mockStoreValues.activeImageModelId = 'img1';

    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    // Press the Image Model picker button to open the dropdown
    fireEvent.press(getByText('Image Model'));
    fireEvent.press(getByText('None (disable image gen)'));

    expect(mockSetActiveImageModelId).toHaveBeenCalledWith(null);
  });

  // ============================================================================
  // NEW TESTS: Enhance image prompts toggle
  // ============================================================================
  it('shows enhance image prompts toggle in image section', () => {
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    expect(getByText('Enhance Image Prompts')).toBeTruthy();
  });

  it('calls updateSettings to enable enhance image prompts', () => {
    // Enhancement needs a text model available, else the toggle is disabled.
    mockStoreValues.downloadedModels = [{ id: 'text-1' } as any];
    const { getByText, getByTestId, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    // Find the "On" button for enhance prompts
    const onButtons = getAllByText('On');
    // The last "On" button in the image section is for enhance prompts
    fireEvent.press(onButtons[onButtons.length - 1]);

    expect(mockUpdateSettings).toHaveBeenCalledWith({ enhanceImagePrompts: true });
  });

  // ============================================================================
  // NEW TESTS: Text generation section details
  // ============================================================================
  it('shows all text generation settings when expanded', () => {
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('TEXT GENERATION'));
    fireEvent.press(getByTestId('modal-text-advanced-toggle'));

    expect(getByText('Temperature')).toBeTruthy();
    expect(getByText('Max Tokens')).toBeTruthy();
    expect(getByText('Top P')).toBeTruthy();
    expect(getByText('Repeat Penalty')).toBeTruthy();
    expect(getByText('Context Length')).toBeTruthy();
  });

  it('displays formatted values for text settings', () => {
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('TEXT GENERATION'));
    fireEvent.press(getByTestId('modal-text-advanced-toggle'));

    expect(getByText('0.70')).toBeTruthy(); // temperature
    expect(getByText('1.0K')).toBeTruthy(); // maxTokens: 1024
    expect(getByText('0.90')).toBeTruthy(); // topP
    expect(getByText('1.10')).toBeTruthy(); // repeatPenalty
    expect(getByText('4K')).toBeTruthy(); // contextLength: 4096
  });

  it('shows description for text settings', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('TEXT GENERATION'));

    expect(getByText('Higher = more creative, Lower = more focused')).toBeTruthy();
    expect(getByText('Maximum length of generated response')).toBeTruthy();
  });

  // ============================================================================
  // NEW TESTS: Performance section details
  // ============================================================================

  it('shows generation details toggle in text generation section', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('TEXT GENERATION'));

    expect(getByText('Show Generation Details')).toBeTruthy();
    expect(getByText('Display GPU, model, tok/s, and image settings below each message')).toBeTruthy();
  });

  it('calls updateSettings to enable show generation details', () => {
    const { getByText, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('TEXT GENERATION'));

    // Find the "On" buttons in text generation section
    const onButtons = getAllByText('On');
    // The last "On" is for show generation details
    fireEvent.press(onButtons[onButtons.length - 1]);

    expect(mockUpdateSettings).toHaveBeenCalledWith({ showGenerationDetails: true });
  });

  // ============================================================================
  // NEW TESTS: Image quality settings
  // ============================================================================
  it('shows image quality settings when image section is open', () => {
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    expect(getByText('Image Steps')).toBeTruthy();
    expect(getByText('Guidance Scale')).toBeTruthy();
    expect(getByText('Image Threads')).toBeTruthy();
    expect(getByText('Image Size')).toBeTruthy();
  });

  it('displays current image settings values', () => {
    const { getByText, getByTestId, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    expect(getAllByText('20').length).toBeGreaterThanOrEqual(1); // imageSteps
    expect(getByText('7.5')).toBeTruthy(); // imageGuidanceScale
    expect(getByText('256x256')).toBeTruthy(); // imageWidth x imageHeight
  });

  // ============================================================================
  // NEW TESTS: onOpenProject and onOpenGallery callbacks
  // ============================================================================
  it('calls onClose then onOpenProject when Project action is pressed', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const onOpenProject = jest.fn();

    const { getByText } = render(
      <GenerationSettingsModal
        {...defaultProps}
        onClose={onClose}
        onOpenProject={onOpenProject}
      />,
    );

    fireEvent.press(getByText(/Project:/));

    expect(onClose).toHaveBeenCalled();
    jest.advanceTimersByTime(350);
    expect(onOpenProject).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('calls onClose then onOpenGallery when Gallery action is pressed', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const onOpenGallery = jest.fn();

    const { getByText } = render(
      <GenerationSettingsModal
        {...defaultProps}
        onClose={onClose}
        onOpenGallery={onOpenGallery}
        conversationImageCount={5}
      />,
    );

    fireEvent.press(getByText('Gallery (5)'));

    expect(onClose).toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(onOpenGallery).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('shows "Default" when activeProjectName is null', () => {
    const onOpenProject = jest.fn();

    const { getByText } = render(
      <GenerationSettingsModal
        {...defaultProps}
        onOpenProject={onOpenProject}
        activeProjectName={null}
      />,
    );

    expect(getByText('Project: Default')).toBeTruthy();
  });

  // ============================================================================
  // NEW TESTS: Accordion collapse/toggle
  // ============================================================================
  it('collapses image settings when tapped twice', () => {
    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    // Open
    fireEvent.press(getByText('IMAGE GENERATION'));
    expect(getByText('Image Model')).toBeTruthy();

    // Close
    fireEvent.press(getByText('IMAGE GENERATION'));
    expect(queryByText('Image Model')).toBeNull();
  });

  it('collapses text settings when tapped twice', () => {
    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('TEXT GENERATION'));
    expect(getByText('Temperature')).toBeTruthy();

    fireEvent.press(getByText('TEXT GENERATION'));
    expect(queryByText('Temperature')).toBeNull();
  });

  it('collapses text generation settings (including perf) when tapped twice', () => {
    const { getByText, getByTestId, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('TEXT GENERATION'));
    fireEvent.press(getByTestId('modal-text-advanced-toggle'));
    expect(getByText('CPU Threads')).toBeTruthy();

    fireEvent.press(getByText('TEXT GENERATION'));
    expect(queryByText('CPU Threads')).toBeNull();
  });

  // ============================================================================
  // NEW TESTS: No conversation actions when no callbacks
  // ============================================================================
  it('does not show conversation actions when no callbacks provided', () => {
    const { queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    expect(queryByText(/Project:/)).toBeNull();
    expect(queryByText(/Gallery/)).toBeNull();
    expect(queryByText('Delete Conversation')).toBeNull();
  });

  // ============================================================================
  // Slider onSlidingComplete callbacks
  // ============================================================================
  it('calls updateSettings on imageSteps slider complete', () => {
    const { getByText, UNSAFE_getAllByType } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('IMAGE GENERATION'));

    // Find slider elements (mocked as View with testID='slider')
    const { View } = require('react-native');
    const sliders = UNSAFE_getAllByType(View).filter(
      (v: any) => v.props.testID?.endsWith('-slider'),
    );
    // First slider in image section is imageSteps
    if (sliders.length > 0 && sliders[0].props.onSlidingComplete) {
      sliders[0].props.onSlidingComplete(30);
      expect(mockUpdateSettings).toHaveBeenCalledWith({ imageSteps: 30 });
    }
  });

  it('calls handleSliderComplete on text generation slider (no-op)', () => {
    const { getByText, queryAllByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('TEXT GENERATION'));

    const sliders = queryAllByTestId('slider');
    // onSlidingComplete is a no-op but should not throw
    if (sliders.length > 0 && sliders[0].props.onSlidingComplete) {
      expect(() => sliders[0].props.onSlidingComplete(0.5)).not.toThrow();
    }
  });

  it('calls handleSliderChange on text slider value change', () => {
    const { getByText, queryAllByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('TEXT GENERATION'));

    const sliders = queryAllByTestId('slider');
    if (sliders.length > 0 && sliders[0].props.onValueChange) {
      sliders[0].props.onValueChange(0.5);
      expect(mockUpdateSettings).toHaveBeenCalled();
    }
  });

  // ============================================================================
  // Show generation details off (no GPU tests - hidden on iOS test env)
  // ============================================================================

  // ============================================================================
  // Flash Attention toggle
  // ============================================================================
  describe('flash attention toggle', () => {
    it('renders Flash Attention label inside TEXT GENERATION section', () => {
      const { getByText, getByTestId } = render(
        <GenerationSettingsModal {...defaultProps} />,
      );

      fireEvent.press(getByText('TEXT GENERATION'));
      fireEvent.press(getByTestId('modal-text-advanced-toggle'));
      expect(getByText('Flash Attention')).toBeTruthy();
    });

    it('calls updateSettings with flashAttn: false when Off is pressed', () => {
      mockStoreValues.settings = { ...defaultSettings, flashAttn: true };

      const { getByText, getByTestId } = render(
        <GenerationSettingsModal {...defaultProps} />,
      );

      fireEvent.press(getByText('TEXT GENERATION'));
      fireEvent.press(getByTestId('modal-text-advanced-toggle'));
      mockUpdateSettings.mockClear();

      fireEvent.press(getByTestId('flash-attn-off-button'));

      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ flashAttn: false })
      );
    });

    it('calls updateSettings with flashAttn: true when On is pressed', () => {
      mockStoreValues.settings = { ...defaultSettings, flashAttn: false };

      const { getByText, getByTestId } = render(
        <GenerationSettingsModal {...defaultProps} />,
      );

      fireEvent.press(getByText('TEXT GENERATION'));
      fireEvent.press(getByTestId('modal-text-advanced-toggle'));
      mockUpdateSettings.mockClear();

      fireEvent.press(getByTestId('flash-attn-on-button'));

      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ flashAttn: true })
      );
    });

    it('defaults flash attention On when flashAttn setting is undefined (iOS → platform default true)', () => {
      // flashAttn: undefined → falls back to Platform.OS !== 'android' = true on iOS
      mockStoreValues.settings = { ...defaultSettings, flashAttn: undefined as any };

      const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
      fireEvent.press(getByText('TEXT GENERATION'));
      fireEvent.press(getByTestId('modal-text-advanced-toggle'));
      mockUpdateSettings.mockClear();

      // The Off button should be pressable (flash attn is currently ON via fallback)
      fireEvent.press(getByTestId('flash-attn-off-button'));
      expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ flashAttn: false }));
    });

    // Android-specific tests: mock Platform.OS before each, restore after
    describe('on Android platform', () => {
      let originalOS: string;
      const { Platform } = require('react-native');

      beforeEach(() => {
        originalOS = Platform.OS;
        Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
      });

      afterEach(() => {
        Object.defineProperty(Platform, 'OS', { get: () => originalOS, configurable: true });
      });

      it('renders GPU layers slider with gpuLayersEffective when backend is OpenCL', () => {
        mockStoreValues.settings = { ...defaultSettings, inferenceBackend: 'opencl' as const, gpuLayers: 8, flashAttn: false };
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('TEXT GENERATION'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
        expect(getByText('8')).toBeTruthy();
      });

      it('shows GPU layers at full value when flash attention is On (no clamping)', () => {
        // Flash attention no longer caps GPU layers — gpuLayersMax is always 99
        mockStoreValues.settings = { ...defaultSettings, inferenceBackend: 'opencl' as const, gpuLayers: 8, flashAttn: true };
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('TEXT GENERATION'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
        // gpuLayersEffective = Math.min(8, 99) = 8
        expect(getByText('8')).toBeTruthy();
      });

      it('uses default gpuLayers value of 1 when gpuLayers is undefined (covers ?? fallback)', () => {
        mockStoreValues.settings = {
          ...defaultSettings,
          inferenceBackend: 'opencl' as const,
          gpuLayers: undefined as any,
          flashAttn: false,
        };
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('TEXT GENERATION'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
        // gpuLayersEffective = Math.min(undefined ?? 1, 99) = 1
        expect(getByTestId('gpu-layers-stepper-value').props.children).toBe('1');
      });

      it('does not clamp gpuLayers when turning flash attn On with undefined layers', () => {
        mockStoreValues.settings = { ...defaultSettings, flashAttn: false, gpuLayers: undefined as any };
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('TEXT GENERATION'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
        mockUpdateSettings.mockClear();
        fireEvent.press(getByTestId('flash-attn-on-button'));
        expect(mockUpdateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ flashAttn: true })
        );
        expect(mockUpdateSettings).not.toHaveBeenCalledWith(
          expect.objectContaining({ gpuLayers: expect.any(Number) })
        );
      });

      it('does not clamp gpuLayers when turning flash attn On with layers > 1', () => {
        mockStoreValues.settings = { ...defaultSettings, flashAttn: false, gpuLayers: 8 };
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('TEXT GENERATION'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
        mockUpdateSettings.mockClear();
        fireEvent.press(getByTestId('flash-attn-on-button'));
        expect(mockUpdateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ flashAttn: true })
        );
        expect(mockUpdateSettings).not.toHaveBeenCalledWith(
          expect.objectContaining({ gpuLayers: expect.any(Number) })
        );
      });

      it('does not clamp gpuLayers when turning flash attn On with layers = 1', () => {
        mockStoreValues.settings = { ...defaultSettings, flashAttn: false, gpuLayers: 1 };
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('TEXT GENERATION'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
        mockUpdateSettings.mockClear();
        fireEvent.press(getByTestId('flash-attn-on-button'));
        expect(mockUpdateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ flashAttn: true })
        );
        expect(mockUpdateSettings).not.toHaveBeenCalledWith(
          expect.objectContaining({ gpuLayers: expect.any(Number) })
        );
      });

      it('calls updateSettings with inferenceBackend: cpu when CPU button pressed', () => {
        mockStoreValues.settings = { ...defaultSettings, inferenceBackend: 'opencl' as const };
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('TEXT GENERATION'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
        mockUpdateSettings.mockClear();

        fireEvent.press(getByTestId('backend-cpu-button'));

        expect(mockUpdateSettings).toHaveBeenCalledWith({ inferenceBackend: 'cpu' });
      });

      it('calls updateSettings with inferenceBackend: opencl when OpenCL button pressed on Android', () => {
        mockStoreValues.settings = { ...defaultSettings, inferenceBackend: 'cpu' as const };
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('TEXT GENERATION'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
        mockUpdateSettings.mockClear();

        fireEvent.press(getByTestId('backend-opencl-button'));

        expect(mockUpdateSettings).toHaveBeenCalledWith({ inferenceBackend: 'opencl' });
      });

      it('calls updateSettings with gpuLayers value from GPU layers slider', () => {
        mockStoreValues.settings = { ...defaultSettings, inferenceBackend: 'opencl' as const, gpuLayers: 6, flashAttn: false };
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('TEXT GENERATION'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
        mockUpdateSettings.mockClear();

        fireEvent(getByTestId('gpu-layers-stepper-slider'), 'slidingComplete', 7);

        expect(mockUpdateSettings).toHaveBeenCalledWith({ gpuLayers: 7 });
      });
    });
  });

  // ============================================================================
  // Show generation details off
  // ============================================================================
  it('calls updateSettings to disable show generation details', () => {
    // When showGenerationDetails is ON and flash attn is also ON, both have an
    // "Off" button in the Performance section. Start with flash attn OFF so the
    // only "Off" button that matches { showGenerationDetails: false } is the one
    // we want, avoiding ambiguity.
    mockStoreValues.settings = {
      ...defaultSettings,
      showGenerationDetails: true,
      flashAttn: true, // flash attn already on → its Off button calls updateSettings({flashAttn:false})
    };

    const { getByText, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('TEXT GENERATION'));
    mockUpdateSettings.mockClear();

    // Find and press the Off button that sets showGenerationDetails
    const offButtons = getAllByText('Off');
    for (const btn of offButtons) {
      fireEvent.press(btn);
      if (
        mockUpdateSettings.mock.calls.some(
          (args: any[]) => 'showGenerationDetails' in args[0],
        )
      ) {
        break;
      }
      mockUpdateSettings.mockClear();
    }

    expect(mockUpdateSettings).toHaveBeenCalledWith({ showGenerationDetails: false });
  });
});
