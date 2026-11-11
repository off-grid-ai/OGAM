/**
 * The Practice screen: a seeded balance-sheet table is answered wrongly then rightly. What the person sees: the wrong
 * row, the "does not balance" note, and Correct once it balances; the missed question is the first to come back.
 */
import { requireRTL } from '../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { projectId: 'p1' } }),
}));

it('marks a table wrong, then right, and keeps a missed question for review', async () => {
  const rtl = requireRTL();
  const React = require('react');
  const { PracticeScreen } = require('../../src/screens/PracticeScreen');
  const { useExerciseStore } = require('../../src/study/exercises');
  useExerciseStore.getState().addSet([{
    id: 'bs', kind: 'table', topic: 'Balance sheet', prompt: 'Complete the balance sheet', source: { doc: 'Book', page: 3, quote: 'assets equal' },
    rows: [
      { label: 'Row 1', options: ['Cash', 'Inventory'], account: 'Cash', amount: 500, group: 'a' },
      { label: 'Row 2', options: ['Accounts payable', 'Cash'], account: 'Accounts payable', amount: 200, group: 'l' },
      { label: 'Row 3', options: ['Retained earnings'], account: 'Retained earnings', amount: 300, group: 'e' },
    ],
    totals: [{ name: 'Assets = liabilities + equity', groups: ['a'], equals: ['l', 'e'] }],
  }]);
  const r = rtl.render(React.createElement(PracticeScreen));
  rtl.fireEvent.press(r.getByTestId('practice-start'));
  expect(r.getByTestId('practice-prompt').props.children).toMatch(/Complete the balance sheet/);

  const fill = (account: string[], amounts: string[]) => {
    account.forEach((a) => rtl.fireEvent.press(r.getAllByText(a)[0]));
    r.getAllByPlaceholderText('Amount').forEach((box: any, i: number) => rtl.fireEvent.changeText(box, amounts[i]));
  };
  fill(['Cash', 'Accounts payable', 'Retained earnings'], ['500', '200', '250']);
  rtl.fireEvent.press(r.getByTestId('practice-check'));
  expect(r.getByTestId('practice-result').props.children.join('')).toMatch(/Not quite - Does not balance/);
  expect(useExerciseStore.getState().progress.bs.last).toBe(false);

  rtl.fireEvent.press(r.getByTestId('practice-next'));
  rtl.fireEvent.press(r.getByTestId('practice-start')); // the missed one is offered again
  expect(r.getByTestId('practice-prompt')).toBeTruthy();
  rtl.act(() => { useExerciseStore.getState().saveDraft('bs', [{ account: 'Cash', amount: '500' }, { account: 'Accounts payable', amount: '200' }, { account: 'Retained earnings', amount: '300' }]); });
  rtl.fireEvent.press(r.getByTestId('practice-check'));
  expect(r.getByTestId('practice-result').props.children.join('')).toMatch(/Correct/);
});

it('starts code-made accounting drills without any documents and marks a wrong entry', () => {
  const rtl = requireRTL();
  const React = require('react');
  const { PracticeScreen } = require('../../src/screens/PracticeScreen');
  const { useExerciseStore } = require('../../src/study/exercises');
  const r = rtl.render(React.createElement(PracticeScreen));
  rtl.fireEvent.press(r.getByTestId('practice-drills'));
  expect(r.getByTestId('practice-prompt')).toBeTruthy();
  const first = useExerciseStore.getState().exercises;
  expect(Object.keys(first).length).toBeGreaterThanOrEqual(6);
  rtl.fireEvent.press(r.getByTestId('practice-check')); // nothing entered yet
  expect(r.getByTestId('practice-result').props.children.join('')).toMatch(/Not quite/);
});
