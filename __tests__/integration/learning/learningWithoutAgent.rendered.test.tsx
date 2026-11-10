/**
 * Learning mode can run without an agent: pick "No agent", write the lessons, and they are kept with the learning
 * history while the agent list stays untouched. Fakes only the device boundary.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

it('keeps lessons with the learning history (learning is for the default chat), and does not touch any agent', () => {
  installNativeBoundary({ fs: true });
  const rtl = requireRTL();
  const React = require('react');
  const { LearningScreen } = require('../../../src/screens/LearningScreen');
  const { useAgentStore } = require('../../../src/stores/agentStore');
  const { useLearningStore } = require('../../../src/learning/store');
  const { NO_AGENT } = require('../../../src/learning/agents');

  const agentsBefore = JSON.stringify(useAgentStore.getState().agents);
  const view = rtl.render(React.createElement(LearningScreen));
  rtl.fireEvent.changeText(view.getByPlaceholderText(/None yet/), '- Always give an example');
  expect(useLearningStore.getState().get(NO_AGENT).lessons).toBe('- Always give an example');
  expect(JSON.stringify(useAgentStore.getState().agents)).toBe(agentsBefore);
});

it('shows each report in full with the judge\'s verdict, and chats without an agent use the general lessons', () => {
  installNativeBoundary({ fs: true });
  const rtl = requireRTL();
  const React = require('react');
  const { LearningScreen } = require('../../../src/screens/LearningScreen');
  const { useLearningStore, blankState } = require('../../../src/learning/store');
  const { NO_AGENT } = require('../../../src/learning/agents');
  const { learnedNote } = require('../../../src/learning/learnedNote');
  const { useAgentStore } = require('../../../src/stores/agentStore');
  useAgentStore.setState({ activeAgentId: null });
  const long = `ANSWER: ${'Boil water for three minutes. '.repeat(120)}`;
  useLearningStore.setState({ state: { [NO_AGENT]: { ...blankState(), lessons: '- Always say the unit',
    reportLog: [{ id: 'a:1', itemId: 'a', q: 'How long to boil water?', text: long, sources: 'WHO note', at: 1, status: 'pass', score: 8, why: 'Matches the source' }] } } });
  const view = rtl.render(React.createElement(LearningScreen));
  expect(view.getByText('How long to boil water?')).toBeTruthy();
  expect(view.getByText(/Judge passed it · 8\/10/)).toBeTruthy();
  rtl.fireEvent.press(view.getByTestId('learn-report-a:1'));
  expect(view.getByText(/Judge: Matches the source/)).toBeTruthy();
  expect(view.getByText(/Sources it had/)).toBeTruthy();
  expect(learnedNote('anything at all')).toContain('Always say the unit');
});

it('each expert learns on its own: adding Taxes does not touch General, and only a chat about taxes gets the Taxes lessons', () => {
  installNativeBoundary({ fs: true });
  const rtl = requireRTL();
  const React = require('react');
  const { LearningScreen } = require('../../../src/screens/LearningScreen');
  const { useLearningStore, blankState } = require('../../../src/learning/store');
  const { NO_AGENT } = require('../../../src/learning/agents');
  const { learnedNote } = require('../../../src/learning/learnedNote');
  const { useAgentStore } = require('../../../src/stores/agentStore');
  useAgentStore.setState({ activeAgentId: null });
  useLearningStore.setState({ experts: [], state: { [NO_AGENT]: { ...blankState(), lessons: '- General rule' } }, config: {} });

  const view = rtl.render(React.createElement(LearningScreen));
  rtl.fireEvent.changeText(view.getByTestId('new-expert-input'), 'Taxes');
  rtl.fireEvent.press(view.getByTestId('new-expert-add'));
  const taxes = useLearningStore.getState().experts[0];
  expect(taxes.name).toBe('Taxes');
  rtl.fireEvent.changeText(view.getByPlaceholderText(/None yet/), '- Check the filing deadline');
  rtl.fireEvent.changeText(view.getByPlaceholderText(/Treat wound infections/), 'Personal income tax filing and deductions');

  expect(useLearningStore.getState().get(taxes.id).lessons).toBe('- Check the filing deadline');
  expect(useLearningStore.getState().get(NO_AGENT).lessons).toBe('- General rule'); // General is untouched

  const about = learnedNote('How do I file my taxes this year?');
  expect(about).toContain('General rule');
  expect(about).toContain('expert in Taxes');
  expect(about).toContain('Check the filing deadline');
  const other = learnedNote('What is a good pasta recipe?');
  expect(other).toContain('General rule');
  expect(other).not.toContain('Check the filing deadline');
});
