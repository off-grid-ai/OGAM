/**
 * Onboarding "Set Up Your AI" → Network Models empty state must lead with Off Grid AI Desktop
 * (the first-party server) and offer a tappable "Get Off Grid AI Desktop" link.
 *
 * Bug (ModelDownloadHelpers.tsx): the empty-state copy named only "Ollama or LM Studio server" and
 * had NO link — the user never saw the first-party Off Grid AI Desktop server nor a way to get it.
 *
 * Product-correct outcome (OGAM user's view): with no servers found and not scanning, the copy names
 * "Off Grid AI Desktop" first, and tapping "Get Off Grid AI Desktop" opens the desktop URL (UTM-tagged,
 * mirroring the sibling ModelDownloadScreen alert action).
 *
 * Entry point + gesture: mount the REAL NetworkSection (the onboarding network-section component) in
 * its EMPTY state (servers=[], not checking, not scanning) with REAL theme colors, assert the rendered
 * copy + link, then fire a REAL press on the link.
 *
 * Boundary fake (ONLY the device boundary): react-native Linking.openURL — the OS deep-link handler.
 * Everything above it — the component, the styles, the withUtm builder, the URL constant — runs REAL.
 *
 * Falsification (shown in the report): before the fix the "Get Off Grid AI Desktop" link is absent
 * (queryByTestId('onboarding-get-desktop') is null) and pressing the unrelated "Scan Network" button
 * does NOT call Linking.openURL — so a false green cannot hide.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { NetworkSection } from '../../../src/screens/ModelDownloadHelpers';
import { getTheme } from '../../../src/theme';
import { OFF_GRID_DESKTOP_URL } from '../../../src/constants';
import { withUtm } from '../../../src/utils/utm';

// Fake ONLY the device boundary — the OS URL opener. openURL returns a resolved promise like the real
// module does on a device that can handle the link.
const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as unknown as never);

/** Mount the real network section in its empty state (no servers, not scanning). */
function renderEmptyNetworkSection() {
  const { colors } = getTheme('dark');
  return render(
    <NetworkSection
      servers={[]}
      discoveredModels={{}}
      connectingServerId={null}
      connectedServerId={null}
      isCheckingNetwork={false}
      isScanning={false}
      onConnectServer={() => {}}
      onScanNetwork={() => {}}
      onAddManually={() => {}}
      colors={colors}
    />,
  );
}

describe('Onboarding network empty state — leads with Off Grid AI Desktop + Get Desktop link', () => {
  beforeEach(() => {
    openURLSpy.mockClear();
  });

  it('names Off Grid AI Desktop in the empty-state copy and opens the desktop URL when the link is tapped', () => {
    const ui = renderEmptyNetworkSection();

    // Terminal artifact 1: the copy the user reads names the first-party server first.
    expect(ui.getByText(/Off Grid AI Desktop, Ollama, or LM Studio server/)).toBeTruthy();

    // Terminal artifact 2: a tappable link is present.
    const link = ui.getByTestId('onboarding-get-desktop');
    expect(ui.getByText('Get Off Grid AI Desktop')).toBeTruthy();

    // Real gesture: tap the link.
    fireEvent.press(link);

    // Behavior: it opened the UTM-tagged desktop URL through the device boundary.
    expect(openURLSpy).toHaveBeenCalledWith(withUtm(OFF_GRID_DESKTOP_URL, 'model-download'));
  });

  it('does not open any URL when an unrelated control (Scan Network) is pressed — falsifier', () => {
    const ui = renderEmptyNetworkSection();

    fireEvent.press(ui.getByText('Scan Network'));

    expect(openURLSpy).not.toHaveBeenCalled();
  });
});
