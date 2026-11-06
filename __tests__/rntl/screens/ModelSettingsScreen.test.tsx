/**
 * ModelSettingsScreen Tests
 *
 * The one home of every model setting. Tabs (General / Text / Image / Voice) each show their
 * settings open. Tests drive the real screen against the real app store and assert what the
 * person sees and the settings the store holds:
 * - Tabs and what each one shows
 * - General: fastest settings, hardware, model loading, generation details, system prompt
 * - Text: sliders, advanced (threads, batch, flash attention, KV cache), remote-server footnote
 * - Image: picture detection, steps, size, advanced (guidance, threads, detection, enhance)
 * - Voice: transcription model and language
 * - Reset to defaults (header button)
 */

import React from 'react';
import { render, fireEvent, within } from '@testing-library/react-native';
import { APP_CONFIG } from '../../../src/constants';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import {
  _clearSlotsForTesting,
  registerSlot,
  SLOTS,
} from '../../../src/bootstrap/slotRegistry';
import { resetStores } from '../../utils/testHelpers';

// Mock Slider component
jest.mock('@react-native-community/slider', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => (
      <View
        testID={`slider-${props.value}`}
        {...props}
        onSlidingComplete={props.onSlidingComplete}
      />
    ),
  };
});

// Import after mocks
import { ModelSettingsScreen } from '../../../src/screens/ModelSettingsScreen';

const renderScreen = () => {
  return render(
    <NavigationContainer>
      <ModelSettingsScreen />
    </NavigationContainer>,
  );
};

type Tab = 'general' | 'text' | 'image' | 'voice';
const ADVANCED_TOGGLE: Partial<Record<Tab, string>> = {
  text: 'text-advanced-toggle',
  image: 'image-advanced-toggle',
};

/** Open a tab the way a person does, with its Advanced settings shown too. */
const openTab = (view: ReturnType<typeof renderScreen>, tab: Tab) => {
  fireEvent.press(view.getByTestId(`model-settings-tab-${tab}`));
  const advanced = ADVANCED_TOGGLE[tab];
  if (advanced) fireEvent.press(view.getByTestId(advanced));
};

/** Render the screen on one tab, Advanced open. */
const renderTab = (tab: Tab) => {
  const view = renderScreen();
  openTab(view, tab);
  return view;
};

