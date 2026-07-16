/**
 * AboutScreen — Follow / Community links.
 *
 * The About screen carries the same Follow-on-X + Join-Slack affordances as Settings (the user asked for
 * them in BOTH places). These guards prove the links render and each hands the OS the correct shared URL
 * constant when tapped. Falsify: wire either link to the wrong URL -> the openURL assertion fails.
 */
import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
// Same shared constants the screen uses — assert against the single source of truth, not re-hardcoded strings.
import { FOLLOW_X_URL, SLACK_INVITE_URL } from '../../../src/utils/sharePrompt';

// Navigation is globally mocked in jest.setup.ts.
jest.mock('../../../src/hooks/useFocusTrigger', () => ({ useFocusTrigger: () => 0 }));

jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, style, testID }: any) => {
    const { TouchableOpacity } = require('react-native');
    return <TouchableOpacity style={style} onPress={onPress} testID={testID}>{children}</TouchableOpacity>;
  },
}));

jest.mock('../../../package.json', () => ({ version: '1.0.0' }), { virtual: true });

import { AboutScreen } from '../../../src/screens/AboutScreen';

describe('AboutScreen — Follow / Community', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renders the Follow-on-X and Join-Slack items', () => {
    const { getByText, getByTestId } = render(<AboutScreen />);
    expect(getByText('Follow @alichherawalla on X')).toBeTruthy();
    expect(getByTestId('about-follow-on-x')).toBeTruthy();
    expect(getByTestId('about-join-slack')).toBeTruthy();
  });

  it('opens the X profile URL when Follow-on-X is tapped', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const { getByTestId } = render(<AboutScreen />);
    fireEvent.press(getByTestId('about-follow-on-x'));
    expect(openURL).toHaveBeenCalledWith(FOLLOW_X_URL);
  });

  it('opens the Slack invite URL when Join-Slack is tapped', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const { getByTestId } = render(<AboutScreen />);
    fireEvent.press(getByTestId('about-join-slack'));
    expect(openURL).toHaveBeenCalledWith(SLACK_INVITE_URL);
  });
});
