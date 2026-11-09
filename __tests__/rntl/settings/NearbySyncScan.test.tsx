/**
 * Offline sync pairing by scanning: the person turns sync on, taps Scan the other device's
 * code, the in-app camera reads the Atlas code, and the devices pair. Fakes only the device
 * boundary (the native sync and QR scanner modules, the camera permission).
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

it('pairs by scanning the other device\'s code in the app', async () => {
  const RN = require('react-native');
  RN.Platform.OS = 'android';
  RN.PermissionsAndroid.request = jest.fn(async () => 'granted');
  const link = 'atlas://sync?id=peer1234&key=abc';
  const reply = JSON.stringify({ version: 1, sourceId: 'peer1234', projects: [], conversations: [], agents: [] });
  RN.NativeModules.AtlasNearbySync = {
    start: jest.fn(async () => ({ deviceId: 'mine5678', address: '10.0.0.2', port: 1 })),
    stop: jest.fn(async () => true), peers: jest.fn(async () => []),
    pair: jest.fn(async () => ({ peerId: 'peer1234', payload: reply, transport: 'wifi' })),
    addListener: jest.fn(), removeListeners: jest.fn(),
  };
  RN.NativeModules.AtlasQrScanner = { scan: jest.fn(async () => link) };
  jest.spyOn(RN.Alert, 'alert').mockImplementation(() => undefined);
  const { NearbySyncSettings } = require('../../../src/components/settings/NearbySyncSettings');

  const screen = render(<NearbySyncSettings />);
  expect(screen.getByText(/no password\. Syncs chats, agents/)).toBeTruthy();
  fireEvent(screen.getByTestId('nearby-sync-toggle'), 'valueChange', true);
  fireEvent.press(await screen.findByTestId('nearby-scan-button'));
  await waitFor(() => expect(RN.NativeModules.AtlasNearbySync.pair).toHaveBeenCalled());
  expect(RN.NativeModules.AtlasQrScanner.scan).toHaveBeenCalledWith('atlas://sync?', expect.any(String));
  expect(RN.NativeModules.AtlasNearbySync.pair.mock.calls[0][0]).toBe(link);
  // What is sent includes the rest of Atlas (settings, course, recordings), not only chats.
  expect(JSON.parse(RN.NativeModules.AtlasNearbySync.pair.mock.calls[0][1])).toHaveProperty('stores');
  await waitFor(() => expect(RN.Alert.alert).toHaveBeenCalledWith('Paired', expect.any(String)));
  RN.NativeModules.AtlasNearbySync.stop = jest.fn(async () => true);
  await require('../../../src/services/nearbySync').nearbySync.setEnabled(false);
});

it('says where to turn the camera back on when it was refused for good', async () => {
  const RN = require('react-native');
  RN.Platform.OS = 'android';
  RN.PermissionsAndroid.request = jest.fn(async () => 'never_ask_again');
  RN.NativeModules.AtlasQrScanner = { scan: jest.fn(async () => null) };
  const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => undefined);
  const { NearbySyncSettings } = require('../../../src/components/settings/NearbySyncSettings');

  const screen = render(<NearbySyncSettings />);
  fireEvent(screen.getByTestId('nearby-sync-toggle'), 'valueChange', true);
  fireEvent.press(await screen.findByTestId('nearby-scan-button'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not scan', expect.stringMatching(/Android Settings > Apps > Atlas/)));
  expect(RN.NativeModules.AtlasQrScanner.scan).not.toHaveBeenCalled();
  RN.NativeModules.AtlasNearbySync.stop = jest.fn(async () => true);
  await require('../../../src/services/nearbySync').nearbySync.setEnabled(false);
});
