/**
 * The setup flow saves BOTH vocabulary and Analysis focus (rendered integration).
 *
 * Analysis focus used to be a block appended AFTER the guided setup component; it's now a step
 * INSIDE the same flow, right after Vocabulary (language -> priority -> vocab -> focus -> model).
 * This walks the real screen through real taps and proves each Save writes the store (which persists
 * the whole state, so both survive a restart). Fakes only at the device boundary; asserts on the
 * store the UI writes through - the single source both onboarding and Settings read.
 */
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));

import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';
import { installPro } from '../harness/proHarness';

describe('setup flow persists vocabulary and analysis focus (rendered)', () => {
  it('saves both through the guided steps', async () => {
    installNativeBoundary({ fs: true });
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    await installPro();
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { getRegisteredScreens } = require('../../src/navigation/screenRegistry');
    const { useAlwaysOnSettingsStore } = require('@offgrid/pro/locket/stores');

    // Start from a clean slate so the asserts can't pass on stale values.
    useAlwaysOnSettingsStore.setState({ transcribeVocabulary: '', insightsInstruction: '' });

    const Stack = createNativeStackNavigator();
    const screens = getRegisteredScreens();
    const App = () => React.createElement(NavigationContainer, null,
      React.createElement(Stack.Navigator, { initialRouteName: 'LocketTranscriptionSetup', screenOptions: { headerShown: false } },
        ...screens.map((sc: { name: string; component: React.ComponentType }) =>
          React.createElement(Stack.Screen, { key: sc.name, name: sc.name, component: sc.component }))));
    const ui = render(React.createElement(App));
    await act(async () => { await Promise.resolve(); });

    const tap = async (id: string) => {
      await waitFor(() => ui.getByTestId(id));
      await act(async () => { fireEvent.press(ui.getByTestId(id)); await Promise.resolve(); });
    };
    const type = async (id: string, text: string) => {
      await waitFor(() => ui.getByTestId(id));
      await act(async () => { fireEvent.changeText(ui.getByTestId(id), text); await Promise.resolve(); });
    };

    // Walk the guided flow: language -> priority -> vocab (type + Save) -> focus (type + Save).
    await tap('setup-next-language');
    await tap('setup-next-priority');
    await type('setup-vocabulary-input', 'Off Grid, Locket, Kokoro');
    await tap('setup-vocab-save');
    await type('setup-focus-input', 'focus on decisions and deadlines');
    await tap('setup-focus-save');

    // Both landed on the single store the app reads (trimmed on Save).
    const s = useAlwaysOnSettingsStore.getState();
    expect(s.transcribeVocabulary).toBe('Off Grid, Locket, Kokoro');
    expect(s.insightsInstruction).toBe('focus on decisions and deadlines');
  });
});
