/**
 * Tapping a question in the Teach the AI question bank only opens it. Approving, rejecting and removing are separate, labelled
 * buttons, so a stray tap can no longer reject an answer. Fakes only the device boundary.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

it('a tap opens a question without changing it; the buttons approve, reject or remove it', () => {
  installNativeBoundary({ fs: true });
  const rtl = requireRTL();
  const React = require('react');
  const { LearningScreen } = require('../../../src/screens/LearningScreen');
  const { useLearningStore, newItem } = require('../../../src/learning/store');
  const { NO_AGENT } = require('../../../src/learning/agents');

  const item = newItem('What is the filing deadline?', 1, 'approved');
  rtl.act(() => { useLearningStore.getState().addItems(NO_AGENT, [item]); });
  const status = () => useLearningStore.getState().get(NO_AGENT).bank.find((b: any) => b.id === item.id);

  const view = rtl.render(React.createElement(LearningScreen));
  rtl.fireEvent.press(view.getByTestId('learning-advanced')); // the question bank is under More options
  rtl.fireEvent.press(view.getByTestId(`bank-row-${item.id}`));
  expect(status().status).toBe('approved'); // opened, not rejected
  expect(view.getByTestId(`bank-reject-${item.id}`)).toBeTruthy();

  rtl.fireEvent.press(view.getByTestId(`bank-reject-${item.id}`));
  expect(status().status).toBe('rejected');
  expect(status().reason).toBe('Rejected by you');
  expect(view.queryByTestId(`bank-reject-${item.id}`)).toBeNull(); // the panel closes after a choice

  rtl.fireEvent.press(view.getByTestId(`bank-row-${item.id}`));
  rtl.fireEvent.press(view.getByTestId(`bank-approve-${item.id}`));
  expect(status().status).toBe('approved');

  rtl.fireEvent.press(view.getByTestId(`bank-row-${item.id}`));
  rtl.fireEvent.press(view.getByTestId(`bank-remove-${item.id}`));
  expect(status().status).toBe('dropped');
  expect(view.queryByTestId(`bank-row-${item.id}`)).toBeNull(); // removed questions leave the list
});
