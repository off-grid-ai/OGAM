/**
 * The Pro features screen sells nothing.
 *
 * SPEC (OGAM user's view): the screen every Pro entry point opens — the Home crown, Settings, the Tools
 * page, the chat assistant gate — states that everything is free, and offers no price, no checkout, no
 * licence-key field and no subscription. What it can still do is be honest about the BUILD: a build
 * without the optional pro bundle says so, rather than promising features that are not compiled in.
 *
 * The bundle is represented the way the app represents it — by registering its screens — so this suite
 * exercises the same signal the rest of the app reads (useIsProActive → the screen registry).
 */
import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { OFF_GRID_DESKTOP_BENEFIT } from '../../../src/constants';
import {
  registerScreen,
  _clearScreensForTesting,
} from '../../../src/navigation/screenRegistry';
import { PRO_TOOLS_SCREEN } from '../../../src/hooks/useIsProActive';
import { ProDetailScreen } from '../../../src/screens/ProDetailScreen';

describe('the Pro features screen', () => {
  beforeEach(() => {
    _clearScreensForTesting();
  });
  afterEach(() => {
    _clearScreensForTesting();
  });

  it('says everything is free, and asks for nothing', () => {
    const { getByText, queryByText } = render(<ProDetailScreen />);

    expect(getByText('Everything is free.')).toBeTruthy();
    expect(queryByText('Get Pro')).toBeNull();
    expect(queryByText('I have a license key')).toBeNull();
    expect(queryByText(/Enter your license key/)).toBeNull();
    expect(queryByText(/\$119|\$7\.99|per month|lifetime/i)).toBeNull();
  });

  it('explains an absent bundle instead of selling it', () => {
    const { getByText } = render(<ProDetailScreen />);
    expect(getByText(/does not include the optional Pro bundle/)).toBeTruthy();
  });

  it('marks this build included once the bundle has registered its screens', () => {
    registerScreen({ name: PRO_TOOLS_SCREEN, component: () => null });

    const { getByText, queryByText } = render(<ProDetailScreen />);

    expect(getByText('Included')).toBeTruthy();
    expect(queryByText(/does not include the optional Pro bundle/)).toBeNull();
  });

  it('still points at the free Desktop companion', () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const { getByText } = render(<ProDetailScreen />);

    fireEvent.press(getByText(OFF_GRID_DESKTOP_BENEFIT));

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('getoffgridai.co/desktop'),
    );
    spy.mockRestore();
  });
});
