/**
 * The Practice screen's new modes: one drill type on its own, a note on a missed question that comes back with it, flashcards from
 * misses, a timed exam with a score at the end, and the optional daily goal.
 */
import { requireRTL } from '../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { projectId: 'p1' } }),
}));

beforeEach(() => jest.resetModules());

const calc = (id: string, topic: string, answer: number) => ({ id, kind: 'calc', topic, prompt: `What is ${id}?`, answer });

function mount() {
  const rtl = requireRTL();
  const React = require('react');
  const { PracticeScreen } = require('../../src/screens/PracticeScreen');
  const { useExerciseStore } = require('../../src/study/exercises');
  return { rtl, r: rtl.render(React.createElement(PracticeScreen)), store: useExerciseStore };
}

it('practises one drill type, keeps a note on a miss, and shows it when the question comes back', () => {
  const { rtl, r, store } = mount();
  rtl.fireEvent.press(r.getByTestId('practice-pick-drill'));
  rtl.fireEvent.press(r.getByTestId('drill-bond-price'));
  const ids = Object.keys(store.getState().exercises);
  expect(ids.length).toBe(8);
  expect(ids.every((id: string) => id.startsWith('drill-bond-price-'))).toBe(true);

  rtl.fireEvent.changeText(r.getByTestId('practice-input'), '1');
  rtl.fireEvent.press(r.getByTestId('practice-check'));
  expect(r.getByTestId('practice-result').props.children.join('')).toMatch(/Not quite/);
  rtl.fireEvent.changeText(r.getByTestId('why-wrong'), 'I forgot to discount the face value');
  const missed = store.getState().progress;
  expect(Object.values(missed).some((p: any) => p.note === 'I forgot to discount the face value')).toBe(true);

  rtl.fireEvent.press(r.getByTestId('practice-next'));
  rtl.fireEvent.press(r.getByText('Stop'));
  rtl.fireEvent.press(r.getByTestId('practice-start')); // the missed one comes back first, with the note
  expect(r.getByTestId('earlier-note').props.children.join('')).toMatch(/I forgot to discount the face value/);
});

it('turns misses into flashcards and takes a card out when it is known', () => {
  const { rtl, r, store } = mount();
  rtl.act(() => { store.getState().addSet([calc('a', 'Tax', 42), calc('b', 'Tax', 7)]); store.getState().record('a', false); store.getState().record('b', true); });
  rtl.fireEvent.press(r.getByTestId('practice-cards'));
  expect(r.getByText(/What is a\?/)).toBeTruthy();
  expect(r.queryByTestId('card-answer')).toBeNull();
  rtl.fireEvent.press(r.getByTestId('card'));
  expect(r.getByTestId('card-answer').props.children).toBe('42');
  rtl.fireEvent.press(r.getByTestId('card-got'));
  expect(r.getByTestId('cards-empty')).toBeTruthy();
});

it('runs a timed exam with no feedback until the end, then scores it by topic and offers the misses', () => {
  const { rtl, r, store } = mount();
  rtl.act(() => { store.getState().addSet([calc('a', 'Tax', 1), calc('b', 'Audit', 2)]); });
  rtl.fireEvent.press(r.getByTestId('practice-exam'));
  expect(r.getByTestId('exam-clock').props.children.join('')).toMatch(/Question 1 of 2/);
  const first = r.getByTestId('exam-prompt').props.children;
  rtl.fireEvent.changeText(r.getByTestId('practice-input'), first.includes('a?') ? '1' : '2'); // right
  expect(r.queryByTestId('practice-result')).toBeNull(); // no feedback during the exam
  rtl.fireEvent.press(r.getByTestId('exam-next'));
  rtl.fireEvent.changeText(r.getByTestId('practice-input'), '99'); // wrong
  rtl.fireEvent.press(r.getByTestId('exam-finish'));
  expect(r.getByTestId('exam-score').props.children.join('')).toMatch(/1 of 2 correct \(50%\)/);
  expect(r.getByText(/By topic/)).toBeTruthy();
  rtl.fireEvent.press(r.getByTestId('exam-review'));
  expect(r.getByTestId('practice-prompt')).toBeTruthy();
});

it('shows the daily goal and streak only when it is switched on', () => {
  const { rtl, r } = mount();
  expect(r.queryByTestId('goal-line')).toBeNull();
  rtl.fireEvent(r.getByTestId('goal-switch'), 'valueChange', true);
  expect(r.getByTestId('goal-line').props.children).toMatch(/Today: 0 of 10 questions/);
});

it('clears the practice history after asking, and keeps the daily-goal setting', () => {
  const { rtl, r, store } = mount();
  const { Alert } = require('react-native');
  rtl.act(() => { store.getState().addSet([calc('a', 'Tax', 1)]); store.getState().record('a', false); store.getState().setGoal({ on: true }); });
  const ask = jest.spyOn(Alert, 'alert').mockImplementation((_t: any, _m: any, buttons: any) => { buttons.find((b: any) => b.text === 'Clear').onPress(); });
  rtl.fireEvent.press(r.getByTestId('practice-clear'));
  expect(ask).toHaveBeenCalled();
  expect(Object.keys(store.getState().exercises)).toHaveLength(0);
  expect(store.getState().progress).toEqual({});
  expect(store.getState().goal.on).toBe(true);
  expect(r.getByTestId('practice-note').props.children).toBe('Practice history cleared.');
  ask.mockRestore();
});
