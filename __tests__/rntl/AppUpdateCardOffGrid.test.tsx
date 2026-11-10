import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockCheck = jest.fn(async () => ({ current: 143, update: null }));
jest.mock('../../src/atlasTools/offGrid', () => ({ offGridOn: () => true }));
jest.mock('../../src/services/appUpdate', () => ({ installedBuild: () => 143, checkForUpdate: (...a: unknown[]) => (mockCheck as any)(...a), downloadAndInstall: jest.fn() }));

import { AppUpdateCard } from '../../src/components/settings/AppUpdateCard';

it('does not contact GitHub by itself in off-grid mode, but the button still checks when asked', async () => {
  const view = render(<AppUpdateCard />);
  expect(mockCheck).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('app-update-check'));
  await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
});
