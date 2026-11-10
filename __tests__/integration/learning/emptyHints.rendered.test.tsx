/** A fresh Teach the AI screen says what to do first, and the hint goes once there is an expert. */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

it('tells a new person to add an expert and start a task, and drops the expert hint after adding one', () => {
  installNativeBoundary({ fs: true });
  const rtl = requireRTL();
  const React = require('react');
  const { LearningScreen } = require('../../../src/screens/LearningScreen');
  const view = rtl.render(React.createElement(LearningScreen));
  expect(view.getByTestId('no-experts-hint')).toBeTruthy();
  expect(view.getByText(/No reports yet\. Describe a task above and press Start/)).toBeTruthy();
  rtl.fireEvent.changeText(view.getByTestId('new-expert-input'), 'Taxes');
  rtl.fireEvent.press(view.getByTestId('new-expert-add'));
  expect(view.queryByTestId('no-experts-hint')).toBeNull();
});
