/** The Study plan screen: exams in order, a target for today, topics ticked off, and a clear message for a line it cannot read. */
import { requireRTL } from '../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

it('saves exams in order, shows today\'s target, ticks topics, and explains a bad line', async () => {
  const rtl = requireRTL();
  const React = require('react');
  const { PlannerScreen } = require('../../src/screens/PlannerScreen');
  const { usePlanStore } = require('../../src/study/planStore');
  const r = rtl.render(React.createElement(PlannerScreen));
  await rtl.act(async () => { await Promise.resolve(); });

  rtl.fireEvent.changeText(r.getByTestId('plan-text'), 'REG 2026-12-20');
  rtl.fireEvent.press(r.getByTestId('plan-save'));
  expect(r.getByTestId('plan-msg').props.children).toMatch(/Line 1: use/);
  expect(usePlanStore.getState().exams).toEqual([]);

  rtl.fireEvent.changeText(r.getByTestId('plan-text'), `REG | ${inDays(40)} | Basis, Gains, Entities\nTCP | ${inDays(90)} | Planning, Credits`);
  rtl.fireEvent.press(r.getByTestId('plan-save'));
  expect(r.getByTestId('plan-msg').props.children).toMatch(/Saved 2 exams/);
  expect(usePlanStore.getState().exams.map((e: any) => e.name)).toEqual(['REG', 'TCP']);
  expect(r.getByTestId('plan-today')).toBeTruthy();
  expect(r.getByTestId('exam-days-REG').props.children.join('')).toMatch(/\(40 days to go\)/);
  expect(r.getByTestId('exam-days-TCP').props.children.join('')).toMatch(/\(90 days to go\)/);
  const topic = () => r.getAllByRole('checkbox')[0];
  expect(r.getAllByText('REG: Basis').length).toBeGreaterThan(0);

  rtl.fireEvent.press(topic());
  expect(usePlanStore.getState().done).toEqual(['Basis']);
  rtl.fireEvent.press(topic());
  expect(usePlanStore.getState().done).toEqual([]);

  rtl.fireEvent.changeText(r.getByTestId('plan-text'), `REG | ${inDays(1)} | A, B, C`);
  rtl.fireEvent.press(r.getByTestId('plan-save'));
  expect(r.getByTestId('plan-msg').props.children).toMatch(/Not enough days/);
});
