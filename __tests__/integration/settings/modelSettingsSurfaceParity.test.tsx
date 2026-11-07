/**
 * Model settings: one surface, reached from chat.
 *
 * The chat's settings sheet used to copy every model setting, and these tests held the two copies
 * to one shared state. The sheet now carries none of them: its Model settings row opens the one
 * Model settings screen. The intent stays: every setting a person could change from chat is still
 * reachable from chat, on that screen, reading and writing the one shared store. So the tests:
 * - walk from the chat sheet to the real Model settings screen through a real navigation stack, and
 * - drive each setting the sheet used to hold, on its Model settings tab, against the real stores.
 */
import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { fireEvent, render, within } from '@testing-library/react-native';
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
import { withNavigator } from '../../harness/realNavigation';

// Real navigation: the library's own stack, useNavigation and navigate.
jest.unmock('@react-navigation/native');

jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { View } = require('react-native');
    return <View {...props} />;
  },
}));

type Tab = 'general' | 'text' | 'image' | 'voice';

function renderModelSettings(tab: Tab = 'general') {
  const view = render(withNavigator(<ModelSettingsScreen />));
  fireEvent.press(view.getByTestId(`model-settings-tab-${tab}`));
  return view;
}

/** A chat screen with its settings sheet open, on a stack that also holds the real Model settings. */
function renderChatWithSettingsSheet() {
  const Stack = createNativeStackNavigator();
  // As ChatModalSection wires it: the screen navigates; the sheet imports no navigation.
  const ChatScreen = ({ navigation }: { navigation: { navigate: (route: string) => void } }) => (
    <GenerationSettingsModal visible onClose={() => {}} onOpenModelSettings={() => navigation.navigate('ModelSettings')} />
  );
  return render(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen name="ModelSettings" component={ModelSettingsScreen} />
      </Stack.Navigator>
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

  it('opens the one Model settings screen from the chat sheet, showing the saved values', async () => {
    useAppStore.getState().updateSettings({
      modelLoadingMode: 'aggressive',
      showGenerationDetails: true,
    });
    const app = renderChatWithSettingsSheet();
    // The sheet has no copy of the settings.
    expect(app.queryByText('Model loading')).toBeNull();

    fireEvent.press(app.getByTestId('chat-settings-open-model-settings'));

    // The real Model settings screen, on General, with the saved values.
    expect(await app.findByTestId('model-settings-tab-general')).toBeTruthy();
    expect(app.getByText('Text model hardware')).toBeTruthy();
    expect(app.getByTestId('model-loading-mode-aggressive-button')).toBeTruthy();
    expect(app.getByTestId('show-gen-details-on-button')).toBeTruthy();
    // Pressing there writes the one shared store.
    fireEvent.press(app.getByTestId('model-loading-mode-conservative-button'));
    expect(useAppStore.getState().settings.modelLoadingMode).toBe('conservative');
  });

  it('keeps shared controls in General, not in Text', () => {
    useAppStore.getState().updateSettings({
      modelLoadingMode: 'aggressive',
      showGenerationDetails: true,
    });
    const modelSettings = renderModelSettings('text');
    expect(modelSettings.queryByText('Model loading')).toBeNull();
    expect(modelSettings.queryByText('Show generation details')).toBeNull();
    fireEvent.press(modelSettings.getByTestId('model-settings-tab-general'));
    expect(modelSettings.getByText('Text model hardware')).toBeTruthy();
    expect(modelSettings.getByTestId('model-loading-mode-aggressive-button')).toBeTruthy();
    expect(modelSettings.getByTestId('show-gen-details-on-button')).toBeTruthy();
  });

  it('shows and edits the saved default system prompt in General', () => {
    useAppStore.getState().updateSettings({ systemPrompt: 'Saved instructions' });
    const modelSettings = renderModelSettings('general');
    const input = modelSettings.getByTestId('default-system-prompt-input');
    // The box has a name, like every other setting on the tab.
    expect(modelSettings.getByRole('header', { name: 'Default instructions' })).toBeTruthy();
    expect(input.props.value).toBe('Saved instructions');
    fireEvent.changeText(input, 'New instructions');
    expect(useAppStore.getState().settings.systemPrompt).toBe('New instructions');
  });

  it('caps output by context and writes the one shared setting state', () => {
    useAppStore.getState().setModelMaxContext(262144);
    // A context wide enough for the output this test chooses. Max tokens is capped BY the context,
    // so the two must be raised together or the write below is clamped away from what it means.
    useAppStore.getState().updateSettings({ contextLength: 262144 });
    const modelSettings = renderModelSettings('text');

    expect(
      modelSettings.getByTestId('llama-max-tokens-slider').props.maximumValue,
    ).toBe(262144);
    expect(
      modelSettings.getByTestId('llama-context-length-slider').props
        .maximumValue,
    ).toBe(262144);

    fireEvent(
      modelSettings.getByTestId('llama-max-tokens-slider'),
      'slidingComplete',
      131072,
    );

    expect(useAppStore.getState().settings.maxTokens).toBe(131072);
    modelSettings.unmount();

    // Opened again, the screen reads the value back from the store.
    const again = renderModelSettings('text');
    expect(again.getByTestId('llama-max-tokens-slider').props.value).toBe(131072);
  });

  it('uses one maximum-tool-call setting', () => {
    const modelSettings = renderModelSettings('text');
    fireEvent.press(modelSettings.getByTestId('text-advanced-toggle'));

    const slider = modelSettings.getByTestId('max-tool-calls-slider');
    expect(slider.props.value).toBe(25);
    fireEvent(slider, 'slidingComplete', 40);
    expect(useAppStore.getState().settings.maxToolCalls).toBe(40);
    modelSettings.unmount();

    const again = renderModelSettings('text');
    fireEvent.press(again.getByTestId('text-advanced-toggle'));
    expect(again.getByTestId('max-tool-calls-slider').props.value).toBe(40);
  });

  it('steps the thinking budget and keeps it across visits', () => {
    const modelSettings = renderModelSettings('text');
    expect(modelSettings.getByText('Auto (up to max tokens)')).toBeTruthy();
    fireEvent(modelSettings.getByTestId('llama-max-tokens-slider'), 'slidingComplete', 4096);
    fireEvent(modelSettings.getByTestId('thinking-budget-slider'), 'slidingComplete', 4);
    expect(modelSettings.getByText('4K tokens')).toBeTruthy();
    modelSettings.unmount();

    const again = renderModelSettings('text');
    expect(again.getByText('4K tokens')).toBeTruthy();
    fireEvent(again.getByTestId('thinking-budget-slider'), 'slidingComplete', 0);
    expect(again.getByText('Auto (up to max tokens)')).toBeTruthy();
  });

  it('limits Thinking Budget to Max Tokens when the output limit is lowered', () => {
    const modelSettings = renderModelSettings('text');
    fireEvent(modelSettings.getByTestId('llama-max-tokens-slider'), 'slidingComplete', 3000);

    const budgetSlider = modelSettings.getByTestId('thinking-budget-slider');
    fireEvent(budgetSlider, 'slidingComplete', budgetSlider.props.maximumValue);
    expect(useAppStore.getState().settings.reasoningBudget).toBe(3008);
    expect(modelSettings.getByText('3008 tokens')).toBeTruthy();

    fireEvent(modelSettings.getByTestId('llama-max-tokens-slider'), 'slidingComplete', 2048);
    expect(modelSettings.getByTestId('thinking-budget-slider').props.maximumValue).toBe(3);
    expect(modelSettings.getByText('2K tokens')).toBeTruthy();
  });

  it('shows Context Length, Max Tokens, then Thinking Budget', () => {
    const modelSettings = renderModelSettings('text');
    // Queries return labels in screen order.
    const labels = modelSettings
      .getAllByText(/^(Context length|Max tokens|Thinking budget)$/)
      .map(node => node.props.children);
    expect(labels).toEqual(['Context length', 'Max tokens', 'Thinking budget']);
  });

  it('shows the selected STT model on the Voice tab, outside the chat sheet', () => {
    useWhisperStore.setState({ downloadedModelId: 'base.en' });
    const chatSettings = render(withNavigator(<GenerationSettingsModal visible onClose={() => {}} />));
    expect(chatSettings.queryByTestId('stt-open-picker')).toBeNull();
    expect(chatSettings.queryByText('Transcription model')).toBeNull();
    chatSettings.unmount();

    const modelSettings = renderModelSettings('voice');
    expect(within(modelSettings.getByTestId('stt-open-picker')).getByText('Base')).toBeTruthy();
  });

  it('sets the STT language on the Voice tab', () => {
    useWhisperStore.setState({ downloadedModelId: 'base', transcriptionLanguage: 'auto' });
    const modelSettings = renderModelSettings('voice');
    fireEvent.press(modelSettings.getByTestId('settings-transcription-language'));
    fireEvent.press(modelSettings.getByTestId('settings-transcription-language-fr'));
    expect(useWhisperStore.getState().transcriptionLanguage).toBe('fr');
  });

  it('renders the TTS settings owner on the Voice tab', () => {
    const SharedTtsSettings = () => (
      <Text testID="shared-tts-settings">Shared TTS settings</Text>
    );
    registerSlot(SLOTS.generationSettingsTts, SharedTtsSettings);
    const chatSettings = render(withNavigator(<GenerationSettingsModal visible onClose={() => {}} />));
    expect(chatSettings.queryByTestId('shared-tts-settings')).toBeNull();
    chatSettings.unmount();

    const modelSettings = renderModelSettings('voice');
    expect(modelSettings.getByTestId('shared-tts-settings')).toBeTruthy();
  });
});
