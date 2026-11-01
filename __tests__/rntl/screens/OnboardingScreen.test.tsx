/**
 * Onboarding — the welcome slides shown on first launch.
 *
 * The real screen runs on a real stack navigator with the real slides, buttons and app store. A
 * swipe between slides is the pager's momentum-scroll-end event, as the OS reports it. Opening a link
 * hands it to the OS (Linking), which is faked to record the URL. Each test reads what the person sees
 * and which screen the app moves to.
 */
jest.unmock('@react-navigation/native');

import React from 'react';
import { Dimensions, FlatList, Linking, Text } from 'react-native';
import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingScreen } from '../../../src/screens/OnboardingScreen';
import { useAppStore } from '../../../src/stores/appStore';
import { ONBOARDING_SLIDES } from '../../../src/constants';

const Stack = createNativeStackNavigator();
const AutoSetupStub = () => <Text>AutoSetup screen</Text>;
const LAST = ONBOARDING_SLIDES.length - 1;

function mount() {
  const ref = createNavigationContainerRef<Record<string, undefined>>();
  const view = render(
    <NavigationContainer ref={ref}>
      <Stack.Navigator>
        <Stack.Screen name="Onboarding" component={OnboardingScreen as React.ComponentType<any>} />
        <Stack.Screen name="AutoSetup" component={AutoSetupStub} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  return { view, route: () => ref.getCurrentRoute()?.name };
}

const pager = (view: RenderResult) =>
  view.UNSAFE_getAllByType(FlatList).find(list => list.props.horizontal)!;

/** The OS lays the pager out: the list is one screen wide and each slide sits one screen to the right of the last. */
async function layOut(view: RenderResult) {
  const { width, height } = Dimensions.get('window');
  await act(async () => {
    fireEvent(pager(view), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
    ONBOARDING_SLIDES.forEach((slide, index) => {
      fireEvent(view.getByTestId(`onboarding-slide-${slide.id}`).parent!, 'layout', {
        nativeEvent: { layout: { x: index * width, y: 0, width, height } },
      });
    });
  });
}

/** Swipe the pager so it comes to rest on this slide. */
async function swipeTo(view: RenderResult, index: number) {
  const { width } = Dimensions.get('window');
  await act(async () => {
    fireEvent(pager(view), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: index * width, y: 0 } } });
  });
}

describe('OnboardingScreen', () => {
  beforeEach(() => {
    useAppStore.getState().setOnboardingComplete(false);
  });

  it('shows every slide, with Skip and Next on the first one', () => {
    const { view } = mount();

    expect(view.getByTestId('onboarding-screen')).toBeTruthy();
    expect(view.getByTestId('onboarding-dots')).toBeTruthy();
    for (const slide of ONBOARDING_SLIDES) {
      expect(view.getByTestId(`onboarding-slide-${slide.id}`)).toBeTruthy();
      expect(view.getByText(slide.keyword)).toBeTruthy();
      expect(view.getByText(slide.title)).toBeTruthy();
    }
    expect(view.getByTestId('onboarding-skip')).toBeTruthy();
    expect(view.getByText('Next')).toBeTruthy();
    expect(view.queryByText('Get Started')).toBeNull();
  });

  it('never clips the slides of its animated pager', () => {
    const { view } = mount();
    expect(pager(view).props.removeClippedSubviews).toBe(false);
  });

  it('Skip finishes onboarding and opens model setup', async () => {
    const { view, route } = mount();
    expect(route()).toBe('Onboarding');

    fireEvent.press(view.getByText('Skip'));

    await waitFor(() => expect(route()).toBe('AutoSetup'));
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(true);
  });

  it('swiping to the last slide turns Next into Get Started and hides Skip', async () => {
    const { view } = mount();
    expect(view.getByText('Next')).toBeTruthy();

    await swipeTo(view, LAST);

    expect(view.getByText('Get Started')).toBeTruthy();
    expect(view.queryByText('Next')).toBeNull();
    expect(view.queryByTestId('onboarding-skip')).toBeNull();
  });

  it('a slide before the last keeps Next, and Next there does not finish onboarding', async () => {
    const { view, route } = mount();
    await layOut(view);
    await swipeTo(view, LAST - 1);
    expect(view.getByText('Next')).toBeTruthy();

    fireEvent.press(view.getByTestId('onboarding-next'));

    expect(route()).toBe('Onboarding');
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(false);
  });

  it('Get Started on the last slide finishes onboarding and opens model setup', async () => {
    const { view, route } = mount();
    await swipeTo(view, LAST);

    fireEvent.press(view.getByTestId('onboarding-next'));

    await waitFor(() => expect(route()).toBe('AutoSetup'));
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(true);
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
