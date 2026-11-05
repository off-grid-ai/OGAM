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

import { useAppStore } from '../../../src/stores/appStore';
import { createDownloadedModel, createONNXImageModel } from '../../utils/factories';
import { requireRTL } from '../../harness/nativeBoundary';
import { launchGeneration } from '../../harness/generationDevice';

// The real app store, the real llmService and hardwareService run under the modal: settings reach the
// store through its own actions (updateSettings, setDownloadedModels, ...), and every press is asserted
// on the store state it leaves behind. The slider is a native view, rendered as a View carrying its props.
const settingsNow = () => useAppStore.getState().settings;

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
    const app = useAppStore.getState();
    app.resetSettings();
    app.updateSettings({ ...defaultSettings } as any);
    app.setDownloadedModels([]);
    app.setDownloadedImageModels([]);
    app.setModelMaxContext(null);
  });

  it('returns null when not visible', () => {
    const { queryByTestId } = render(
      <GenerationSettingsModal {...defaultProps} visible={false} />,
    );
    expect(queryByTestId('app-sheet')).toBeNull();
  });

  it('renders "Chat settings" title when visible', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );
    expect(getByText('Chat settings')).toBeTruthy();
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
    expect(getByText('Delete chat')).toBeTruthy();
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

  it('shows no performance stats before anything was generated', () => {
    const { queryByText } = render(<GenerationSettingsModal {...defaultProps} />);
    expect(queryByText('Last reply')).toBeNull();
  });

  it('opens image settings section when tapping "Image generation"', () => {
    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    expect(queryByText('Auto-detect image requests')).toBeNull();

    fireEvent.press(getByText('Image generation'));

    expect(getByText('Auto-detect image requests')).toBeTruthy();
  });

  it('opens text settings section when tapping "Text generation"', () => {
    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    // Text settings should be collapsed initially
    expect(queryByText('Temperature')).toBeNull();

    fireEvent.press(getByText('Text generation'));

    expect(getByText('Temperature')).toBeTruthy();
    expect(getByText('Max tokens')).toBeTruthy();
  });

  it('lets context reach the model 262K limit and caps max tokens at the context', () => {
    useAppStore.getState().setModelMaxContext(262144);
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Text generation'));

    // Output cannot exceed the context that has to hold it, so this surface stops the max-tokens
    // slider at the chosen context while context itself may reach the model's trained ceiling.
    expect(getByTestId('setting-maxTokens-slider').props.maximumValue).toBe(
      settingsNow().contextLength,
    );
    expect(getByTestId('setting-contextLength-slider').props.maximumValue).toBe(262144);
  });

  it('shows performance settings inside TEXT GENERATION section', () => {
    const { getByText, getByTestId, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    // Performance settings should be collapsed initially
    expect(queryByText('CPU threads')).toBeNull();

    fireEvent.press(getByText('Text generation'));
    fireEvent.press(getByTestId('modal-text-advanced-toggle'));

    expect(getByText('CPU threads')).toBeTruthy();
  });

  it('calls the shared reset action when Reset to defaults is pressed', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    // The app's defaults, then a setting moved away from them.
    useAppStore.getState().resetSettings();
    const defaults = { ...settingsNow() };
    useAppStore.getState().updateSettings({ temperature: 1.6 });

    fireEvent.press(getByText('Reset to defaults'));

    // The shared reset action put every setting back to the app's defaults.
    expect(settingsNow()).toEqual(defaults);
  });

  it('keeps transcription model selection out of chat settings', () => {
    const { getByTestId, queryByText, queryByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    expect(queryByText('Transcription model')).toBeNull();
    fireEvent.press(getByTestId('modal-transcription-accordion'));

    expect(queryByText('Transcription model')).toBeNull();
    // The header names the model (a summary); the row that picks one stays in Models.
    expect(queryByTestId('modal-stt-open-picker')).toBeNull();
  });

  it('calls updateSettings when image gen mode Auto/Manual is pressed', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    // Open image settings first
    fireEvent.press(getByText('Image generation'));

    // Press Manual button
    fireEvent.press(getByText('Manual'));
    expect(settingsNow()).toEqual(expect.objectContaining({
      imageGenerationMode: 'manual',
    }));


    // Press Auto button
    fireEvent.press(getByText('Auto'));
    expect(settingsNow()).toEqual(expect.objectContaining({
      imageGenerationMode: 'auto',
    }));
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

    fireEvent.press(getByText('Delete chat'));

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

    fireEvent.press(getByText('Image generation'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    expect(getByText('Detection method')).toBeTruthy();
    expect(getByText('Pattern')).toBeTruthy();
    expect(getByText('LLM')).toBeTruthy();
  });

  it('calls updateSettings when auto-detect method is changed to LLM', () => {
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    fireEvent.press(getByText('LLM'));

    expect(settingsNow()).toEqual(expect.objectContaining({
      autoDetectMethod: 'llm',
    }));
  });

  it('calls updateSettings when auto-detect method is changed to Pattern', () => {
    useAppStore.getState().updateSettings({ ...defaultSettings, autoDetectMethod: 'llm' } as any);

    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    fireEvent.press(getByText('Pattern'));

    expect(settingsNow()).toEqual(expect.objectContaining({
      autoDetectMethod: 'pattern',
    }));
  });

  it('hides detection method when image gen mode is manual', () => {
    useAppStore.getState().updateSettings({ ...defaultSettings, imageGenerationMode: 'manual' } as any);

    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));

    expect(queryByText('Detection method')).toBeNull();
  });

  // ============================================================================
  // NEW TESTS: Classifier model picker (visible when LLM mode)
  // ============================================================================
  it('shows classifier model picker when auto + llm mode', () => {
    useAppStore.getState().updateSettings({ ...defaultSettings, autoDetectMethod: 'llm' } as any);

    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    expect(getByText('Classifier model')).toBeTruthy();
    expect(getByText('Use current model')).toBeTruthy();
  });

  it('hides classifier model picker when auto + pattern mode', () => {
    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));

    expect(queryByText('Classifier model')).toBeNull();
  });

  it('shows classifier tip text when LLM mode is active', () => {
    useAppStore.getState().updateSettings({ ...defaultSettings, autoDetectMethod: 'llm' } as any);

    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    expect(getByText(/Tip: Use a small model/)).toBeTruthy();
  });

  it('opens classifier model picker and shows downloaded models', () => {
    useAppStore.getState().updateSettings({ ...defaultSettings, autoDetectMethod: 'llm' } as any);
    useAppStore.getState().setDownloadedModels([
      createDownloadedModel({ id: 'smol-model', name: 'SmolLM', fileSize: 500000000, quantization: 'Q4_K_M' }),
    ]);

    const { getByText, getByTestId, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    // Press Classifier Model button to open picker
    fireEvent.press(getByText('Classifier model'));

    // Should show "Use current model" option and the downloaded model
    expect(getAllByText('Use current model').length).toBeGreaterThanOrEqual(1);
    expect(getByText('SmolLM')).toBeTruthy();
  });

  it('selects classifier model from picker', () => {
    useAppStore.getState().updateSettings({ ...defaultSettings, autoDetectMethod: 'llm' } as any);
    useAppStore.getState().setDownloadedModels([
      createDownloadedModel({ id: 'smol-model', name: 'SmolLM', fileSize: 500000000, quantization: 'Q4_K_M' }),
    ]);

    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    fireEvent.press(getByText('Classifier model'));
    fireEvent.press(getByText('SmolLM'));

    expect(settingsNow()).toEqual(expect.objectContaining({ classifierModelId: 'smol-model' }));
  });

  it('selects "Use current model" in classifier picker', () => {
    useAppStore.getState().updateSettings({ ...defaultSettings, autoDetectMethod: 'llm', classifierModelId: 'some-model' } as any);

    const { getByText, getByTestId, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    fireEvent.press(getByText('Classifier model'));

    const useCurrentButtons = getAllByText('Use current model');
    // Press the one inside the picker list
    fireEvent.press(useCurrentButtons[useCurrentButtons.length - 1]);

    expect(settingsNow()).toEqual(expect.objectContaining({ classifierModelId: null }));
  });

  it('keeps image model selection out of chat settings', () => {
    useAppStore.getState().setDownloadedImageModels([
      createONNXImageModel({ id: 'img1', name: 'SD Model', style: 'creative' } as any),
    ]);
    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
    expect(queryByText('Image Model')).toBeNull();
    expect(queryByText('SD Model')).toBeNull();
  });

  // ============================================================================
  // NEW TESTS: Enhance image prompts toggle
  // ============================================================================
  it('shows enhance image prompts toggle in image section', () => {
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    expect(getByText('Enhance Image Prompts')).toBeTruthy();
  });

  it('calls updateSettings to enable enhance image prompts', () => {
    // Enhancement needs a text model available, else the toggle is disabled.
    useAppStore.getState().setDownloadedModels([createDownloadedModel({ id: 'text-1' })]);
    const { getByText, getByTestId, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));

    // Find the "On" button for enhance prompts
    const onButtons = getAllByText('On');
    // The last "On" button in the image section is for enhance prompts
    fireEvent.press(onButtons[onButtons.length - 1]);

    expect(settingsNow()).toEqual(expect.objectContaining({ enhanceImagePrompts: true }));
  });

  // ============================================================================
  // NEW TESTS: Text generation section details
  // ============================================================================
  it('shows all text generation settings when expanded', () => {
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Text generation'));
    fireEvent.press(getByTestId('modal-text-advanced-toggle'));

    expect(getByText('Temperature')).toBeTruthy();
    expect(getByText('Max tokens')).toBeTruthy();
    expect(getByText('Top P')).toBeTruthy();
    expect(getByText('Repeat penalty')).toBeTruthy();
    expect(getByText('Context length')).toBeTruthy();
  });

  it('displays formatted values for text settings', () => {
    const { getByText, getAllByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Text generation'));
    fireEvent.press(getByTestId('modal-text-advanced-toggle'));

    expect(getByText('0.70')).toBeTruthy(); // temperature
    expect(getByText('1.0K')).toBeTruthy(); // maxTokens: 1024
    expect(getByText('0.90')).toBeTruthy(); // topP
    expect(getByText('1.10')).toBeTruthy(); // repeatPenalty
    // getAllByText: maxTokens and contextLength both default to 4096 and both format to "4K".
    expect(getAllByText('4K').length).toBeGreaterThan(0); // contextLength: 4096
  });

  it('shows description for text settings', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Text generation'));

    expect(getByText('Higher gives more varied replies. Lower keeps them focused.')).toBeTruthy();
    expect(getByText('How long one reply can get.')).toBeTruthy();
  });

  // ============================================================================
  // NEW TESTS: Performance section details
  // ============================================================================

  it('shows generation details toggle in the General section', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('General'));

    expect(getByText('Show generation details')).toBeTruthy();
    expect(getByText('Applies to all chats. Show context use, model, speed, and image settings below each reply.')).toBeTruthy();
  });

  it('calls updateSettings to enable show generation details', () => {
    const { getByText, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('General'));

    // Find the "On" buttons in the General section
    const onButtons = getAllByText('On');
    // The last "On" is for show generation details
    fireEvent.press(onButtons[onButtons.length - 1]);

    expect(settingsNow()).toEqual(expect.objectContaining({ showGenerationDetails: true }));
  });

  // ============================================================================
  // NEW TESTS: Image quality settings
  // ============================================================================
  it('shows image quality settings when image section is open', () => {
    const { getByText, getByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));
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

    fireEvent.press(getByText('Image generation'));
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
    fireEvent.press(getByText('Image generation'));
    expect(getByText('Auto-detect image requests')).toBeTruthy();

    // Close
    fireEvent.press(getByText('Image generation'));
    expect(queryByText('Auto-detect image requests')).toBeNull();
  });

  it('collapses text settings when tapped twice', () => {
    const { getByText, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Text generation'));
    expect(getByText('Temperature')).toBeTruthy();

    fireEvent.press(getByText('Text generation'));
    expect(queryByText('Temperature')).toBeNull();
  });

  it('collapses text generation settings (including perf) when tapped twice', () => {
    const { getByText, getByTestId, queryByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Text generation'));
    fireEvent.press(getByTestId('modal-text-advanced-toggle'));
    expect(getByText('CPU threads')).toBeTruthy();

    fireEvent.press(getByText('Text generation'));
    expect(queryByText('CPU threads')).toBeNull();
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
    expect(queryByText('Delete chat')).toBeNull();
  });

  // ============================================================================
  // Slider onSlidingComplete callbacks
  // ============================================================================
  it('calls updateSettings on imageSteps slider complete', () => {
    const { getByText, UNSAFE_getAllByType } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Image generation'));

    // Find slider elements (mocked as View with testID='slider')
    const { View } = require('react-native');
    const sliders = UNSAFE_getAllByType(View).filter(
      (v: any) => v.props.testID?.endsWith('-slider'),
    );
    // First slider in image section is imageSteps
    if (sliders.length > 0 && sliders[0].props.onSlidingComplete) {
      sliders[0].props.onSlidingComplete(30);
      expect(settingsNow()).toEqual(expect.objectContaining({ imageSteps: 30 }));
    }
  });

  it('calls handleSliderComplete on text generation slider (no-op)', () => {
    const { getByText, queryAllByTestId } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('Text generation'));

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

    fireEvent.press(getByText('Text generation'));

    const sliders = queryAllByTestId('slider');
    if (sliders.length > 0 && sliders[0].props.onValueChange) {
      const before = { ...settingsNow() };
      sliders[0].props.onValueChange(0.5);
      expect(settingsNow()).not.toEqual(before);
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

      fireEvent.press(getByText('Text generation'));
      fireEvent.press(getByTestId('modal-text-advanced-toggle'));
      expect(getByText('Flash attention')).toBeTruthy();
    });

    it('calls updateSettings with flashAttn: false when Off is pressed', () => {
      useAppStore.getState().updateSettings({ ...defaultSettings, flashAttn: true } as any);

      const { getByText, getByTestId } = render(
        <GenerationSettingsModal {...defaultProps} />,
      );

      fireEvent.press(getByText('Text generation'));
      fireEvent.press(getByTestId('modal-text-advanced-toggle'));

      fireEvent.press(getByTestId('flash-attn-off-button'));

      expect(settingsNow()).toEqual(expect.objectContaining({ flashAttn: false }));
    });

    it('calls updateSettings with flashAttn: true when On is pressed', () => {
      useAppStore.getState().updateSettings({ ...defaultSettings, flashAttn: false } as any);

      const { getByText, getByTestId } = render(
        <GenerationSettingsModal {...defaultProps} />,
      );

      fireEvent.press(getByText('Text generation'));
      fireEvent.press(getByTestId('modal-text-advanced-toggle'));

      fireEvent.press(getByTestId('flash-attn-on-button'));

      expect(settingsNow()).toEqual(expect.objectContaining({ flashAttn: true }));
    });

    it('defaults flash attention On when flashAttn setting is undefined (iOS → platform default true)', () => {
      // flashAttn: undefined → falls back to Platform.OS !== 'android' = true on iOS
      useAppStore.getState().updateSettings({ ...defaultSettings, flashAttn: undefined as any } as any);

      const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
      fireEvent.press(getByText('Text generation'));
      fireEvent.press(getByTestId('modal-text-advanced-toggle'));

      // The Off button should be pressable (flash attn is currently ON via fallback)
      fireEvent.press(getByTestId('flash-attn-off-button'));
      expect(settingsNow()).toEqual(expect.objectContaining({ flashAttn: false }));
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
        useAppStore.getState().updateSettings({ ...defaultSettings, inferenceBackend: 'opencl' as const, gpuLayers: 8, flashAttn: false } as any);
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('General'));
        expect(getByTestId('gpu-layers-stepper-value').props.children).toBe('8');
      });

      it('shows GPU layers at full value when flash attention is On (no clamping)', () => {
        // Flash attention no longer caps GPU layers — gpuLayersMax is always 99
        useAppStore.getState().updateSettings({ ...defaultSettings, inferenceBackend: 'opencl' as const, gpuLayers: 8, flashAttn: true } as any);
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('General'));
        // gpuLayersEffective = Math.min(8, 99) = 8
        expect(getByTestId('gpu-layers-stepper-value').props.children).toBe('8');
      });

      it('uses default gpuLayers value of 1 when gpuLayers is undefined (covers ?? fallback)', () => {
        useAppStore.getState().updateSettings({
          ...defaultSettings,
          inferenceBackend: 'opencl' as const,
          gpuLayers: undefined as any,
          flashAttn: false,
        } as any);
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('General'));
        // gpuLayersEffective = Math.min(undefined ?? 1, 99) = 1
        expect(getByTestId('gpu-layers-stepper-value').props.children).toBe('1');
      });

      it('does not clamp gpuLayers when turning flash attn On with undefined layers', () => {
        useAppStore.getState().updateSettings({ ...defaultSettings, flashAttn: false, gpuLayers: undefined as any } as any);
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('Text generation'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
          const gpuLayersBefore = settingsNow().gpuLayers;
        fireEvent.press(getByTestId('flash-attn-on-button'));
        expect(settingsNow()).toEqual(expect.objectContaining({ flashAttn: true }));
        // Turning flash attention on left the GPU layers as they were.
        expect(settingsNow().gpuLayers).toBe(gpuLayersBefore);
      });

      it('does not clamp gpuLayers when turning flash attn On with layers > 1', () => {
        useAppStore.getState().updateSettings({ ...defaultSettings, flashAttn: false, gpuLayers: 8 } as any);
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('Text generation'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
          const gpuLayersBefore = settingsNow().gpuLayers;
        fireEvent.press(getByTestId('flash-attn-on-button'));
        expect(settingsNow()).toEqual(expect.objectContaining({ flashAttn: true }));
        // Turning flash attention on left the GPU layers as they were.
        expect(settingsNow().gpuLayers).toBe(gpuLayersBefore);
      });

      it('does not clamp gpuLayers when turning flash attn On with layers = 1', () => {
        useAppStore.getState().updateSettings({ ...defaultSettings, flashAttn: false, gpuLayers: 1 } as any);
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('Text generation'));
        fireEvent.press(getByTestId('modal-text-advanced-toggle'));
          const gpuLayersBefore = settingsNow().gpuLayers;
        fireEvent.press(getByTestId('flash-attn-on-button'));
        expect(settingsNow()).toEqual(expect.objectContaining({ flashAttn: true }));
        // Turning flash attention on left the GPU layers as they were.
        expect(settingsNow().gpuLayers).toBe(gpuLayersBefore);
      });

      it('calls updateSettings with inferenceBackend: cpu when CPU button pressed', () => {
        useAppStore.getState().updateSettings({ ...defaultSettings, inferenceBackend: 'opencl' as const } as any);
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('General'));
  
        fireEvent.press(getByTestId('backend-cpu-button'));

        expect(settingsNow()).toEqual(expect.objectContaining({ inferenceBackend: 'cpu' }));
      });

      it('calls updateSettings with inferenceBackend: opencl when OpenCL button pressed on Android', () => {
        useAppStore.getState().updateSettings({ ...defaultSettings, inferenceBackend: 'cpu' as const } as any);
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('General'));
  
        fireEvent.press(getByTestId('backend-opencl-button'));

        expect(settingsNow()).toEqual(expect.objectContaining({ inferenceBackend: 'opencl' }));
      });

      it('calls updateSettings with gpuLayers value from GPU layers slider', () => {
        useAppStore.getState().updateSettings({ ...defaultSettings, inferenceBackend: 'opencl' as const, gpuLayers: 6, flashAttn: false } as any);
        const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
        fireEvent.press(getByText('General'));
  
        fireEvent(getByTestId('gpu-layers-stepper-slider'), 'slidingComplete', 7);

        expect(settingsNow()).toEqual(expect.objectContaining({ gpuLayers: 7 }));
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
    useAppStore.getState().updateSettings({
      ...defaultSettings,
      showGenerationDetails: true,
      flashAttn: true, // flash attn already on → its Off button calls updateSettings({flashAttn:false})
    } as any);

    const { getByText, getAllByText } = render(
      <GenerationSettingsModal {...defaultProps} />,
    );

    fireEvent.press(getByText('General'));

    // Find and press the Off button that sets showGenerationDetails
    const offButtons = getAllByText('Off');
    for (const btn of offButtons) {
      fireEvent.press(btn);
      if (!settingsNow().showGenerationDetails) break;
    }

    expect(settingsNow()).toEqual(expect.objectContaining({ showGenerationDetails: false }));
  });
});

describe('GenerationSettingsModal performance stats', () => {
  it('shows the last generation stats after the model answers', async () => {
    // A phone with a loaded model answers once; the real llmService records the run's stats.
    const device = await launchGeneration();
    device.boundary.llama!.scriptCompletion({ text: 'One two three four five.' });
    // The clock moves on while the answer streams, as it does on a phone.
    let now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => (now += 40));
    await device.generationService.generateResponse(device.conversationId, device.ask('Count to five'));
    clock.mockRestore();
    const stats = device.llmService.getPerformanceStats();
    expect(stats.lastTokensPerSecond).toBeGreaterThan(0);
    expect(stats.lastTokenCount).toBeGreaterThan(0);

    const FreshReact = require('react');
    const rtl = requireRTL();
    const { GenerationSettingsModal: Modal } = require('../../../src/components/GenerationSettingsModal');
    const { getByText } = rtl.render(FreshReact.createElement(Modal, defaultProps));

    expect(getByText('Last reply')).toBeTruthy();
    expect(getByText(`${stats.lastTokenCount} tokens`)).toBeTruthy();
    expect(getByText(/tok\/s$/)).toBeTruthy();
  });
});
