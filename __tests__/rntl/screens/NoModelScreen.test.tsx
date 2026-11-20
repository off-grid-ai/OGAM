/**
 * NoModelScreen — the empty state a new chat shows before a model is chosen.
 *
 * Model loading is shown in the Chat message area; this component owns only the empty state. It runs
 * for real on a real stack navigator, with the real model selector sheet, theme and chat styles. A
 * small host holds the sheet's open state, as the Chat screen does.
 */
jest.unmock('@react-navigation/native');

import React, { useState } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NoModelScreen } from '../../../src/screens/ChatScreen/ChatScreenComponents';
import { createStyles } from '../../../src/screens/ChatScreen/styles';
import { useTheme } from '../../../src/theme';

const Stack = createNativeStackNavigator();
const noop = () => {};

function mount(hasAvailableModels: boolean) {
  function ChatHost() {
    const navigation = useNavigation();
    const theme = useTheme();
    const [showModelSelector, setShowModelSelector] = useState(false);
    return (
      <NoModelScreen
        styles={createStyles(theme.colors, theme.shadows)}
        colors={theme.colors}
        navigation={navigation}
        hasAvailableModels={hasAvailableModels}
        showModelSelector={showModelSelector}
        setShowModelSelector={setShowModelSelector}
        onSelectModel={noop}
        onUnloadModel={noop}
        isModelLoading={false}
      />
    );
  }
  const ref = createNavigationContainerRef<Record<string, undefined>>();
  const view = render(
    <NavigationContainer ref={ref}>
      <Stack.Navigator initialRouteName="ChatsTab">
        <Stack.Screen name="ChatsTab" component={() => <Text>Chats screen</Text>} />
        <Stack.Screen name="Chat" component={ChatHost} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  act(() => { ref.navigate('Chat'); });
  return { view, route: () => ref.getCurrentRoute()?.name };
}

describe('NoModelScreen', () => {
  it('with models on the phone, says a chat model is needed; Choose model opens the model sheet', async () => {
    const { view } = mount(true);

    expect(view.getByText('Needs a chat model.')).toBeTruthy();
    expect(view.queryByText('TEXT MODEL')).toBeNull();

    fireEvent.press(view.getByText('Choose model'));

    await waitFor(() => expect(view.getByText('TEXT MODEL')).toBeTruthy());
  });

  it('with no models, says a chat model is needed and offers Get a model, not Choose model', () => {
    const { view } = mount(false);

    expect(view.getByText('Needs a chat model.')).toBeTruthy();
    expect(view.getByText('Get a model')).toBeTruthy();
    expect(view.queryByText('Choose model')).toBeNull();
  });

  it('Back returns to the chat list', async () => {
    const { view, route } = mount(true);
    expect(route()).toBe('Chat');

    fireEvent.press(view.getByLabelText('Back'));

    await waitFor(() => expect(route()).toBe('ChatsTab'));
  });
});
