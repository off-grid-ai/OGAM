/**
 * AboutScreen — Follow / Community links.
 *
 * Follow-on-X and Join-Slack live once, in Settings > Community (SettingsScreen.test covers them there);
 * About no longer repeats them. The real screen runs on a real stack navigator with its real animated rows; the
 * OS link handler (Linking.openURL) is the device boundary, faked to record the URL it is handed.
 */
jest.unmock('@react-navigation/native');

import React from 'react';
import { Linking } from 'react-native';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AboutScreen } from '../../../src/screens/AboutScreen';

const Stack = createNativeStackNavigator();

function mount() {
  const opened: string[] = [];
  jest.spyOn(Linking, 'openURL').mockImplementation(async url => { opened.push(url); });
  const view = render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="About" component={AboutScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  return { view, opened };
}

describe('AboutScreen — Follow / Community', () => {
  afterEach(() => jest.restoreAllMocks());

  it('carries no X or Slack rows: they live once, in Settings > Community', () => {
    const { view, opened } = mount();

    expect(view.queryByText('Follow @alichherawalla on X')).toBeNull();
    expect(view.queryByTestId('about-follow-on-x')).toBeNull();
    expect(view.queryByTestId('about-join-slack')).toBeNull();
    expect(opened).toEqual([]);
  });
});
