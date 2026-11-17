/**
 * The Pro pitch has one purchase path and one key-entry path. A second action that offered to use
 * another device's licence duplicated the Sync journey and made the purchase screen ambiguous.
 *
 * This test enters through the real Home screen and real app navigation. Native rendering remains
 * supplied by the Jest environment, but every Off Grid screen, store action, and route is real.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import { useAppStore } from '../../../src/stores/appStore';
import { createDeviceInfo, createDownloadedModel } from '../../utils/factories';
import { websiteReach } from '../../harness/websiteReach';

describe('Pro entry from Home', () => {
  beforeEach(() => {
    const model = createDownloadedModel();
    const app = useAppStore.getState();

    // Use the production store actions to restore a returning user's local app state. The behavior
    // under test starts with their real Home-screen gesture below.
    app.setOnboardingComplete(true);
    app.setDeviceInfo(createDeviceInfo());
    app.setDownloadedModels([model]);
    app.setActiveModelId(model.id);
  });

  afterEach(() => {
    const app = useAppStore.getState();
    app.setActiveModelId(null);
    app.setDownloadedModels([]);
    app.setOnboardingComplete(false);
  });

  it('the crown opens the checkout sheet, not the Pro page, for someone without Pro', async () => {
    // BOUNDARY: no in-app browser module under jest, so checkout opens through the system browser.
    const opened: string[] = [];
    const openURL = Linking.openURL;
    Linking.openURL = async (url: string) => { opened.push(url); };
    // Our site answers, so checkout opens.
    const undoReach = websiteReach(true);
    const ui = render(
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>,
    );

    fireEvent.press(ui.getByLabelText('Open Off Grid AI Pro'));

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toMatch(/^https:\/\/getoffgridai\.co\/pro\/app\/\?theme=(dark|light)&.*utm_medium=home-crown/);
    expect(ui.queryByText('I have a license key')).toBeNull();

    undoReach();
    Linking.openURL = openURL;
    ui.unmount();
  });

  it('the Pro page has its two valid actions and no device-licence shortcut', async () => {
    const nav = createNavigationContainerRef();
    const ui = render(
      <NavigationContainer ref={nav}>
        <AppNavigator />
      </NavigationContainer>,
    );

    // The Pro page is reached from the sheet's "Have a key?" or by someone with Pro.
    await waitFor(() => expect(nav.isReady()).toBe(true));
    act(() => (nav.navigate as (name: string) => void)('ProDetail'));

    expect(await ui.findByText('Off Grid AI Pro')).toBeTruthy();
    expect(ui.getAllByText('Get Pro').length).toBeGreaterThan(0);
    expect(ui.getByText('I have a license key')).toBeTruthy();
    expect(ui.queryByText('Use Pro from another device')).toBeNull();

    ui.unmount();
  });
});
