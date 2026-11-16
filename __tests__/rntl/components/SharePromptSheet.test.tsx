/**
 * SharePromptSheet Component Tests
 *
 * The in-chat rating ask: Rate opens the store's own review dialog once the sheet has closed.
 * Faked: the store dialog (react-native-in-app-review) and Linking - the phone's UI.
 * Priority: P1 (High)
 */

import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import InAppReview from 'react-native-in-app-review';
import { SharePromptSheet } from '../../../src/components/SharePromptSheet';
import { useAppStore } from '../../../src/stores/appStore';

jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);
jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);

const request = InAppReview.RequestInAppReview as jest.Mock;
const isAvailable = InAppReview.isAvailable as jest.Mock;

/** Mounted the way ChatScreen mounts it: closing flips `visible` off. */
function Host({ onClose }: { onClose: () => void }) {
  const [visible, setVisible] = React.useState(true);
  return (
    <SharePromptSheet
      visible={visible}
      trigger="text"
      onClose={() => {
        onClose();
        setVisible(false);
      }}
    />
  );
}

function renderSheet(onClose = jest.fn()) {
  return { ...render(<Host onClose={onClose} />), onClose };
}

describe('SharePromptSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isAvailable.mockReturnValue(true);
    request.mockResolvedValue(true);
    useAppStore.setState({ hasEngagedSharePrompt: false });
  });

  it('asks one short question with Rate and both dismissal choices, and no GitHub button', () => {
    const { getByText, queryByText } = renderSheet();
    expect(getByText('Did that just work for you?')).toBeTruthy();
    expect(getByText('Rate Off Grid AI')).toBeTruthy();
    expect(getByText('Not now')).toBeTruthy();
    expect(getByText("Don't ask again")).toBeTruthy();
    expect(queryByText(/GitHub/)).toBeNull();
    expect(queryByText(/completely free/)).toBeNull();
  });

  it('Rate closes the sheet, marks it done, then opens the store dialog in the app', async () => {
    const { getByText, onClose } = renderSheet();
    fireEvent.press(getByText('Rate Off Grid AI'));
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().hasEngagedSharePrompt).toBe(true);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('Rate falls back to the store page when the native dialog is unavailable', async () => {
    isAvailable.mockReturnValue(false);
    const { getByText } = renderSheet();
    fireEvent.press(getByText('Rate Off Grid AI'));
    await waitFor(() => {
      expect(Linking.openURL).toHaveBeenCalledWith(
        expect.stringMatching(/^(https:\/\/apps\.apple\.com\/app\/id|https:\/\/play\.google\.com\/store)/),
      );
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('Not now closes without marking done or asking for a rating', () => {
    const { getByText, onClose } = renderSheet();
    fireEvent.press(getByText('Not now'));
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().hasEngagedSharePrompt).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("Don't ask again persists the choice and never asks for a rating", () => {
    const { getByText, onClose } = renderSheet();
    fireEvent.press(getByText("Don't ask again"));
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().hasEngagedSharePrompt).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});
