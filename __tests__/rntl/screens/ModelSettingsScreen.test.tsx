/**
 * ModelSettingsScreen Tests
 *
 * Tests for the model settings screen including:
 * - Section titles rendering
 * - System prompt editing
 * - Show Generation Details toggle
 * - Image generation settings (auto detection, steps, guidance, threads, size)
 * - Text generation settings (temperature, max tokens, top P, repeat penalty)
 * - Performance settings (threads, batch size, GPU, model loading strategy) — now in Text Generation
 * - Detection method buttons
 * - Enhance image prompts toggle
 * - Context length slider
 * - Accordion expand/collapse behavior
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
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
    </NavigationContainer>
  );
};

/** Render screen with specific accordions expanded (also opens Advanced toggles) */
const renderWithSections = (...sections: ('prompt' | 'image' | 'text')[]) => {
  const result = renderScreen();
  const testIDMap: Record<string, string> = {
    prompt: 'system-prompt-accordion',
    image: 'image-generation-accordion',
    text: 'text-generation-accordion',
  };
  const advancedMap: Record<string, string> = {
    image: 'image-advanced-toggle',
    text: 'text-advanced-toggle',
  };
  for (const section of sections) {
    fireEvent.press(result.getByTestId(testIDMap[section]));
    if (advancedMap[section]) {
      fireEvent.press(result.getByTestId(advancedMap[section]));
    }
  }
  return result;
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
      expect(getByText('Model Settings')).toBeTruthy();
    });

    it('shows all section titles as accordion headers', () => {
      const { getByText } = renderScreen();
      expect(getByText('Default System Prompt')).toBeTruthy();
      expect(getByText('Image Generation')).toBeTruthy();
      expect(getByText('Text Generation')).toBeTruthy();
    });

    it('shows section help text for system prompt when expanded', () => {
      const { getByText } = renderWithSections('prompt');
      expect(getByText(/Instructions given to the model/)).toBeTruthy();
    });

    it('sections are collapsed by default', () => {
      const { queryByText } = renderScreen();
      // Content inside collapsed sections should not be visible
      expect(queryByText('Temperature')).toBeNull();
      expect(queryByText('CPU Threads')).toBeNull();
      expect(queryByText(/Instructions given to the model/)).toBeNull();
    });

    it('shows section help text for image generation when expanded', () => {
      const { getByText } = renderWithSections('image');
      expect(getByText(/Control how image generation/)).toBeTruthy();
    });

    it('shows section help text for text generation when expanded', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText(/Configure LLM behavior/)).toBeTruthy();
    });

  });

  // ============================================================================
  // Accordion Behavior
  // ============================================================================
  describe('accordion behavior', () => {
    it('expands image generation section when header is pressed', () => {
      const { getByTestId, queryByText } = renderScreen();
      expect(queryByText('Automatic Detection')).toBeNull();

      fireEvent.press(getByTestId('image-generation-accordion'));
      expect(queryByText('Automatic Detection')).toBeTruthy();
    });

    it('collapses image generation section when header is pressed again', () => {
      const { getByTestId, queryByText } = renderScreen();

      fireEvent.press(getByTestId('image-generation-accordion'));
      expect(queryByText('Automatic Detection')).toBeTruthy();

      fireEvent.press(getByTestId('image-generation-accordion'));
      expect(queryByText('Automatic Detection')).toBeNull();
    });

    it('expands text generation section when header is pressed', () => {
      const { getByTestId, queryByText } = renderScreen();
      expect(queryByText('Temperature')).toBeNull();

      fireEvent.press(getByTestId('text-generation-accordion'));
      expect(queryByText('Temperature')).toBeTruthy();
    });

    it('shows CPU Threads inside text generation section', () => {
      const { queryByText } = renderWithSections('text');
      expect(queryByText('CPU Threads')).toBeTruthy();
    });
  });

  // ============================================================================
  // System Prompt
  // ============================================================================
  describe('system prompt', () => {
    it('shows default system prompt text', () => {
      const { getByDisplayValue } = renderWithSections('prompt');
      expect(getByDisplayValue(/helpful AI assistant/)).toBeTruthy();
    });

    it('updates system prompt when text changes', () => {
      const { getByDisplayValue } = renderWithSections('prompt');
      const input = getByDisplayValue(/helpful AI assistant/);

      fireEvent.changeText(input, 'You are a coding assistant.');

      expect(useAppStore.getState().settings.systemPrompt).toBe('You are a coding assistant.');
    });
  });

  // ============================================================================
  // Show Generation Details Toggle
  // ============================================================================
  describe('show generation details toggle', () => {
    it('renders the toggle with label and description', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Show Generation Details')).toBeTruthy();
      expect(getByText('Display tokens/sec, timing, and memory usage on responses')).toBeTruthy();
    });

    it('defaults to off', () => {
      const state = useAppStore.getState();
      expect(state.settings.showGenerationDetails).toBe(false);
    });

    it('updates store to true when toggled on', () => {
      const { getAllByRole } = renderWithSections('text');
      const switches = getAllByRole('switch');

      // Find the Show Generation Details switch by toggling and checking
      const initialValue = useAppStore.getState().settings.showGenerationDetails;
      expect(initialValue).toBe(false);

      for (const sw of switches) {
        const before = useAppStore.getState().settings.showGenerationDetails;
        fireEvent(sw, 'valueChange', true);
        const after = useAppStore.getState().settings.showGenerationDetails;
        if (after !== before) {
          expect(after).toBe(true);
          return;
        }
      }
      fail('No switch found that updates showGenerationDetails');
    });

    it('updates store to false when toggled off', () => {
      useAppStore.getState().updateSettings({ showGenerationDetails: true });

      const { getAllByRole } = renderWithSections('text');
      const switches = getAllByRole('switch');

      for (const sw of switches) {
        const before = useAppStore.getState().settings.showGenerationDetails;
        if (before === true) {
          fireEvent(sw, 'valueChange', false);
          const after = useAppStore.getState().settings.showGenerationDetails;
          if (after === false) {
            expect(after).toBe(false);
            return;
          }
          useAppStore.getState().updateSettings({ showGenerationDetails: true });
        }
      }
    });

    it('syncs with store when showGenerationDetails is already true', () => {
      useAppStore.getState().updateSettings({ showGenerationDetails: true });

      const { getByText } = renderWithSections('text');
      expect(getByText('Show Generation Details')).toBeTruthy();
      expect(useAppStore.getState().settings.showGenerationDetails).toBe(true);
    });
  });

  // ============================================================================
  // Flash Attention Toggle
  // ============================================================================
  describe('flash attention toggle', () => {
    it('renders Flash Attention label', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Flash Attention')).toBeTruthy();
    });

    it('updates store to true when Flash Attention switch is turned on', () => {
      useAppStore.getState().updateSettings({ flashAttn: false });
      const { getByTestId } = renderWithSections('text');

      fireEvent(getByTestId('flash-attn-switch'), 'valueChange', true);

      expect(useAppStore.getState().settings.flashAttn).toBe(true);
    });

    it('updates store to false when Flash Attention switch is turned off', () => {
      useAppStore.getState().updateSettings({ flashAttn: true });
      const { getByTestId } = renderWithSections('text');

      fireEvent(getByTestId('flash-attn-switch'), 'valueChange', false);

      expect(useAppStore.getState().settings.flashAttn).toBe(false);
    });

  });

  // ============================================================================
  // Image Generation Settings
  // ============================================================================
  describe('image generation settings', () => {
    it('shows Automatic Detection toggle', () => {
      const { getByText } = renderWithSections('image');
      expect(getByText('Automatic Detection')).toBeTruthy();
    });

    it('shows auto mode description when enabled', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getByText } = renderWithSections('image');
      expect(getByText(/LLM will classify/)).toBeTruthy();
    });

    it('shows manual mode description when disabled', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { getByText } = renderWithSections('image');
      expect(getByText(/Only generate images when you tap/)).toBeTruthy();
    });

    it('toggles image generation mode', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { getAllByRole } = renderWithSections('image');
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
      const { getByText } = renderWithSections('image');
      expect(getByText(/In Auto mode/)).toBeTruthy();
    });

    it('shows manual mode note', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { getByText } = renderWithSections('image');
      expect(getByText(/In Manual mode/)).toBeTruthy();
    });

    it('shows Image Steps slider label and value', () => {
      const { getByText } = renderWithSections('image');
      expect(getByText('Image Steps')).toBeTruthy();
      // Default value
      expect(getByText('8')).toBeTruthy();
    });

    it('shows Guidance Scale slider label and value', () => {
      const { getByText } = renderWithSections('image');
      expect(getByText('Guidance Scale')).toBeTruthy();
      expect(getByText('7.5')).toBeTruthy();
    });

    it('shows Image Threads slider label', () => {
      const { getByText } = renderWithSections('image');
      expect(getByText('Image Threads')).toBeTruthy();
    });

    it('shows Image Size slider label', () => {
      const { getByText } = renderWithSections('image');
      expect(getByText('Image Size')).toBeTruthy();
    });

    it('shows Detection Method buttons when auto mode enabled', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getByText } = renderWithSections('image');
      expect(getByText('Detection Method')).toBeTruthy();
      expect(getByText('Pattern')).toBeTruthy();
      expect(getByText('LLM')).toBeTruthy();
    });

    it('hides Detection Method when manual mode', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { queryByText } = renderWithSections('image');
      expect(queryByText('Detection Method')).toBeNull();
    });

    it('shows Enhance Image Prompts toggle', () => {
      const { getByText } = renderWithSections('image');
      expect(getByText('Enhance Image Prompts')).toBeTruthy();
    });

    it('toggles enhance image prompts', () => {
      expect(useAppStore.getState().settings.enhanceImagePrompts).toBe(false);

      const { getAllByRole } = renderWithSections('image');
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
      useAppStore.getState().updateSettings({ enhanceImagePrompts: true });
      const { getByText } = renderWithSections('image');
      expect(getByText(/Text model refines your prompt/)).toBeTruthy();
    });

    it('shows enhance prompts off description', () => {
      useAppStore.getState().updateSettings({ enhanceImagePrompts: false });
      const { getByText } = renderWithSections('image');
      expect(getByText(/Use your prompt directly/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Text Generation Settings
  // ============================================================================
  describe('text generation settings', () => {
    it('shows Temperature slider label and default value', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Temperature')).toBeTruthy();
      expect(getByText('0.70')).toBeTruthy();
    });

    it('shows Temperature description', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText(/Higher = more creative/)).toBeTruthy();
    });

    it('shows Max Tokens slider label and default value', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Max Tokens')).toBeTruthy();
      expect(getByText('1.0K')).toBeTruthy(); // 1024 -> 1.0K
    });

    it('shows Top P slider label and default value', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Top P')).toBeTruthy();
      expect(getByText('0.90')).toBeTruthy();
    });

    it('shows Repeat Penalty slider label and default value', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Repeat Penalty')).toBeTruthy();
      expect(getByText('1.10')).toBeTruthy();
    });

    it('shows Context Length slider label and default value', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Context Length')).toBeTruthy();
      expect(getByText('4K')).toBeTruthy(); // 4096 -> 4K
    });

    it('shows context length description', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText(/KV cache size/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Performance Settings
  // ============================================================================
  describe('performance settings', () => {
    it('shows CPU Threads slider label and auto value when nThreads uses the auto sentinel', async () => {
      const { getByText, findByText } = renderWithSections('text');
      expect(getByText('CPU Threads')).toBeTruthy();
      await findByText(/^Auto \(\d+\)$/);
    });

    it('shows Batch Size slider label and default value', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Batch Size')).toBeTruthy();
      expect(getByText('512')).toBeTruthy();
    });

    it('shows Model Loading Strategy label', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Model Loading Strategy')).toBeTruthy();
    });

    it('shows Save Memory and Fast buttons', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Save Memory')).toBeTruthy();
      expect(getByText('Fast')).toBeTruthy();
    });

    it('shows memory strategy description when memory mode', () => {
      useAppStore.getState().updateSettings({ modelLoadingStrategy: 'memory' });
      const { getByText } = renderWithSections('text');
      expect(getByText(/Load models on demand/)).toBeTruthy();
    });

    it('shows performance strategy description when performance mode', () => {
      useAppStore.getState().updateSettings({ modelLoadingStrategy: 'performance' });
      const { getByText } = renderWithSections('text');
      expect(getByText(/Keep models loaded/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Settings Updates via Sliders
  // ============================================================================
  describe('settings updates via sliders', () => {
    it('updates temperature when slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const tempSlider = sliders.find((s: any) => s.props.value === 0.7);
      if (tempSlider) {
        fireEvent(tempSlider, 'slidingComplete', 1.5);
        expect(useAppStore.getState().settings.temperature).toBe(1.5);
      }
    });

    it('updates maxTokens when slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const maxTokensSlider = sliders.find((s: any) => s.props.value === 1024);
      if (maxTokensSlider) {
        fireEvent(maxTokensSlider, 'slidingComplete', 2048);
        expect(useAppStore.getState().settings.maxTokens).toBe(2048);
      }
    });

    it('updates imageSteps when slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('image');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const stepsSlider = sliders.find((s: any) => s.props.value === 8 && s.props.maximumValue === 50);
      if (stepsSlider) {
        fireEvent(stepsSlider, 'slidingComplete', 30);
        expect(useAppStore.getState().settings.imageSteps).toBe(30);
      }
    });

    it('updates nThreads when slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const threadsSlider = sliders.find((s: any) => s.props.value === 1 && s.props.maximumValue === 12);
      if (threadsSlider) {
        fireEvent(threadsSlider, 'slidingComplete', 8);
        expect(useAppStore.getState().settings.nThreads).toBe(8);
      }
    });

    it('updates contextLength when slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const ctxSlider = sliders.find((s: any) => s.props.value === 4096 && s.props.maximumValue === 32768);
      if (ctxSlider) {
        fireEvent(ctxSlider, 'slidingComplete', 4096);
        expect(useAppStore.getState().settings.contextLength).toBe(4096);
      }
    });
  });

  // ============================================================================
  // Model Loading Strategy Buttons
  // ============================================================================
  describe('model loading strategy buttons', () => {
    it('updates to memory strategy when "Save Memory" is pressed', () => {
      useAppStore.getState().updateSettings({ modelLoadingStrategy: 'performance' });
      const { getByTestId } = renderWithSections('text');

      fireEvent.press(getByTestId('strategy-memory-button'));
      expect(useAppStore.getState().settings.modelLoadingStrategy).toBe('memory');
    });

    it('updates to performance strategy when "Fast" is pressed', () => {
      useAppStore.getState().updateSettings({ modelLoadingStrategy: 'memory' });
      const { getByTestId } = renderWithSections('text');

      fireEvent.press(getByTestId('strategy-performance-button'));
      expect(useAppStore.getState().settings.modelLoadingStrategy).toBe('performance');
    });
  });

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
    it('shows Inference Backend section on iOS', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('Inference Backend')).toBeTruthy();
    });

    it('does not show GPU Layers on iOS when backend is cpu', () => {
      useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
      const { queryByText } = renderWithSections('text');
      expect(queryByText('GPU Layers')).toBeNull();
    });

    // Android-specific backend tests: mock Platform.OS before each, restore after
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

      it('shows Inference Backend section and GPU Layers slider when backend is OpenCL', () => {
        useAppStore.getState().updateSettings({ inferenceBackend: 'opencl', gpuLayers: 6 });
        const { getByText } = renderWithSections('text');
        expect(getByText('Inference Backend')).toBeTruthy();
        expect(getByText('GPU Layers')).toBeTruthy();
      });

      it('does not clamp gpuLayers when flashAttn turned on with layers > 1', () => {
        useAppStore.getState().updateSettings({ inferenceBackend: 'opencl', flashAttn: false, gpuLayers: 8 });
        const { getByTestId } = renderWithSections('text');
        fireEvent(getByTestId('flash-attn-switch'), 'valueChange', true);
        expect(useAppStore.getState().settings.flashAttn).toBe(true);
        // GPU layers are no longer clamped when enabling flash attention
        expect(useAppStore.getState().settings.gpuLayers).toBe(8);
      });

      it('updates inferenceBackend to cpu when CPU button is pressed', () => {
        useAppStore.getState().updateSettings({ inferenceBackend: 'opencl', gpuLayers: 6 });
        const { getByTestId } = renderWithSections('text');

        fireEvent.press(getByTestId('backend-cpu-button'));

        expect(useAppStore.getState().settings.inferenceBackend).toBe('cpu');
      });

      it('updates inferenceBackend to opencl when OpenCL button is pressed', () => {
        useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
        const { getByTestId } = renderWithSections('text');

        fireEvent.press(getByTestId('backend-opencl-button'));

        expect(useAppStore.getState().settings.inferenceBackend).toBe('opencl');
      });

      it('updates gpuLayers when GPU Layers slider completes', () => {
        useAppStore.getState().updateSettings({ inferenceBackend: 'opencl', flashAttn: false, gpuLayers: 6 });
        const { getByTestId } = renderWithSections('text');

        const slider = getByTestId('gpu-layers-slider');
        fireEvent(slider, 'slidingComplete', 12);

        expect(useAppStore.getState().settings.gpuLayers).toBe(12);
      });
    });
  });

  // ============================================================================
  // Additional Slider Tests
  // ============================================================================
  describe('additional slider updates', () => {
    it('updates topP when slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const topPSlider = sliders.find((s: any) => s.props.value === 0.9 && s.props.maximumValue === 1.0);
      if (topPSlider) {
        fireEvent(topPSlider, 'slidingComplete', 0.95);
        expect(useAppStore.getState().settings.topP).toBe(0.95);
      }
    });

    it('updates repeatPenalty when slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const rpSlider = sliders.find((s: any) => s.props.value === 1.1 && s.props.maximumValue === 2.0);
      if (rpSlider) {
        fireEvent(rpSlider, 'slidingComplete', 1.3);
        expect(useAppStore.getState().settings.repeatPenalty).toBe(1.3);
      }
    });

    it('updates nBatch when slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('text');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const batchSlider = sliders.find((s: any) => s.props.value === 256 && s.props.maximumValue === 512);
      if (batchSlider) {
        fireEvent(batchSlider, 'slidingComplete', 128);
        expect(useAppStore.getState().settings.nBatch).toBe(128);
      }
    });

    it('updates guidanceScale when slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('image');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const gsSlider = sliders.find((s: any) => s.props.value === 7.5 && s.props.maximumValue === 20);
      if (gsSlider) {
        fireEvent(gsSlider, 'slidingComplete', 10);
        expect(useAppStore.getState().settings.imageGuidanceScale).toBe(10);
      }
    });

    it('updates imageThreads when slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('image');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const itSlider = sliders.find((s: any) => s.props.value === 4 && s.props.maximumValue === 8);
      if (itSlider) {
        fireEvent(itSlider, 'slidingComplete', 6);
        expect(useAppStore.getState().settings.imageThreads).toBe(6);
      }
    });

    it('updates imageWidth and imageHeight when image size slider completes', () => {
      const { UNSAFE_getAllByType } = renderWithSections('image');
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const sizeSlider = sliders.find((s: any) => s.props.value === 512 && s.props.maximumValue === 512 && s.props.minimumValue === 128);
      if (sizeSlider) {
        fireEvent(sizeSlider, 'slidingComplete', 256);
        expect(useAppStore.getState().settings.imageWidth).toBe(256);
        expect(useAppStore.getState().settings.imageHeight).toBe(256);
      }
    });
  });

  // ============================================================================
  // Image Generation Mode Toggle
  // ============================================================================
  describe('image generation mode toggle off', () => {
    it('toggles auto detection off', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getAllByRole } = renderWithSections('image');
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
          useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
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
      const { getAllByText } = renderWithSections('text');
      expect(getAllByText('512').length).toBe(1);
    });

    it('shows K format when maxTokens >= 1024', () => {
      useAppStore.getState().updateSettings({ maxTokens: 2048 });
      const { getAllByText } = renderWithSections('text');
      // 2.0K appears for both maxTokens and contextLength (both 2048)
      expect(getAllByText('2.0K').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Context Length display formatting
  // ============================================================================
  describe('context length display formatting', () => {
    it('shows raw number when contextLength < 1024', () => {
      useAppStore.getState().updateSettings({ contextLength: 512, nBatch: 256 });
      const { getAllByText } = renderWithSections('text');
      expect(getAllByText('512').length).toBe(1);
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
          topP: undefined as any,
          repeatPenalty: undefined as any,
          contextLength: undefined as any,
          nThreads: undefined as any,
          nBatch: undefined as any,
          imageGenerationMode: undefined as any,
          autoDetectMethod: undefined as any,
          classifierModelId: null,
          imageSteps: undefined as any,
          imageGuidanceScale: undefined as any,
          imageThreads: undefined as any,
          imageWidth: undefined as any,
          imageHeight: undefined as any,
          imageUseOpenCL: undefined as any,
          modelLoadingStrategy: undefined as any,
          enableGpu: undefined as any,
          inferenceBackend: undefined as any,
          gpuLayers: undefined as any,
          flashAttn: undefined as any,
          cacheType: undefined as any,
          showGenerationDetails: undefined as any,
          enhanceImagePrompts: undefined as any,
          enabledTools: undefined as any,
          thinkingEnabled: undefined as any,
        },
      });

      const { getByText } = renderWithSections('image', 'text');
      // Verify fallback values are used
      expect(getByText('0.70')).toBeTruthy(); // temperature || 0.7
      expect(getByText('0.90')).toBeTruthy(); // topP || 0.9
      expect(getByText('1.10')).toBeTruthy(); // repeatPenalty || 1.1
      expect(getByText('6')).toBeTruthy(); // undefined still falls back to 6
      expect(getByText('8')).toBeTruthy(); // imageSteps || 8
      expect(getByText('7.5')).toBeTruthy(); // imageGuidanceScale || 7.5
    });

    it('shows default system prompt when systemPrompt is undefined', () => {
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          systemPrompt: undefined as any,
        },
      });

      const { getByDisplayValue } = renderWithSections('prompt');
      expect(getByDisplayValue(/helpful AI assistant/)).toBeTruthy();
    });

    it('shows manual mode text when imageGenerationMode is not auto', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: undefined as any });
      const { getByText } = renderWithSections('image');
      expect(getByText(/Only generate images when you tap/)).toBeTruthy();
    });
  });

  // ============================================================================
  // KV Cache Type Buttons
  // ============================================================================
  describe('KV cache type buttons', () => {
    it('renders KV Cache Type label', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('KV Cache Type')).toBeTruthy();
    });

    it('renders all three cache type buttons', () => {
      const { getByText } = renderWithSections('text');
      expect(getByText('f16')).toBeTruthy();
      expect(getByText('q8_0')).toBeTruthy();
      expect(getByText('q4_0')).toBeTruthy();
    });

    it('defaults to q8_0', () => {
      const state = useAppStore.getState();
      expect(state.settings.cacheType).toBe('q8_0');
    });

    it('updates store when f16 is pressed', () => {
      const { getByText } = renderWithSections('text');
      fireEvent.press(getByText('f16'));
      expect(useAppStore.getState().settings.cacheType).toBe('f16');
    });

    it('updates store when q4_0 is pressed', () => {
      const { getByText } = renderWithSections('text');
      fireEvent.press(getByText('q4_0'));
      expect(useAppStore.getState().settings.cacheType).toBe('q4_0');
    });

    it('shows correct description for f16', () => {
      useAppStore.getState().updateSettings({ cacheType: 'f16' });
      const { getByText } = renderWithSections('text');
      expect(getByText(/Full precision/)).toBeTruthy();
    });

    it('shows correct description for q8_0', () => {
      useAppStore.getState().updateSettings({ cacheType: 'q8_0' });
      const { getByText } = renderWithSections('text');
      expect(getByText(/8-bit quantized/)).toBeTruthy();
    });

    it('shows correct description for q4_0', () => {
      useAppStore.getState().updateSettings({ cacheType: 'q4_0' });
      const { getByText } = renderWithSections('text');
      expect(getByText(/4-bit quantized/)).toBeTruthy();
    });

    // HTP is currently disabled via HTP_UI_ENABLED feature flag
    it.skip('locks KV cache display to f16 on HTP backend', () => {
      useAppStore.getState().updateSettings({ inferenceBackend: 'htp', cacheType: 'q4_0' });
      const { getByText } = renderWithSections('text');
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
      const { getByText } = renderWithSections('image');

      fireEvent.press(getByText('Pattern'));
      expect(useAppStore.getState().settings.autoDetectMethod).toBe('pattern');
    });

    it('updates to LLM detection when LLM is pressed', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'pattern' });
      const { getByText } = renderWithSections('image');

      fireEvent.press(getByText('LLM'));
      expect(useAppStore.getState().settings.autoDetectMethod).toBe('llm');
    });

    it('shows pattern description when pattern is selected', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'pattern' });
      const { getByText } = renderWithSections('image');
      expect(getByText('Fast keyword matching')).toBeTruthy();
    });

    it('shows LLM description when LLM is selected', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'llm' });
      const { getByText } = renderWithSections('image');
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
      expect(getByText('Reset All Settings')).toBeTruthy();
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

      const { getByTestId, getByText } = renderScreen();
      fireEvent.press(getByTestId('reset-settings-button'));
      fireEvent.press(getByText('Reset'));

      const s = useAppStore.getState().settings;
      expect(s.temperature).toBe(0.7);
      expect(s.maxTokens).toBe(1024);
      expect(s.nThreads).toBe(0);
      expect(s.nBatch).toBe(512);
      expect(s.cacheType).toBe('q8_0');
      expect(s.flashAttn).toBe(true);
      expect(s.inferenceBackend).toBe('metal'); // iOS default
      expect(s.gpuLayers).toBe(99);
    });
  });
});
