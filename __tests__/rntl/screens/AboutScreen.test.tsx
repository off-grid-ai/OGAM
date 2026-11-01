/**
 * AboutScreen — Follow / Community links.
 *
 * The About screen carries the same Follow-on-X + Join-Slack affordances as Settings (the user asked for
 * them in BOTH places). The real screen runs on a real stack navigator with its real animated rows; the
 * OS link handler (Linking.openURL) is the device boundary, faked to record the URL it is handed.
 */
jest.unmock('@react-navigation/native');

import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AboutScreen } from '../../../src/screens/AboutScreen';
// Same shared constant the screen uses: the single source of truth, not a re-hardcoded string.
import { FOLLOW_X_URL } from '../../../src/utils/sharePrompt';

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

  it('shows the Follow-on-X and Join-Slack items', () => {
    const { view, opened } = mount();

    expect(view.getByText('Follow @alichherawalla on X')).toBeTruthy();
    expect(view.getByTestId('about-follow-on-x')).toBeTruthy();
    expect(view.getByTestId('about-join-slack')).toBeTruthy();
    expect(opened).toEqual([]);
  });

  it('Follow-on-X opens the X profile', () => {
    const { view, opened } = mount();

    fireEvent.press(view.getByTestId('about-follow-on-x'));

    expect(opened).toEqual([FOLLOW_X_URL]);
  });

  it('Join-Slack opens the Slack invite', () => {
    const { view, opened } = mount();

    fireEvent.press(view.getByTestId('about-join-slack'));

    expect(opened).toEqual([
      'https://join.slack.com/t/off-grid-mobile/shared_invite/zt-494gbuv5c-kj9tT7U0AS8Kq8UUO63_jw',
    ]);
  });
});
