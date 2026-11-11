import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockInstall = jest.fn(async () => 'started');
jest.mock('../../src/services/appUpdate', () => ({
  installedBuild: () => 143,
  checkForUpdate: jest.fn(async () => ({ current: 143, update: { build: 144, tag: 'atlas-144', name: 'Atlas build 144', apkUrl: 'u', size: 258_000_000, notes: 'What is new' } })),
  downloadAndInstall: (...a: unknown[]) => (mockInstall as any)(...a),
  UpdateCancelled: class UpdateCancelled extends Error {},
}));

import { AppUpdateCard } from '../../src/components/settings/AppUpdateCard';

it('says a newer build is published and downloads and installs it on one tap', async () => {
  const view = render(<AppUpdateCard />);
  expect(view.getByText('This is build 143.')).toBeTruthy();
  await waitFor(() => expect(view.getByTestId('app-update-status').props.children).toMatch(/Atlas build 144 is available \(258 MB\)/));
  fireEvent.press(view.getByTestId('app-update-install'));
  await waitFor(() => expect(mockInstall).toHaveBeenCalled());
  expect((mockInstall.mock.calls[0] as any)[0].build).toBe(144);
});

it('shows what is new only when asked', async () => {
  const view = render(<AppUpdateCard />);
  await waitFor(() => expect(view.getByTestId('app-update-notes-toggle')).toBeTruthy());
  expect(view.queryByTestId('app-update-notes')).toBeNull();
  fireEvent.press(view.getByTestId('app-update-notes-toggle'));
  expect(view.getByTestId('app-update-notes').props.children).toBe('What is new');
});

it('shows a Cancel button while downloading, and goes back to the offer when it is pressed', async () => {
  const { UpdateCancelled } = require('../../src/services/appUpdate');
  mockInstall.mockImplementationOnce((async (_u: unknown, _p: unknown, onCancel: (c: () => void) => void) => new Promise((_res, rej) => onCancel(() => rej(new UpdateCancelled())))) as any);
  const view = render(<AppUpdateCard />);
  await waitFor(() => expect(view.getByTestId('app-update-install')).toBeTruthy());
  fireEvent.press(view.getByTestId('app-update-install'));
  await waitFor(() => expect(view.getByTestId('app-update-cancel')).toBeTruthy());
  fireEvent.press(view.getByTestId('app-update-cancel'));
  await waitFor(() => expect(view.getByTestId('app-update-install')).toBeTruthy());
  expect(view.getByTestId('app-update-status').props.children).toMatch(/is available/);
});
