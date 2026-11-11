/**
 * Home reminds the person to back up when it has been a while; saving a backup resets it,
 * and "In a week" hides it. The file picker is the device boundary.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@react-native-documents/picker', () => ({
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: () => false,
  pick: jest.fn(),
  types: {},
  saveDocuments: jest.fn(async ({ fileName }: { fileName: string }) => [{ name: fileName }]),
}));

import { BackupReminderCard } from '../../../src/components/BackupReminderCard';
import { useBackupReminder } from '../../../src/atlasTools/backupReminder';
import { exportBackup } from '../../../src/atlasTools/backup';

const DAY = 864e5;

it('shows after a while without a backup, hides for a week, and goes away once a backup is saved', async () => {
  const open = jest.fn();
  useBackupReminder.setState({ since: Date.now() - 10 * DAY, lastBackupAt: null, snoozedUntil: 0 });
  const card = render(<BackupReminderCard onOpenSettings={open} />);
  expect(card.getByText(/No backup made on this phone yet/)).toBeTruthy();
  fireEvent.press(card.getByTestId('backup-reminder-open'));
  expect(open).toHaveBeenCalled();

  fireEvent.press(card.getByTestId('backup-reminder-later'));
  expect(card.queryByTestId('backup-reminder')).toBeNull();

  act(() => { useBackupReminder.setState({ snoozedUntil: 0 }); });
  expect(card.getByTestId('backup-reminder')).toBeTruthy();
  await act(async () => { await exportBackup(); });
  expect(card.queryByTestId('backup-reminder')).toBeNull();
  expect(useBackupReminder.getState().lastBackupAt).toBeGreaterThan(Date.now() - 5000);
});
