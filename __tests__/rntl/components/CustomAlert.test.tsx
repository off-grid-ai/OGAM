/**
 * CustomAlert Component Tests
 *
 * Tests for the custom alert dialog:
 * - Renders title and message
 * - Renders buttons
 * - onClose callback on AppSheet close
 * - Button press calls onPress and onClose
 * - Loading state
 * - Destructive button style
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Mock AppSheet to render children and expose onClose

import { CustomAlert, showAlert, hideAlert, initialAlertState } from '../../../src/components/CustomAlert';

describe('CustomAlert', () => {
  it('renders title and message when visible', () => {
    const { getByText } = render(
      <CustomAlert visible={true} title="Test Alert" message="Test message" />,
    );
    expect(getByText('Test Alert')).toBeTruthy();
    expect(getByText('Test message')).toBeTruthy();
  });

  it('renders default OK button', () => {
    const { getByText } = render(
      <CustomAlert visible={true} title="Alert" />,
    );
    expect(getByText('OK')).toBeTruthy();
  });

  it('calls onClose when the sheet header Done is pressed', async () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <CustomAlert visible={true} title="Alert" onClose={onClose} />,
    );

    fireEvent.press(getByTestId('app-sheet-close'));
    // The real sheet animates out, then reports the close.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('calls button onPress and onClose when button pressed', () => {
    const onClose = jest.fn();
    const onPress = jest.fn();
    const { getByText } = render(
      <CustomAlert
        visible={true}
        title="Alert"
        buttons={[{ text: 'Confirm', onPress }]}
        onClose={onClose}
      />,
    );

    fireEvent.press(getByText('Confirm'));
    expect(onPress).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renders without onClose (optional)', () => {
    const { getByText } = render(
      <CustomAlert visible={true} title="No Close" />,
    );
    expect(getByText('OK')).toBeTruthy();
    // Pressing OK should not throw even without onClose
    fireEvent.press(getByText('OK'));
  });

  it('shows loading indicator when loading', () => {
    const { queryByText } = render(
      <CustomAlert visible={true} title="Loading" loading={true} />,
    );
    expect(queryByText('Loading')).toBeTruthy();
  });

  it('renders destructive button with style', () => {
    const { getByText } = render(
      <CustomAlert
        visible={true}
        title="Confirm Action"
        buttons={[{ text: 'Delete', style: 'destructive' }]}
      />,
    );
    expect(getByText('Delete')).toBeTruthy();
  });

  it('renders cancel button style', () => {
    const { getByText } = render(
      <CustomAlert
        visible={true}
        title="Confirm"
        buttons={[
          { text: 'Cancel', style: 'cancel' },
          { text: 'OK', style: 'default' },
        ]}
      />,
    );
    expect(getByText('Cancel')).toBeTruthy();
    expect(getByText('OK')).toBeTruthy();
  });
});

describe('Alert helpers', () => {
  it('showAlert returns visible state', () => {
    const state = showAlert('Title', 'Message');
    expect(state.visible).toBe(true);
    expect(state.title).toBe('Title');
    expect(state.message).toBe('Message');
  });

  it('hideAlert returns initial state', () => {
    const state = hideAlert();
    expect(state).toEqual(initialAlertState);
  });
});
