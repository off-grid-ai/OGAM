/** The Rubric check screen lists the criteria a draft never mentions, and asks for a usable rubric. */
import { requireRTL } from '../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

it('shows which rubric criteria the draft skips', () => {
  const rtl = requireRTL();
  const React = require('react');
  const { RubricScreen } = require('../../src/screens/RubricScreen');
  const r = rtl.render(React.createElement(RubricScreen));
  rtl.fireEvent.press(r.getByTestId('rubric-run'));
  expect(r.getByTestId('rubric-error').props.children).toMatch(/No criteria found/);

  rtl.fireEvent.changeText(r.getByTestId('rubric-text'), '1. Explains the research design and justifies the sampling approach\n2. Applies ethical safeguards for participants');
  rtl.fireEvent.changeText(r.getByTestId('draft-text'), 'This study uses a case study research design. The sampling approach was purposive and justified by access.');
  rtl.fireEvent.press(r.getByTestId('rubric-run'));
  expect(r.getByTestId('rubric-summary').props.children).toMatch(/1 of 2 criteria look unaddressed/);
  expect(r.getByText(/Not found: #2 Applies ethical safeguards/)).toBeTruthy();
  expect(r.getByText(/Mentioned: #1/)).toBeTruthy();
});
