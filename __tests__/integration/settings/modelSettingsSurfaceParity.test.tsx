import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render } from '@testing-library/react-native';
import { GenerationSettingsModal } from '../../../src/components/GenerationSettingsModal';
import { ModelSettingsScreen } from '../../../src/screens/ModelSettingsScreen';
import { useAppStore } from '../../../src/stores/appStore';
import { useWhisperStore } from '../../../src/stores/whisperStore';
import {
  _clearSlotsForTesting,
  registerSlot,
  SLOTS,
} from '../../../src/bootstrap/slotRegistry';
import { resetStores } from '../../utils/testHelpers';

jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { View } = require('react-native');
    return <View {...props} />;
  },
}));

function renderModelSettings() {
  return render(
    <NavigationContainer>
      <ModelSettingsScreen />
    </NavigationContainer>,
  );
}

describe('model settings surface parity', () => {
  beforeEach(() => {
    resetStores();
    useAppStore.getState().setModelMaxContext(null);
    _clearSlotsForTesting();
  });

  afterEach(() => {
    _clearSlotsForTesting();
  });

  it('keeps shared controls in General on both surfaces and preserves saved values', () => {
    useAppStore.getState().updateSettings({
      modelLoadingMode: 'aggressive',
      showGenerationDetails: true,
    });
    const chatSettings = render(<GenerationSettingsModal visible onClose={() => {}} />);
    fireEvent.press(chatSettings.getByText('TEXT GENERATION'));
    expect(chatSettings.queryByText('Model Loading')).toBeNull();
    expect(chatSettings.queryByText('Show Generation Details')).toBeNull();
    fireEvent.press(chatSettings.getByTestId('modal-general-accordion'));
    expect(chatSettings.getByText('Inference Backend')).toBeTruthy();
    expect(chatSettings.getByTestId('model-loading-mode-aggressive-button')).toBeTruthy();
    expect(chatSettings.getByTestId('show-gen-details-on-button')).toBeTruthy();
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('text-generation-accordion'));
    expect(modelSettings.queryByText('Model Loading')).toBeNull();
    fireEvent.press(modelSettings.getByTestId('general-generation-accordion'));
    expect(modelSettings.getByText('Inference Backend')).toBeTruthy();
    expect(modelSettings.getByTestId('model-loading-mode-aggressive-button')).toBeTruthy();
    expect(modelSettings.getByTestId('show-gen-details-on-button')).toBeTruthy();
  });

  it('shows and edits the saved default system prompt in chat Text settings', () => {
    useAppStore.getState().updateSettings({ systemPrompt: 'Saved instructions' });
    const chatSettings = render(<GenerationSettingsModal visible onClose={() => {}} />);
    fireEvent.press(chatSettings.getByText('TEXT GENERATION'));
    const input = chatSettings.getByTestId('default-system-prompt-input');
    expect(input.props.value).toBe('Saved instructions');
    fireEvent.changeText(input, 'New instructions');
    expect(useAppStore.getState().settings.systemPrompt).toBe('New instructions');
  });

  it('caps output by context on both surfaces and writes one shared setting state', () => {
    useAppStore.getState().setModelMaxContext(262144);
    // A context wide enough for the output this test chooses. Max tokens is capped BY the context,
    // so the two must be raised together or the write below is clamped away from what it means.
    useAppStore.getState().updateSettings({ contextLength: 262144 });
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );

    fireEvent.press(chatSettings.getByText('TEXT GENERATION'));

    expect(
      chatSettings.getByTestId('setting-maxTokens-slider').props.maximumValue,
    ).toBe(262144);
    expect(
      chatSettings.getByTestId('setting-contextLength-slider').props
        .maximumValue,
    ).toBe(262144);

    fireEvent(
      chatSettings.getByTestId('setting-maxTokens-slider'),
      'slidingComplete',
      131072,
    );

    expect(useAppStore.getState().settings.maxTokens).toBe(131072);
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('text-generation-accordion'));

    expect(
      modelSettings.getByTestId('llama-max-tokens-slider').props.maximumValue,
    ).toBe(262144);
    expect(
      modelSettings.getByTestId('llama-context-length-slider').props
        .maximumValue,
    ).toBe(262144);
    expect(
      modelSettings.getByTestId('llama-max-tokens-slider').props.value,
    ).toBe(131072);
  });

  it('uses one maximum-tool-call setting in both text-settings surfaces', () => {
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );
    fireEvent.press(chatSettings.getByText('TEXT GENERATION'));
    fireEvent.press(chatSettings.getByTestId('modal-text-advanced-toggle'));

    const chatSlider = chatSettings.getByTestId('setting-maxToolCalls-slider');
    expect(chatSlider.props.value).toBe(25);
    fireEvent(chatSlider, 'slidingComplete', 40);
    expect(useAppStore.getState().settings.maxToolCalls).toBe(40);
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('text-generation-accordion'));
    fireEvent.press(modelSettings.getByTestId('text-advanced-toggle'));

    expect(modelSettings.getByTestId('max-tool-calls-slider').props.value).toBe(
      40,
    );
  });

  it('uses the same thinking-budget step in chat and model settings', () => {
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );
    fireEvent.press(chatSettings.getByText('TEXT GENERATION'));
    expect(chatSettings.getByText('Auto (up to Max Tokens)')).toBeTruthy();
    fireEvent(chatSettings.getByTestId('setting-maxTokens-slider'), 'slidingComplete', 4096);
    fireEvent(chatSettings.getByTestId('thinking-budget-slider'), 'slidingComplete', 4);
    expect(chatSettings.getByText('4K tokens')).toBeTruthy();
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('text-generation-accordion'));
    expect(modelSettings.getByText('4K tokens')).toBeTruthy();
    fireEvent(modelSettings.getByTestId('thinking-budget-slider'), 'slidingComplete', 0);
    expect(modelSettings.getByText('Auto (up to Max Tokens)')).toBeTruthy();
  });

  it('limits Thinking Budget to Max Tokens when the output limit is lowered', () => {
    const chatSettings = render(<GenerationSettingsModal visible onClose={() => {}} />);
    fireEvent.press(chatSettings.getByText('TEXT GENERATION'));
    fireEvent(chatSettings.getByTestId('setting-maxTokens-slider'), 'slidingComplete', 3000);

    const budgetSlider = chatSettings.getByTestId('thinking-budget-slider');
    fireEvent(budgetSlider, 'slidingComplete', budgetSlider.props.maximumValue);
    expect(useAppStore.getState().settings.reasoningBudget).toBe(3008);
    expect(chatSettings.getByText('3008 tokens')).toBeTruthy();

    fireEvent(chatSettings.getByTestId('setting-maxTokens-slider'), 'slidingComplete', 2048);
    expect(chatSettings.getByTestId('thinking-budget-slider').props.maximumValue).toBe(3);
    expect(chatSettings.getByText('2K tokens')).toBeTruthy();
  });

  it('shows Context Length, Max Tokens, then Thinking Budget on both surfaces', () => {
    const chatSettings = render(<GenerationSettingsModal visible onClose={() => {}} />);
    fireEvent.press(chatSettings.getByText('TEXT GENERATION'));
    const chatOrder = JSON.stringify(chatSettings.toJSON());
    expect(chatOrder.indexOf('Context Length')).toBeLessThan(chatOrder.indexOf('Max Tokens'));
    expect(chatOrder.indexOf('Max Tokens')).toBeLessThan(chatOrder.indexOf('Thinking Budget'));
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('text-generation-accordion'));
    const modelOrder = JSON.stringify(modelSettings.toJSON());
    expect(modelOrder.indexOf('Context Length')).toBeLessThan(modelOrder.indexOf('Max Tokens'));
    expect(modelOrder.indexOf('Max Tokens')).toBeLessThan(modelOrder.indexOf('Thinking Budget'));
  });

  it('shows the selected STT model in Models, outside chat settings', () => {
    useWhisperStore.setState({ downloadedModelId: 'base.en' });
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );

    fireEvent.press(chatSettings.getByTestId('modal-transcription-accordion'));
    expect(chatSettings.queryByText('Base')).toBeNull();
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('transcription-accordion'));
    expect(modelSettings.getByText('Base')).toBeTruthy();
  });

  it('keeps the selected STT language in chat settings', () => {
    useWhisperStore.setState({ downloadedModelId: 'base', transcriptionLanguage: 'auto' });
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );
    fireEvent.press(chatSettings.getByTestId('modal-transcription-accordion'));
    fireEvent.press(chatSettings.getByTestId('chat-transcription-language'));
    fireEvent.press(chatSettings.getByTestId('chat-transcription-language-fr'));
    expect(useWhisperStore.getState().transcriptionLanguage).toBe('fr');
    chatSettings.unmount();

  });

  it('renders the same TTS settings owner in both UI containers', () => {
    const SharedTtsSettings = () => (
      <Text testID="shared-tts-settings">Shared TTS settings</Text>
    );
    registerSlot(SLOTS.generationSettingsTts, SharedTtsSettings);
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );

    fireEvent.press(chatSettings.getByText('TEXT TO SPEECH'));
    expect(chatSettings.getByTestId('shared-tts-settings')).toBeTruthy();
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('tts-accordion'));
    expect(modelSettings.getByTestId('shared-tts-settings')).toBeTruthy();
  });
});