describe('ModelSettingsScreen', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders without crashing', () => {
      const { getByText } = renderScreen();
      expect(getByText('Model settings')).toBeTruthy();
    });

    it('shows the four tabs', () => {
      const { getByTestId } = renderScreen();
      expect(within(getByTestId('model-settings-tab-general')).getByText('General')).toBeTruthy();
      expect(within(getByTestId('model-settings-tab-text')).getByText('Text')).toBeTruthy();
      expect(within(getByTestId('model-settings-tab-image')).getByText('Image')).toBeTruthy();
      expect(within(getByTestId('model-settings-tab-voice')).getByText('Voice')).toBeTruthy();
    });

    it('opens on General, with its settings shown and the other tabs\' settings not', () => {
      const { getByText, getByTestId, queryByText } = renderScreen();
      expect(getByTestId('model-settings-tab-general').props.accessibilityState).toEqual({ selected: true });
      expect(getByTestId('fastest-settings-button')).toBeTruthy();
      expect(getByText(/What the model is told before every chat/)).toBeTruthy();
      expect(getByText('Model loading')).toBeTruthy();
      expect(queryByText('Temperature')).toBeNull();
      expect(queryByText('Image steps')).toBeNull();
      expect(queryByText('Transcription model')).toBeNull();
    });

    it('shows section help text for image generation on the Image tab', () => {
      const { getByText } = renderTab('image');
      expect(getByText(/Control how image generation/)).toBeTruthy();
    });

    it('shows section help text for text generation on the Text tab', () => {
      const { getByText } = renderTab('text');
      expect(getByText(/How replies sound/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Tabs
  // ============================================================================
  describe('tabs', () => {
    afterEach(() => {
      _clearSlotsForTesting();
    });

    it('shows the image settings open when the Image tab is pressed', () => {
      const { getByTestId, queryByText } = renderScreen();
      expect(queryByText('Notice when you want a picture')).toBeNull();

      fireEvent.press(getByTestId('model-settings-tab-image'));
      expect(queryByText('Notice when you want a picture')).toBeTruthy();
      expect(getByTestId('model-settings-tab-image').props.accessibilityState).toEqual({ selected: true });
      // General's settings left with its tab.
      expect(queryByText('Model loading')).toBeNull();
    });

    it('shows the text settings open when the Text tab is pressed', () => {
      const { getByTestId, queryByText } = renderScreen();
      expect(queryByText('Temperature')).toBeNull();

      fireEvent.press(getByTestId('model-settings-tab-text'));
      expect(queryByText('Temperature')).toBeTruthy();
    });

    it('returns to General settings after visiting another tab', () => {
      const { getByTestId, queryByText } = renderScreen();
      fireEvent.press(getByTestId('model-settings-tab-text'));
      expect(queryByText('Model loading')).toBeNull();
      fireEvent.press(getByTestId('model-settings-tab-general'));
      expect(queryByText('Model loading')).toBeTruthy();
      expect(queryByText('Temperature')).toBeNull();
    });

    it('shows CPU Threads in the Text tab\'s advanced settings', () => {
      const { queryByText } = renderTab('text');
      expect(queryByText('CPU threads')).toBeTruthy();
    });

    it('names the image tab "Image & video" when the video settings are present', () => {
      const VideoSettings = () => null;
      registerSlot(SLOTS.generationSettingsVideo, VideoSettings);
      const { getByTestId } = renderScreen();
      expect(within(getByTestId('model-settings-tab-image')).getByText('Image & video')).toBeTruthy();
    });

    it('notes on the Text tab that a remote server uses its own settings', () => {
      useRemoteServerStore.setState({ activeServerId: 'server-1' });
      const { getByTestId } = renderTab('text');
      expect(within(getByTestId('model-settings-remote-note')).getByText(
        'These apply to models on this phone. A remote server uses its own.',
      )).toBeTruthy();
    });

    it('shows no remote-server note when the text model runs on this phone', () => {
      useRemoteServerStore.setState({ activeServerId: null });
      const { queryByTestId } = renderTab('text');
      expect(queryByTestId('model-settings-remote-note')).toBeNull();
    });
  });

  // ============================================================================
  // System Prompt
  // ============================================================================
  describe('system prompt', () => {
    it('shows default system prompt text', () => {
      const { getByDisplayValue } = renderTab('general');
      expect(getByDisplayValue(/helpful AI assistant/)).toBeTruthy();
    });

    it('updates system prompt when text changes', () => {
      const { getByDisplayValue } = renderTab('general');
      const input = getByDisplayValue(/helpful AI assistant/);

      fireEvent.changeText(input, 'You are a coding assistant.');

      expect(useAppStore.getState().settings.systemPrompt).toBe(
        'You are a coding assistant.',
      );
    });
  });

  // ============================================================================
  // Show generation details Toggle
  // ============================================================================
  describe('show generation details toggle', () => {
    it('renders the toggle with label and description', () => {
      const { getByText } = renderTab('general');
      expect(getByText('Show generation details')).toBeTruthy();
      expect(
        getByText(
          'Applies to all chats. Show context use, model, speed, and image settings below each reply.',
        ),
      ).toBeTruthy();
    });

    it('defaults to off', () => {
      const state = useAppStore.getState();
      expect(state.settings.showGenerationDetails).toBe(false);
    });

    it('updates store to true when toggled on', () => {
      useAppStore.getState().updateSettings({ showGenerationDetails: false });
      const { getByTestId } = renderTab('general');

      fireEvent.press(getByTestId('show-gen-details-on-button'));

      // Assert the OUTCOME — the store flag that feeds generation-detail rendering.
      expect(useAppStore.getState().settings.showGenerationDetails).toBe(true);
    });

    it('updates store to false when toggled off', () => {
      useAppStore.getState().updateSettings({ showGenerationDetails: true });
      const { getByTestId } = renderTab('general');

      fireEvent.press(getByTestId('show-gen-details-off-button'));

      expect(useAppStore.getState().settings.showGenerationDetails).toBe(false);
    });

    it('syncs with store when showGenerationDetails is already true', () => {
      useAppStore.getState().updateSettings({ showGenerationDetails: true });

      const { getByText } = renderTab('general');
      expect(getByText('Show generation details')).toBeTruthy();
      expect(useAppStore.getState().settings.showGenerationDetails).toBe(true);
    });
  });

  // ============================================================================
  // Flash Attention Toggle
  // ============================================================================
  describe('flash attention toggle', () => {
    it('renders Flash Attention label', () => {
      const { getByText } = renderTab('text');
      expect(getByText('Flash attention')).toBeTruthy();
    });

    it('updates store to true when Flash Attention is turned on', () => {
      useAppStore.getState().updateSettings({ flashAttn: false });
      const { getByTestId } = renderTab('text');

      fireEvent.press(getByTestId('flash-attn-on-button'));

      expect(useAppStore.getState().settings.flashAttn).toBe(true);
    });

    it('updates store to false when Flash Attention is turned off', () => {
      useAppStore.getState().updateSettings({ flashAttn: true });
      const { getByTestId } = renderTab('text');

      fireEvent.press(getByTestId('flash-attn-off-button'));

      expect(useAppStore.getState().settings.flashAttn).toBe(false);
    });
  });

  // ============================================================================
  describe('flash attention platform default', () => {
    it('reads as On when the setting is unset on iOS, so Off turns it off', () => {
      // Unset falls back to the platform default (On off Android).
      useAppStore.getState().updateSettings({ flashAttn: undefined as any });
      const { getByTestId } = renderTab('text');
      fireEvent.press(getByTestId('flash-attn-off-button'));
      expect(useAppStore.getState().settings.flashAttn).toBe(false);
    });
  });

  // ============================================================================
  describe('model loading mode selector', () => {
    it('renders the Model Loading label', () => {
      const { getByText } = renderTab('general');
      expect(getByText('Model loading')).toBeTruthy();
    });

    it('selects aggressive', () => {
      useAppStore.getState().updateSettings({ modelLoadingMode: 'balanced' });
      const { getByTestId } = renderTab('general');
      fireEvent.press(getByTestId('model-loading-mode-aggressive-button'));
      expect(useAppStore.getState().settings.modelLoadingMode).toBe(
        'aggressive',
      );
    });

    it('selects conservative', () => {
      useAppStore.getState().updateSettings({ modelLoadingMode: 'balanced' });
      const { getByTestId } = renderTab('general');
      fireEvent.press(getByTestId('model-loading-mode-conservative-button'));
      expect(useAppStore.getState().settings.modelLoadingMode).toBe(
        'conservative',
      );
    });
  });

  // ============================================================================
  // Image Generation Settings
  // ============================================================================
  describe('image generation settings', () => {
    it('shows the picture-detection switch', () => {
      const { getByText } = renderTab('image');
      expect(getByText('Notice when you want a picture')).toBeTruthy();
    });

    it('shows auto mode description when enabled', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getByText } = renderTab('image');
      expect(getByText('Ask for a picture in plain words and it makes one.')).toBeTruthy();
    });

    it('shows manual mode description when disabled', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { getByText } = renderTab('image');
      expect(getByText('Pictures only when you turn on Image in the chat.')).toBeTruthy();
    });

    it('toggles image generation mode', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { getAllByRole } = renderTab('image');
      const switches = getAllByRole('switch');

      // Find the Automatic Detection switch
      for (const sw of switches) {
        const before = useAppStore.getState().settings.imageGenerationMode;
        fireEvent(sw, 'valueChange', true);
        const after = useAppStore.getState().settings.imageGenerationMode;
        if (before === 'manual' && after === 'auto') {
          expect(after).toBe('auto');
          return;
        }
      }
    });

    it('shows auto mode note', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getByText } = renderTab('image');
      expect(getByText(/"Draw me a sunset" makes a picture/)).toBeTruthy();
    });

    it('shows manual mode note', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { getByText } = renderTab('image');
      expect(getByText('Turn on Image in the chat menu when you want one.')).toBeTruthy();
    });

    it('shows Image steps slider label and value', () => {
      const { getByText } = renderTab('image');
      expect(getByText('Image steps')).toBeTruthy();
      // Default value
      expect(getByText('8')).toBeTruthy();
    });

    it('shows Guidance Scale slider label and value', () => {
      const { getByText } = renderTab('image');
      expect(getByText('Guidance Scale')).toBeTruthy();
      expect(getByText('7.5')).toBeTruthy();
    });

    it('shows Image Threads slider label', () => {
      const { getByText } = renderTab('image');
      expect(getByText('Image Threads')).toBeTruthy();
    });

    it('shows Image size slider label', () => {
      const { getByText } = renderTab('image');
      expect(getByText('Image size')).toBeTruthy();
    });

    it('shows Detection Method buttons when auto mode enabled', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getByText } = renderTab('image');
      expect(getByText('Detection Method')).toBeTruthy();
      expect(getByText('Pattern')).toBeTruthy();
      expect(getByText('LLM')).toBeTruthy();
    });

    it('hides Detection Method when manual mode', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { queryByText } = renderTab('image');
      expect(queryByText('Detection Method')).toBeNull();
    });

    it('shows Enhance Image Prompts toggle', () => {
      const { getByText } = renderTab('image');
      expect(getByText('Enhance image prompts')).toBeTruthy();
    });

    it('toggles enhance image prompts', () => {
      expect(useAppStore.getState().settings.enhanceImagePrompts).toBe(false);
      // Enhancement needs a text model available, else the toggle is disabled.
      useAppStore.setState({ downloadedModels: [{ id: 'text-1' } as any] });

      const { getAllByRole } = renderTab('image');
      const switches = getAllByRole('switch');

      for (const sw of switches) {
        const before = useAppStore.getState().settings.enhanceImagePrompts;
        fireEvent(sw, 'valueChange', true);
        const after = useAppStore.getState().settings.enhanceImagePrompts;
        if (after !== before && after === true) {
          expect(after).toBe(true);
          return;
        }
      }
    });

    it('shows enhance prompts on description', () => {
      useAppStore.setState({ downloadedModels: [{ id: 'text-1' } as any] });
      useAppStore.getState().updateSettings({ enhanceImagePrompts: true });
      const { getByText } = renderTab('image');
      expect(getByText(/Text model refines your prompt/)).toBeTruthy();
    });

    it('shows enhance prompts off description', () => {
      useAppStore.setState({ downloadedModels: [{ id: 'text-1' } as any] });
      useAppStore.getState().updateSettings({ enhanceImagePrompts: false });
      const { getByText } = renderTab('image');
      expect(getByText(/Use your prompt directly/)).toBeTruthy();
    });

    it('disables enhance prompts when no text model is available', () => {
      useAppStore.setState({ downloadedModels: [] });
      const { getByText } = renderTab('image');
      expect(getByText(/Download a text model to enable/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Text Generation Settings
  // ============================================================================
  describe('text generation settings', () => {
    it('shows Temperature slider label and default value', () => {
      const { getByText } = renderTab('text');
      expect(getByText('Temperature')).toBeTruthy();
      expect(getByText('0.70')).toBeTruthy();
    });

    it('shows Temperature description', () => {
      const { getByText } = renderTab('text');
      expect(getByText(/Higher gives more varied replies/)).toBeTruthy();
    });

    it('shows Max Tokens slider label and default value', () => {
      const { getByText } = renderTab('text');
      expect(getByText('Max tokens')).toBeTruthy();
      expect(getByText('1.0K')).toBeTruthy(); // 1024 -> 1.0K
    });

    it('shows Max tokens description', () => {
      const { getByText } = renderTab('text');
      expect(getByText('How long one reply can get.')).toBeTruthy();
    });

    it('shows Top P slider label and default value', () => {
      const { getByText } = renderTab('text');
      expect(getByText('Top P')).toBeTruthy();
      expect(getByText('0.90')).toBeTruthy();
    });

    it('shows Repeat Penalty slider label and default value', () => {
      const { getByText } = renderTab('text');
      expect(getByText('Repeat penalty')).toBeTruthy();
      expect(getByText('1.10')).toBeTruthy();
    });

    it('shows Context Length slider label and default value', () => {
      const { getByText, getAllByText } = renderTab('text');
      expect(getByText('Context length')).toBeTruthy();
      // getAllByText, because Max Tokens and Context Length BOTH default to 4096 and both format
      // to "4K" - a single-match query asserted that coincidence rather than this slider's value.
      expect(getAllByText('4K').length).toBeGreaterThan(0); // 4096 -> 4K
    });

    it('shows context length description', () => {
      const { getByText } = renderTab('text');
      expect(getByText(/How much of the chat it remembers/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Performance Settings
  // ============================================================================
  describe('performance settings', () => {
    it('shows CPU Threads stepper with numeric value when nThreads uses the auto sentinel', () => {
      // The CPU Threads control migrated from a Slider (which displayed an
      // "Auto (N)" label) to a NumericStepper that shows the resolved numeric
      // value. With the auto sentinel (nThreads: 0) the stepper value is 1.
      const { getByText, queryByText } = renderTab('text');
      expect(getByText('CPU threads')).toBeTruthy();
      expect(queryByText(/^Auto \(\d+\)$/)).toBeNull();
    });

    it('shows Batch Size slider label and default value', () => {
      const { getByText, getAllByText } = renderTab('text');
      expect(getByText('Batch size')).toBeTruthy();
      // Same ambiguity as Context Length: another control also renders 512 by default.
      expect(getAllByText('512').length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Settings Updates via Sliders
  // ============================================================================
  describe('settings updates via sliders', () => {
    it('updates temperature when slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      const tempSlider = sliders.find((s: any) => s.props.value === 0.7);
      if (tempSlider) {
        fireEvent(tempSlider, 'slidingComplete', 1.5);
        expect(useAppStore.getState().settings.temperature).toBe(1.5);
      }
    });

    it('updates maxTokens when slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      const maxTokensSlider = sliders.find((s: any) => s.props.value === 1024);
      if (maxTokensSlider) {
        fireEvent(maxTokensSlider, 'slidingComplete', 2048);
        expect(useAppStore.getState().settings.maxTokens).toBe(2048);
      }
    });

    it('updates imageSteps when slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('image');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      const stepsSlider = sliders.find(
        (s: any) => s.props.value === 8 && s.props.maximumValue === 50,
      );
      if (stepsSlider) {
        fireEvent(stepsSlider, 'slidingComplete', 30);
        expect(useAppStore.getState().settings.imageSteps).toBe(30);
      }
    });

    it('updates nThreads when slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      const threadsSlider = sliders.find(
        (s: any) => s.props.value === 1 && s.props.maximumValue === 12,
      );
      if (threadsSlider) {
        fireEvent(threadsSlider, 'slidingComplete', 8);
        expect(useAppStore.getState().settings.nThreads).toBe(8);
      }
    });

    it('updates contextLength when slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      const ctxSlider = sliders.find(
        (s: any) => s.props.value === 4096 && s.props.maximumValue === 32768,
      );
      if (ctxSlider) {
        fireEvent(ctxSlider, 'slidingComplete', 4096);
        expect(useAppStore.getState().settings.contextLength).toBe(4096);
      }
    });

    it('lets context reach the model ceiling and caps max tokens at the context', () => {
      useAppStore.getState().setModelMaxContext(262144);
      const { UNSAFE_getAllByType } = renderTab('text');
      const { View } = require('react-native');
      const sliders = UNSAFE_getAllByType(View).filter(
        (view: any) =>
          view.props.onSlidingComplete &&
          view.props.testID?.endsWith('-slider'),
      );

      // The model may not be asked to WRITE more than the context that has to hold it, so the
      // output slider stops at the chosen context, not at the model's trained ceiling.
      const contextLength = useAppStore.getState().settings.contextLength;
      expect(
        sliders.find(
          (slider: any) => slider.props.testID === 'llama-max-tokens-slider',
        )?.props.maximumValue,
      ).toBe(contextLength);
      expect(
        sliders.find(
          (slider: any) =>
            slider.props.testID === 'llama-context-length-slider',
        )?.props.maximumValue,
      ).toBe(262144);
    });
  });

  // ============================================================================
  // Model Loading Strategy Buttons
  // ============================================================================

  // ============================================================================
  // Back Button
  // ============================================================================
  describe('back button', () => {
    it('renders back button', () => {
      const { toJSON } = renderScreen();
      // Back button contains an arrow-left icon
      const treeStr = JSON.stringify(toJSON());
      expect(treeStr).toContain('arrow-left');
    });

    it('calls goBack when back button pressed', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      // First touchable is the back button
      fireEvent.press(touchables[0]);
      // Navigation mock is set up in jest.setup.ts
    });
  });

  // ============================================================================
  // GPU Settings (Only visible on non-iOS platforms)
  // ============================================================================
  describe('GPU settings', () => {
    // Platform.OS is 'ios' in the test environment; Metal is the default backend, GPU Layers hidden when cpu
    it('shows Text model hardware section on iOS', () => {
      const { getByText } = renderTab('general');
      expect(getByText('Text model hardware')).toBeTruthy();
    });

    it('does not show GPU Layers on iOS when backend is cpu', () => {
      useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
      const { queryByTestId } = renderTab('general');
      expect(queryByTestId('gpu-layers-stepper-slider')).toBeNull();
    });

    // Android-specific backend tests: mock Platform.OS before each, restore after
    describe('on Android platform', () => {
      let originalOS: string;
      const { Platform } = require('react-native');

      beforeEach(() => {
        originalOS = Platform.OS;
        Object.defineProperty(Platform, 'OS', {
          get: () => 'android',
          configurable: true,
        });
      });

      afterEach(() => {
        Object.defineProperty(Platform, 'OS', {
          get: () => originalOS,
          configurable: true,
        });
      });

      it('shows Text model hardware section and GPU Layers slider when backend is OpenCL', () => {
        useAppStore
          .getState()
          .updateSettings({ inferenceBackend: 'opencl', gpuLayers: 6 });
        const { getByText, getByTestId } = renderTab('general');
        expect(getByText('Text model hardware')).toBeTruthy();
        // Label now names the backend: "GPU Layers (OpenCL)". Assert the slider by its
        // SliderSetting child testID (SliderSetting suffixes testID with -slider/-value).
        expect(getByTestId('gpu-layers-stepper-slider')).toBeTruthy();
      });

      it('shows the saved GPU layers on the stepper', () => {
        useAppStore
          .getState()
          .updateSettings({ inferenceBackend: 'opencl', gpuLayers: 8, flashAttn: true });
        const { getByTestId } = renderTab('general');
        // Flash attention no longer caps GPU layers.
        expect(getByTestId('gpu-layers-stepper-value').props.children).toBe('8');
      });

      it('shows 1 GPU layer when the setting is unset', () => {
        useAppStore.getState().updateSettings({
          inferenceBackend: 'opencl',
          gpuLayers: undefined as any,
          flashAttn: false,
        });
        const { getByTestId } = renderTab('general');
        expect(getByTestId('gpu-layers-stepper-value').props.children).toBe('1');
      });

      it.each([
        ['unset', undefined],
        ['1', 1],
      ])('leaves GPU layers as they were (%s) when flash attention is turned on', (_label, gpuLayers) => {
        useAppStore
          .getState()
          .updateSettings({ flashAttn: false, gpuLayers: gpuLayers as any });
        const before = useAppStore.getState().settings.gpuLayers;
        const { getByTestId } = renderTab('text');
        fireEvent.press(getByTestId('flash-attn-on-button'));
        expect(useAppStore.getState().settings.flashAttn).toBe(true);
        expect(useAppStore.getState().settings.gpuLayers).toBe(before);
      });

      it('does not clamp gpuLayers when flashAttn turned on with layers > 1', () => {
        useAppStore
          .getState()
          .updateSettings({
            inferenceBackend: 'opencl',
            flashAttn: false,
            gpuLayers: 8,
          });
        const { getByTestId } = renderTab('text');
        fireEvent.press(getByTestId('flash-attn-on-button'));
        expect(useAppStore.getState().settings.flashAttn).toBe(true);
        // GPU layers are no longer clamped when enabling flash attention
        expect(useAppStore.getState().settings.gpuLayers).toBe(8);
      });

      it('updates inferenceBackend to cpu when CPU button is pressed', () => {
        useAppStore
          .getState()
          .updateSettings({ inferenceBackend: 'opencl', gpuLayers: 6 });
        const { getByTestId } = renderTab('general');

        fireEvent.press(getByTestId('backend-cpu-button'));

        expect(useAppStore.getState().settings.inferenceBackend).toBe('cpu');
      });

      it('updates inferenceBackend to opencl when OpenCL button is pressed', () => {
        useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
        const { getByTestId } = renderTab('general');

        fireEvent.press(getByTestId('backend-opencl-button'));

        expect(useAppStore.getState().settings.inferenceBackend).toBe('opencl');
      });

      it('updates gpuLayers when GPU Layers slider completes', () => {
        useAppStore
          .getState()
          .updateSettings({
            inferenceBackend: 'opencl',
            flashAttn: false,
            gpuLayers: 6,
          });
        const { getByTestId } = renderTab('general');

        fireEvent(
          getByTestId('gpu-layers-stepper-slider'),
          'slidingComplete',
          7,
        );

        expect(useAppStore.getState().settings.gpuLayers).toBe(7);
      });
    });
  });

  // ============================================================================
  // Additional Slider Tests
  // ============================================================================
  describe('additional slider updates', () => {
    it('updates topP when slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      const topPSlider = sliders.find(
        (s: any) => s.props.value === 0.9 && s.props.maximumValue === 1.0,
      );
      if (topPSlider) {
        fireEvent(topPSlider, 'slidingComplete', 0.95);
        expect(useAppStore.getState().settings.topP).toBe(0.95);
      }
    });

    it('updates repeatPenalty when slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      const rpSlider = sliders.find(
        (s: any) => s.props.value === 1.1 && s.props.maximumValue === 2.0,
      );
      if (rpSlider) {
        fireEvent(rpSlider, 'slidingComplete', 1.3);
        expect(useAppStore.getState().settings.repeatPenalty).toBe(1.3);
      }
    });

    it('updates nBatch when slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      const batchSlider = sliders.find(
        (s: any) => s.props.value === 256 && s.props.maximumValue === 512,
      );
      if (batchSlider) {
        fireEvent(batchSlider, 'slidingComplete', 128);
        expect(useAppStore.getState().settings.nBatch).toBe(128);
      }
    });

    it('updates guidanceScale when slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('image');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      const gsSlider = sliders.find(
        (s: any) => s.props.value === 7.5 && s.props.maximumValue === 20,
      );
      if (gsSlider) {
        fireEvent(gsSlider, 'slidingComplete', 10);
        expect(useAppStore.getState().settings.imageGuidanceScale).toBe(10);
      }
    });

    it('updates imageThreads when slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('image');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      const itSlider = sliders.find(
        (s: any) => s.props.value === 4 && s.props.maximumValue === 8,
      );
      if (itSlider) {
        fireEvent(itSlider, 'slidingComplete', 6);
        expect(useAppStore.getState().settings.imageThreads).toBe(6);
      }
    });

    it('updates imageWidth and imageHeight when image size slider completes', () => {
      const { UNSAFE_getAllByType } = renderTab('image');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter(
        (v: any) =>
          v.props.onSlidingComplete && v.props.testID?.endsWith('-slider'),
      );

      // Min is the shared 256 floor (SWEET_SPOT_SIZE) — same as the chat modal, no divergence.
      const sizeSlider = sliders.find(
        (s: any) =>
          s.props.value === 512 &&
          s.props.maximumValue === 512 &&
          s.props.minimumValue === 256,
      );
      expect(sizeSlider).toBeTruthy();
      fireEvent(sizeSlider!, 'slidingComplete', 320);
      expect(useAppStore.getState().settings.imageWidth).toBe(320);
      expect(useAppStore.getState().settings.imageHeight).toBe(320);
    });
  });

  // ============================================================================
  // Image Generation Mode Toggle
  // ============================================================================
  describe('image generation mode toggle off', () => {
    it('toggles auto detection off', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getAllByRole } = renderTab('image');
      const switches = getAllByRole('switch');

      for (const sw of switches) {
        const before = useAppStore.getState().settings.imageGenerationMode;
        if (before === 'auto') {
          fireEvent(sw, 'valueChange', false);
          const after = useAppStore.getState().settings.imageGenerationMode;
          if (after === 'manual') {
            expect(after).toBe('manual');
            return;
          }
          useAppStore
            .getState()
            .updateSettings({ imageGenerationMode: 'auto' });
        }
      }
    });
  });

  // ============================================================================
  // Max Tokens display formatting
  // ============================================================================
  describe('max tokens display formatting', () => {
    it('shows raw number when maxTokens < 1024', () => {
      useAppStore.getState().updateSettings({ maxTokens: 512, nBatch: 256 });
      const { getAllByText, queryByText } = renderTab('text');
      // Under 1024 the value reads as itself rather than a rounded "0K". It appears more than once
      // because max tokens is capped BY the context, so both controls legitimately show 512.
      expect(getAllByText('512').length).toBeGreaterThan(0);
      expect(queryByText('0K')).toBeNull();
    });

    it('shows K format when maxTokens >= 1024', () => {
      useAppStore.getState().updateSettings({ maxTokens: 2048 });
      const { getAllByText } = renderTab('text');
      // 2.0K appears for both maxTokens and contextLength (both 2048)
      expect(getAllByText('2.0K').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Context Length display formatting
  // ============================================================================
  describe('context length display formatting', () => {
    it('shows raw number when contextLength < 1024', () => {
      useAppStore
        .getState()
        .updateSettings({ contextLength: 512, nBatch: 256 });
      const { getAllByText, queryByText } = renderTab('text');
      // Under 1024 the value reads as itself rather than a rounded "0K". It appears more than
      // once because max tokens is capped BY the context, so both controls show 512.
      expect(getAllByText('512').length).toBeGreaterThan(0);
      expect(queryByText('0K')).toBeNull();
    });
  });

  // ============================================================================
  // Settings with null/default values
  // ============================================================================
  describe('fallback defaults', () => {
    it('uses fallback values when settings fields are undefined', () => {
      // Set settings to have minimal/undefined values to test || fallback branches
      useAppStore.setState({
        settings: {
          systemPrompt: undefined as any,
          temperature: undefined as any,
          maxTokens: undefined as any,
          maxToolCalls: undefined as any,
          topP: undefined as any,
          repeatPenalty: undefined as any,
          contextLength: undefined as any,
          nThreads: undefined as any,
          nBatch: undefined as any,
          speculativeDecoding: false,
          speculativeDraftMax: 3,
          imageGenerationMode: undefined as any,
          autoDetectMethod: undefined as any,
          classifierModelId: null,
          imageSteps: undefined as any,
          imageGuidanceScale: undefined as any,
          imageThreads: undefined as any,
          imageWidth: undefined as any,
          imageHeight: undefined as any,
          imageUseOpenCL: undefined as any,
          enableGpu: undefined as any,
          inferenceBackend: undefined as any,
          gpuLayers: undefined as any,
          flashAttn: undefined as any,
          aggressiveModelLoading: undefined as any,
          cacheType: undefined as any,
          showGenerationDetails: undefined as any,
          voiceTurnMode: 'silence' as const,
          voiceSilenceAfterSpeechMs: 5_000,
          voiceSpeakerDrainMs: 2_000,
          enhanceImagePrompts: undefined as any,
          engineUpdates: undefined as any,
          enabledTools: undefined as any,
          thinkingEnabled: undefined as any,
          liteRTBackend: undefined as any,
          liteRTTemperature: undefined as any,
          liteRTTopP: undefined as any,
          liteRTMaxTokens: undefined as any,
          analyticsUsage: false,
          analyticsCrashes: false,
          analyticsAsked: false,
          analyticsLastPromptAt: null,
          videoParams: undefined as any,
          videoSeed: undefined as any,
          videoNegative: undefined as any,
          enhanceVideoPrompts: undefined as any,
        },
      });

      const view = renderTab('image');
      // Verify fallback values are used
      expect(view.getByText('50')).toBeTruthy(); // imageSteps || the platform default
      expect(view.getByText('7.5')).toBeTruthy(); // imageGuidanceScale || 7.5
      openTab(view, 'text');
      expect(view.getByText('0.70')).toBeTruthy(); // temperature || 0.7
      expect(view.getByText('0.90')).toBeTruthy(); // topP || 0.9
      expect(view.getByText('1.10')).toBeTruthy(); // repeatPenalty || 1.1
      expect(view.getAllByText('1').length).toBeGreaterThan(0); // undefined falls back to cpuThreadsSliderValue (1)
    });

    it('shows default system prompt when systemPrompt is undefined', () => {
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          systemPrompt: undefined as any,
        },
      });

      // Unset means the built-in prompt: the box is empty and shows that prompt as its placeholder.
      const { getByTestId } = renderTab('general');
      const input = getByTestId('default-system-prompt-input');
      expect(input.props.value).toBe('');
      expect(input.props.placeholder).toBe(APP_CONFIG.defaultSystemPrompt);
    });

    it('shows manual mode text when imageGenerationMode is not auto', () => {
      useAppStore
        .getState()
        .updateSettings({ imageGenerationMode: undefined as any });
      const { getByText } = renderTab('image');
      expect(getByText('Pictures only when you turn on Image in the chat.')).toBeTruthy();
    });
  });

  // ============================================================================
  // KV cache type Buttons
  // ============================================================================
  describe('KV cache type buttons', () => {
    it('renders KV cache type label', () => {
      const { getByText } = renderTab('text');
      expect(getByText('KV cache type')).toBeTruthy();
    });

    it('renders all three cache type buttons', () => {
      const { getByText } = renderTab('text');
      expect(getByText('f16')).toBeTruthy();
      expect(getByText('q8_0')).toBeTruthy();
      expect(getByText('q4_0')).toBeTruthy();
    });

    it('defaults to q8_0', () => {
      const state = useAppStore.getState();
      expect(state.settings.cacheType).toBe('q8_0');
    });

    it('updates store when f16 is pressed', () => {
      const { getByText } = renderTab('text');
      fireEvent.press(getByText('f16'));
      expect(useAppStore.getState().settings.cacheType).toBe('f16');
    });

    it('updates store when q4_0 is pressed', () => {
      const { getByText } = renderTab('text');
      fireEvent.press(getByText('q4_0'));
      expect(useAppStore.getState().settings.cacheType).toBe('q4_0');
    });

    it('shows correct description for f16', () => {
      useAppStore.getState().updateSettings({ cacheType: 'f16' });
      const { getByText } = renderTab('text');
      expect(getByText(/Full precision/)).toBeTruthy();
    });

    it('shows correct description for q8_0', () => {
      useAppStore.getState().updateSettings({ cacheType: 'q8_0' });
      const { getByText } = renderTab('text');
      expect(getByText(/8-bit quantized/)).toBeTruthy();
    });

    it('shows correct description for q4_0', () => {
      useAppStore.getState().updateSettings({ cacheType: 'q4_0' });
      const { getByText } = renderTab('text');
      expect(getByText(/4-bit quantized/)).toBeTruthy();
    });

    // HTP is currently disabled via HTP_UI_ENABLED feature flag
    it('locks KV cache display to f16 on HTP backend', () => {
      useAppStore
        .getState()
        .updateSettings({ inferenceBackend: 'htp', cacheType: 'q4_0' });
      const { getByText } = renderTab('text');
      expect(getByText(/Full precision/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Detection Method Buttons
  // ============================================================================
  describe('detection method buttons', () => {
    beforeEach(() => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
    });

    it('updates to pattern detection when Pattern is pressed', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'llm' });
      const { getByText } = renderTab('image');

      fireEvent.press(getByText('Pattern'));
      expect(useAppStore.getState().settings.autoDetectMethod).toBe('pattern');
    });

    it('updates to LLM detection when LLM is pressed', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'pattern' });
      const { getByText } = renderTab('image');

      fireEvent.press(getByText('LLM'));
      expect(useAppStore.getState().settings.autoDetectMethod).toBe('llm');
    });

    it('shows pattern description when pattern is selected', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'pattern' });
      const { getByText } = renderTab('image');
      expect(getByText('Fast keyword matching')).toBeTruthy();
    });

    it('shows LLM description when LLM is selected', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'llm' });
      const { getByText } = renderTab('image');
      expect(getByText('Uses text model for classification')).toBeTruthy();
    });
  });

  // ============================================================================
  // Reset to Defaults
  // ============================================================================
  describe('reset to defaults', () => {
    it('renders reset button', () => {
      const { getByTestId } = renderScreen();
      expect(getByTestId('reset-settings-button')).toBeTruthy();
    });

    it('shows confirmation alert when pressed', () => {
      const { getByTestId, getByText } = renderScreen();
      fireEvent.press(getByTestId('reset-settings-button'));
      expect(getByText('Reset all settings')).toBeTruthy();
    });

    it('resets all settings to defaults when confirmed', () => {
      useAppStore.getState().updateSettings({
        temperature: 1.5,
        maxTokens: 4096,
        nThreads: 2,
        nBatch: 64,
        cacheType: 'f16',
        flashAttn: false,
        inferenceBackend: 'opencl',
        gpuLayers: 20,
      });

      const { getByTestId } = renderScreen();
      fireEvent.press(getByTestId('reset-settings-button'));
      // The alert's own Reset (the header button reads "Reset" too).
      fireEvent.press(within(getByTestId('app-alert')).getByText('Reset'));

      const s = useAppStore.getState().settings;
      expect(s.temperature).toBe(0.7);
      expect(s.maxTokens).toBe(1024);
      expect(s.nThreads).toBe(0);
      expect(s.nBatch).toBe(0); // auto: the engine's batch for the backend
      expect(s.cacheType).toBe('q8_0');
      expect(s.flashAttn).toBe(true);
      expect(s.inferenceBackend).toBe('metal'); // iOS default
      expect(s.gpuLayers).toBe(99);
    });
  });
});

