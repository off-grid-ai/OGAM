/**
 * SharePromptSheet Component Tests
 *
 * Tests for the share/star prompt bottom sheet.
 * Priority: P1 (High)
 */

import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SharePromptSheet } from '../../../src/components/SharePromptSheet';
import { useAppStore } from '../../../src/stores/appStore';
import { GITHUB_URL } from '../../../src/utils/sharePrompt';

jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);
jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);

function renderSheet(onClose = jest.fn()) {
  const result = render(<SharePromptSheet visible={true} onClose={onClose} />);
  return { ...result, onClose };
}

describe('SharePromptSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({ hasEngagedSharePrompt: false });
  });

  it('renders message, buttons, and dismiss link', () => {
    const { getByText } = renderSheet();
    expect(getByText(/Off Grid is completely free/)).toBeTruthy();
    expect(getByText('Star on GitHub')).toBeTruthy();
    expect(getByText('Share on X')).toBeTruthy();
    expect(getByText('Maybe later')).toBeTruthy();
  });

  it('opens GitHub URL, marks engaged, and closes on Star press', () => {
    const { getByText, onClose } = renderSheet();
    fireEvent.press(getByText('Star on GitHub'));
    expect(Linking.openURL).toHaveBeenCalledWith(GITHUB_URL);
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().hasEngagedSharePrompt).toBe(true);
  });

  it('shares to X, marks engaged, and closes on Share press', async () => {
    const { getByText, onClose } = renderSheet();
    fireEvent.press(getByText('Share on X'));
    // Engagement + close are synchronous; the X open resolves on the next tick
    // (uses the x.com/intent/post web intent).
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().hasEngagedSharePrompt).toBe(true);
    await waitFor(() => {
      expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/x\.com\/intent\/post/));
    });
  });

  it('closes without marking engaged on Maybe later press', () => {
    const { getByText, onClose } = renderSheet();
    fireEvent.press(getByText('Maybe later'));
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().hasEngagedSharePrompt).toBe(false);
  });
});
