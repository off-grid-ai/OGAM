/**
 * Onboarding — the one page about Off Grid AI shown on first launch, before "What do you want to do?".
 *
 * The real screen runs on a real stack navigator with the real intro, button and app store. Opening a
 * link hands it to the OS (Linking), which is faked to record the URL. Each test reads what the person
 * sees and which screen the app moves to.
 */
jest.unmock('@react-navigation/native');

import React from 'react';
import { Linking, Text } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingScreen } from '../../../src/screens/OnboardingScreen';
import { useAppStore } from '../../../src/stores/appStore';
import { onboardingIntro } from '../../../src/constants';

const Stack = createNativeStackNavigator();
const GroupsStub = () => <Text>What do you want to do?</Text>;

function mount() {
  const ref = createNavigationContainerRef<Record<string, undefined>>();
  const view = render(
    <NavigationContainer ref={ref}>
      <Stack.Navigator>
        <Stack.Screen name="Onboarding" component={OnboardingScreen as React.ComponentType<any>} />
        <Stack.Screen name="OnboardingGroups" component={GroupsStub} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  return { view, route: () => ref.getCurrentRoute()?.name };
}

describe('OnboardingScreen', () => {
  beforeEach(() => {
    useAppStore.getState().setOnboardingComplete(false);
  });

  it('is one page about Off Grid AI: no pager, no dots, no Skip, just Get Started', () => {
    const { view } = mount();

    expect(view.getByTestId('onboarding-intro')).toBeTruthy();
    expect(view.getByText(onboardingIntro().keyword)).toBeTruthy();
    expect(view.getByText(onboardingIntro().title)).toBeTruthy();
    expect(view.getByText(onboardingIntro().description)).toBeTruthy();
    expect(view.getByText('Get Started')).toBeTruthy();
    expect(view.queryByText('Next')).toBeNull();
    expect(view.queryByText('Skip')).toBeNull();
    expect(view.queryByTestId('onboarding-dots')).toBeNull();
    // The old tour pages are gone.
    for (const gone of ['MAGIC', 'CREATE', 'BIGGER', 'SYNC', 'READY']) {
      expect(view.queryByText(gone)).toBeNull();
    }
  });

  it('Get Started goes straight to what you want to do; onboarding is done only once the picks are', async () => {
    const { view, route } = mount();
    expect(route()).toBe('Onboarding');

    fireEvent.press(view.getByTestId('onboarding-next'));

    await waitFor(() => expect(route()).toBe('OnboardingGroups'));
    expect(view.getByText('What do you want to do?')).toBeTruthy();
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(false);
  });

  it('"made with love by Wednesday" opens wednesday.is', () => {
    const opened: string[] = [];
    const openURL = jest.spyOn(Linking, 'openURL').mockImplementation(async url => { opened.push(url); });
    try {
      const { view } = mount();

      fireEvent.press(view.getByText('Wednesday'));

      expect(opened).toEqual(['https://wednesday.is']);
    } finally {
      openURL.mockRestore();
    }
  });
});