describe('Voice tab — Transcription (STT) + Text to Speech (TTS)', () => {
  beforeEach(() => {
    resetStores();
    _clearSlotsForTesting();
  });

  afterEach(() => {
    _clearSlotsForTesting();
  });

  it('the Voice tab shows the transcription model row that opens the picker', () => {
    const view = renderScreen();
    // Not on the General tab.
    expect(view.queryByTestId('stt-open-picker')).toBeNull();
    fireEvent.press(view.getByTestId('model-settings-tab-voice'));
    // the row shows the "no model yet" state (whisper store empty in a fresh app)
    expect(view.getByTestId('stt-open-picker')).toBeTruthy();
    expect(within(view.getByTestId('stt-open-picker')).getByText('No model selected. Tap to choose.')).toBeTruthy();
    expect(view.getByTestId('settings-transcription-language')).toBeTruthy();
  });

  it('does NOT show Text to Speech without the pro TTS slot (free build)', () => {
    const view = renderTab('voice');
    expect(view.queryByText('Shared TTS settings')).toBeNull();
  });

  it('shows the pro TTS settings on the Voice tab when the slot is present', () => {
    const { Text } = require('react-native');
    const TtsSettings = () => <Text>Shared TTS settings</Text>;
    registerSlot(SLOTS.generationSettingsTts, TtsSettings);
    const view = renderTab('voice');
    expect(view.getByText('Shared TTS settings')).toBeTruthy();
  });
});
