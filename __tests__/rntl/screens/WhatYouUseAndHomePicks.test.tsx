/**
 * After onboarding: Settings → What you use changes the picks, and Home's "Your picks" follows.
 * Real screens, real shared feature list, real app store, on a real stack navigator.
 */
jest.unmock('@react-navigation/native');

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WhatYouUseScreen } from '../../../src/screens/OnboardingPicks/WhatYouUseScreen';
import { HomePicks } from '../../../src/screens/HomeScreen/components/HomePicks';
import { useAppStore } from '../../../src/stores/appStore';

const Stack = createNativeStackNavigator();
const Home = () => <HomePicks />;
const Stub = () => <Text>other screen</Text>;

function mount(first: 'Home' | 'WhatYouUse') {
  const ref =
    createNavigationContainerRef<Record<string, object | undefined>>();
  const view = render(
    <NavigationContainer ref={ref}>
      <Stack.Navigator initialRouteName={first}>
        <Stack.Screen name="Home" component={Home} />
        <Stack.Screen
          name="WhatYouUse"
          component={WhatYouUseScreen as React.ComponentType<any>}
        />
        <Stack.Screen name="GuideTopic" component={Stub} />
        <Stack.Screen name="AutoSetup" component={Stub} />
        <Stack.Screen name="Chat" component={Stub} />
        <Stack.Screen name="Main" component={Stub} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  return { view, route: () => ref.getCurrentRoute()?.name };
}

describe('What you use and Home picks', () => {
  beforeEach(() => useAppStore.setState({ onboardingPicks: null }));

  it('no picks: Home shows no picks section, as it always was', () => {
    const { view } = mount('Home');
    expect(view.queryByTestId('home-picks')).toBeNull();
  });

  it('picks show on Home in pick order, and a tap opens the feature', async () => {
    useAppStore.setState({
      onboardingPicks: {
        groups: ['create', 'chat'],
        parts: ['images', 'chat'],
      },
    });
    const { view, route } = mount('Home');
    expect(view.getByTestId('home-picks')).toBeTruthy();
    const ids = view
      .getAllByTestId(/^home-pick-/)
      .map(node => node.props.testID);
    expect(ids).toEqual(['home-pick-phone-images', 'home-pick-phone-chat']);
    fireEvent.press(view.getByTestId('home-pick-phone-chat'));
    await waitFor(() => expect(route()).not.toBe('Home'));
  });

  it('What you use: a tap picks or unpicks and saves; the last one out leaves no picks', () => {
    useAppStore.setState({
      onboardingPicks: { groups: ['chat'], parts: ['chat'] },
    });
    const { view } = mount('WhatYouUse');
    expect(
      view.getByTestId('what-you-use-chat').props.accessibilityState.checked,
    ).toBe(true);
    fireEvent.press(view.getByTestId('what-you-use-images'));
    expect(useAppStore.getState().onboardingPicks).toEqual({
      groups: ['chat', 'create'],
      parts: ['chat', 'images'],
    });
    fireEvent.press(view.getByTestId('what-you-use-chat'));
    fireEvent.press(view.getByTestId('what-you-use-images'));
    expect(useAppStore.getState().onboardingPicks).toBeNull();
  });

  it('Set up their models opens model setup', async () => {
    const { view, route } = mount('WhatYouUse');
    fireEvent.press(view.getByTestId('what-you-use-setup'));
    await waitFor(() => expect(route()).toBe('AutoSetup'));
  });
});
