import React from 'react';
import {Linking, Share} from 'react-native';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import {ContentMigrationSurface} from '../../../src/components/migrations/ContentMigrationSurface';

const PRIVATE_SENTINEL = 'private conversation text must stay local';

const failedStatus = {
  phase: 'settled' as const,
  migration: {
    state: 'failed' as const,
    runId: 'content-migration-test',
    sequence: 4,
    progress: 0.42,
    retryEligible: true,
    failedFrom: 'copying' as const,
    error: `FOREIGN KEY constraint failed: ${PRIVATE_SENTINEL}`,
  },
};

describe('content migration support', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('offers support from the failed surface and shares only allow-listed diagnostics', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({
      action: Share.sharedAction,
    });
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockImplementation(async () => undefined);
    const screen = render(<ContentMigrationSurface status={failedStatus} />);

    expect(screen.getByText('Workspace update stopped')).toBeTruthy();
    expect(
      screen.getByText(
        'The report contains update state and record counts only. It does not include your messages, project details, conversation titles, prompts, or files.',
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByRole('button', {name: 'Share diagnostics'}));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const sharedMessage = String(share.mock.calls[0]?.[0].message);
    expect(sharedMessage).toContain('Error category: database-foreign-key');
    expect(sharedMessage).not.toContain(PRIVATE_SENTINEL);

    fireEvent.press(screen.getByRole('button', {name: 'Email support'}));
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1));
    const emailUrl = decodeURIComponent(String(openURL.mock.calls[0]?.[0]));
    expect(emailUrl).toContain('support@getoffgridai.co');
    expect(emailUrl).toContain('Error category: database-foreign-key');
    expect(emailUrl).not.toContain(PRIVATE_SENTINEL);
  });
});
