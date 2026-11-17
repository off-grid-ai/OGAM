/**
 * UI integration: the private cloud (Boost) promo on the Models list and Model settings.
 * Real card, real store, real shared copy. Only the in-app browser (a native module) is faked.
 *
 * The product rule this pins: everyone sees it; its button opens the offer page in a sheet;
 * closing it keeps it closed, also after a relaunch; a new promo version shows it once more.
 */
jest.mock('react-native-inappbrowser-reborn', () => ({
  __esModule: true,
  default: { isAvailable: jest.fn(() => Promise.resolve(true)), open: jest.fn(() => Promise.resolve()), close: jest.fn() },
}));

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { BOOST_PROMO } from '@offgrid/models';
import { BoostPromoCard } from '../../../src/components/BoostPromoCard';
import { useAppStore } from '../../../src/stores/appStore';
import { websiteReach } from '../../harness/websiteReach';

let undoReach: () => void;
beforeEach(() => {
  useAppStore.setState({ boostPromoClosedVersion: null });
  (InAppBrowser.open as jest.Mock).mockClear();
  undoReach = websiteReach(true);
});
afterEach(() => undoReach());

describe('the private cloud promo', () => {
  it('shows the offer and opens its page in a sheet, tagged with where it was tapped', async () => {
    const view = render(<BoostPromoCard surface="models" />);
    expect(view.getByText('Smarter answers, without a bigger phone.')).toBeTruthy();

    fireEvent.press(view.getByTestId('boost-promo-claim'));

    await waitFor(() => expect(InAppBrowser.open).toHaveBeenCalledTimes(1));
    expect((InAppBrowser.open as jest.Mock).mock.calls[0][0]).toMatch(
      /^https:\/\/getoffgridai\.co\/boost\?utm_source=off-grid-mobile-app&utm_medium=boost-models&/,
    );
  });

  it('says it is offline instead of opening a page that cannot load', async () => {
    undoReach();
    undoReach = websiteReach(false);
    const view = render(<BoostPromoCard surface="models" />);
    fireEvent.press(view.getByTestId('boost-promo-claim'));
    await waitFor(() => expect(view.getByTestId('boost-promo-offline')).toBeTruthy());
    expect(InAppBrowser.open).not.toHaveBeenCalled();
  });

  it('stays closed once closed, on every surface', () => {
    const first = render(<BoostPromoCard surface="model_settings" />);
    fireEvent.press(first.getByTestId('boost-promo-close'));

    expect(first.queryByTestId('boost-promo')).toBeNull();
    expect(useAppStore.getState().boostPromoClosedVersion).toBe(BOOST_PROMO.version);
    expect(render(<BoostPromoCard surface="models" />).queryByTestId('boost-promo')).toBeNull();
  });

  it('shows again once a new version of the promo ships', () => {
    useAppStore.setState({ boostPromoClosedVersion: 'an-older-promo' });
    expect(render(<BoostPromoCard surface="models" />).getByTestId('boost-promo')).toBeTruthy();
  });
});
