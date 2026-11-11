import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ActionMenuSheet } from '../../src/components/ChatMessage/components/ActionMenuSheet';
import { PinsScreen } from '../../src/pins/PinsScreen';
import { usePins } from '../../src/pins/store';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) }));

const sheetProps = { visible: true, onClose: jest.fn(), isUser: false, canEdit: false, canRetry: false, canGenerateImage: false, canSpeak: false, styles: {},
  onCopy: jest.fn(), onEdit: jest.fn(), onRetry: jest.fn(), onGenerateImage: jest.fn(), onSpeak: jest.fn() };

it('the message menu offers Pin and Make slides, and a pinned message shows on the Pinned page until unpinned', () => {
  usePins.setState({ pins: [] });
  const onPin = jest.fn(); const onSlides = jest.fn();
  const menu = render(<ActionMenuSheet {...sheetProps} extras={{ pinned: false, onPin, onSlides }} />);
  fireEvent.press(menu.getByTestId('action-pin'));
  fireEvent.press(menu.getByTestId('action-slides'));
  expect(onPin).toHaveBeenCalled();
  expect(onSlides).toHaveBeenCalled();
  menu.unmount();

  usePins.getState().add({ id: 'm1', text: 'A plan worth keeping', role: 'assistant', conversationId: null, conversationTitle: 'Budget chat' });
  const page = render(<PinsScreen />);
  expect(page.getByText('Budget chat', { exact: false })).toBeTruthy();
  expect(page.getByText('A plan worth keeping')).toBeTruthy();
  fireEvent.press(page.getByTestId('pin-remove-m1'));
  expect(usePins.getState().pins).toHaveLength(0);
  expect(page.getByTestId('pins-empty')).toBeTruthy();
});
