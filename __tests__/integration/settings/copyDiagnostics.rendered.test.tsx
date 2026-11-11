/**
 * About > Copy diagnostics: one tap puts a summary of the phone and its speeds on the clipboard.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Clipboard } from 'react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));
jest.mock('llama.rn', () => ({ BuildInfo: { number: 'test' }, getBackendDevicesInfo: jest.fn(async () => []) }));
jest.mock('../../../src/hooks/useFocusTrigger', () => ({ useFocusTrigger: () => 0 }));
jest.mock('../../../src/components/AnimatedListItem', () => ({ AnimatedListItem: ({ children }: any) => children }));

import { AboutScreen } from '../../../src/screens/AboutScreen';
import { rememberCallTiming } from '../../../src/atlasVoice/turnTiming';

it('copies a summary with the version, device and the last call timing', async () => {
  const copy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => undefined);
  rememberCallTiming('Last turn: sent 0.9 s after you stopped, voice started 2.5 s later');
  const screen = render(<AboutScreen />);
  fireEvent.press(screen.getByTestId('copy-diagnostics'));
  await waitFor(() => expect(copy).toHaveBeenCalled());
  const text = String(copy.mock.calls[0][0]);
  expect(text).toMatch(/^Atlas /);
  expect(text).toContain('Device:');
  expect(text).toContain('Last call: Last turn: sent 0.9 s');
  expect(screen.getByTestId('copy-diagnostics-note').props.children).toMatch(/Copied/);
  copy.mockRestore();
});
