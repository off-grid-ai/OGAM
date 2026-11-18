/**
 * Onboarding's picks on the phone: what you want to do → which ones → how it works → model setup.
 * The real screens on a real stack navigator, with the real shared feature list and the real app
 * store. Model setup is a stub that reads what it would check.
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
import { OnboardingGroupsScreen } from '../../../src/screens/OnboardingPicks/OnboardingGroupsScreen';
import { OnboardingFeaturesScreen } from '../../../src/screens/OnboardingPicks/OnboardingFeaturesScreen';
import { OnboardingGuideScreen } from '../../../src/screens/OnboardingPicks/OnboardingGuideScreen';
import { useAppStore } from '../../../src/stores/appStore';
import { setupKindsForPicks } from '../../../src/services/onboardingPicks';

const Stack = createNativeStackNavigator();
const AutoSetupStub = () => (
  <Text>{`setup checks ${setupKindsForPicks(
    useAppStore.getState().onboardingPicks,
    false,
  ).join(',')}`}</Text>
);
const TopicStub = () => <Text>topic page</Text>;

function mount() {
  const ref =
    createNavigationContainerRef<Record<string, object | undefined>>();
  const view = render(
    <NavigationContainer ref={ref}>
      <Stack.Navigator>
        <Stack.Screen
          name="OnboardingGroups"
          component={OnboardingGroupsScreen as React.ComponentType<any>}
        />
        <Stack.Screen
          name="OnboardingFeatures"
          component={OnboardingFeaturesScreen as React.ComponentType<any>}
        />
        <Stack.Screen
          name="OnboardingGuide"
          component={OnboardingGuideScreen as React.ComponentType<any>}
        />
        <Stack.Screen name="GuideTopic" component={TopicStub} />
        <Stack.Screen name="AutoSetup" component={AutoSetupStub} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  return {
    view,
    route: () => ref.getCurrentRoute()?.name,
    back: () => ref.goBack(),
  };
}

const checked = (view: ReturnType<typeof mount>['view'], id: string) =>
  view.getByTestId(id).props.accessibilityState?.checked;

describe('onboarding picks on the phone', () => {
  beforeEach(() => {
    useAppStore.setState({
      onboardingPicks: null,
      hasCompletedOnboarding: false,
    });
  });

  it('picks groups, then features, sees how they work, and setup checks what they need', async () => {
    const { view, route } = mount();
    expect(checked(view, 'onboarding-group-chat')).toBe(true);
    // Remember and Meetings are the computer's: the phone does not offer them.
    expect(view.queryByTestId('onboarding-group-meetings')).toBeNull();

    fireEvent.press(view.getByTestId('onboarding-group-create'));
    expect(useAppStore.getState().onboardingPicks).toEqual({
      groups: ['chat', 'create'],
      parts: ['chat', 'images'],
    });

    fireEvent.press(view.getByTestId('onboarding-continue'));
    await waitFor(() => expect(route()).toBe('OnboardingFeatures'));
    expect(checked(view, 'onboarding-part-images')).toBe(true);
    expect(checked(view, 'onboarding-part-ask-photo')).toBe(false);
    expect(view.queryByTestId('onboarding-part-dictation')).toBeNull();

    fireEvent.press(view.getByTestId('onboarding-continue'));
    await waitFor(() => expect(route()).toBe('OnboardingGuide'));
    fireEvent.press(view.getByTestId('onboarding-topic-phone-images'));
    await waitFor(() => expect(route()).toBe('GuideTopic'));
  });

  it('Set up my models finishes onboarding with the picks kept, and setup checks chat and images', async () => {
    useAppStore.setState({
      onboardingPicks: {
        groups: ['chat', 'create'],
        parts: ['chat', 'images'],
      },
    });
    const { view, route } = mount();
    fireEvent.press(view.getByTestId('onboarding-continue'));
    await waitFor(() => expect(route()).toBe('OnboardingFeatures'));
    fireEvent.press(view.getByTestId('onboarding-continue'));
    await waitFor(() => expect(route()).toBe('OnboardingGuide'));
    fireEvent.press(view.getByTestId('onboarding-finish'));
    await waitFor(() => expect(route()).toBe('AutoSetup'));
    expect(view.getByText('setup checks text,image')).toBeTruthy();
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(true);
  });

  it('nothing picked: Continue waits; skip keeps no picks, so setup checks chat alone as before', async () => {
    const { view, route } = mount();
    fireEvent.press(view.getByTestId('onboarding-group-chat'));
    expect(
      view.getByTestId('onboarding-continue').props.accessibilityState
        ?.disabled,
    ).toBe(true);

    fireEvent.press(view.getByTestId('onboarding-skip'));
    await waitFor(() => expect(route()).toBe('AutoSetup'));
    expect(useAppStore.getState().onboardingPicks).toBeNull();
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(true);
    expect(view.getByText('setup checks text')).toBeTruthy();
  });

  it('a Pro pick offers Pro on the details step', async () => {
    useAppStore.setState({
      onboardingPicks: { groups: ['write'], parts: ['notes'] },
    });
    const { view, route } = mount();
    fireEvent.press(view.getByTestId('onboarding-continue'));
    await waitFor(() => expect(route()).toBe('OnboardingFeatures'));
    const partIds = ['notes', 'dictation', 'scribe'].filter(id =>
      view.queryByTestId(`onboarding-part-${id}`),
    );
    expect(partIds.length).toBeGreaterThan(0);
    const proOffer = view.queryByTestId('onboarding-pro-offer');
    // Notes is Pro on the phone exactly when the shared list says so.
    const { partById, tierOf } = jest.requireActual('@offgrid/features');
    expect(Boolean(proOffer)).toBe(
      tierOf(partById('notes'), 'mobile') === 'pro',
    );
  });
});
