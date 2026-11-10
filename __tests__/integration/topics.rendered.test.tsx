/**
 * Learn a topic: name a subject, the AI plans a board of squares in formats it chooses, each square is written when opened,
 * and finishing squares moves you along. Fakes only the device boundary (llama.rn engine, files, RAM).
 */
import { installNativeBoundary, GB, requireRTL } from '../harness/nativeBoundary';
import { createDownloadedModel } from '../utils/factories';

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() };
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
}));

const PLAN = JSON.stringify({
  title: 'Accounting basics', summary: 'Read a balance sheet', style: 'Worked examples with real numbers', theme: 'The Ledger Road',
  units: [{ title: 'Foundations', squares: [
    { format: 'lesson', title: 'Assets and liabilities', focus: 'what each is' },
    { format: 'practice', title: 'Classify items', focus: 'sort items' },
    { format: 'quiz', title: 'Check yourself', focus: 'the basics' },
  ] }],
});
const LESSON = JSON.stringify({ sections: [{ heading: 'Assets', text: 'Things the business owns.', example: 'Cash: 500' }], keyPoints: ['Assets = liabilities + equity'] });
const PRACTICE = JSON.stringify({ task: 'Is a delivery van an asset or a liability?', hint: 'Who owns it?', model: 'An asset: the business owns it.', rubric: ['says asset'] });
const GRADE = JSON.stringify({ score: 95, feedback: 'Right: the van is owned, so it is an asset.' });

it('plans a course on any subject, then plays a lesson and a practice square the AI writes', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../src/stores');
  const { hardwareService } = require('../../src/services/hardware');
  const { TopicsScreen, TopicBoardScreen, TopicSquareScreen } = require('../../src/topics/TopicScreens');
  const { useTopics } = require('../../src/topics/store');

  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
  useTopics.setState({ courses: [] });

  // Make the course.
  boundary.llama!.scriptCompletion({ text: PLAN });
  const list = rtl.render(React.createElement(TopicsScreen));
  rtl.fireEvent.press(list.getByTestId('course-new'));
  rtl.fireEvent.changeText(list.getByTestId('course-topic'), 'Accounting');
  rtl.fireEvent.changeText(list.getByTestId('course-how'), 'worked examples with real numbers');
  rtl.fireEvent.press(list.getByTestId('course-make'));
  await rtl.waitFor(() => expect(useTopics.getState().courses).toHaveLength(1), { timeout: 8000 });
  const course = useTopics.getState().courses[0];
  expect(course.squares.map((s: any) => s.format)).toEqual(['lesson', 'practice', 'quiz']);
  expect(mockNav.navigate).toHaveBeenCalledWith('TopicBoard', { courseId: course.id });
  list.unmount();

  // The board shows it.
  mockParams = { courseId: course.id };
  const board = rtl.render(React.createElement(TopicBoardScreen));
  expect(board.getByText('Accounting basics')).toBeTruthy();
  expect(board.getByTestId('course-style')).toBeTruthy();
  expect(board.getByTestId('course-progress').props.children.join('')).toContain('0 of 3');
  board.unmount();

  // A lesson square is written when opened, then finished.
  boundary.llama!.scriptCompletion({ text: LESSON });
  mockParams = { courseId: course.id, key: 's1' };
  const lesson = rtl.render(React.createElement(TopicSquareScreen));
  expect(await lesson.findByText('Things the business owns.', {}, { timeout: 8000 })).toBeTruthy();
  rtl.fireEvent.press(lesson.getByTestId('lesson-done'));
  expect(useTopics.getState().courses[0].progress.s1.stars).toBe(3);
  lesson.unmount();

  // A practice square: the learner answers and the AI marks it.
  boundary.llama!.scriptCompletion({ text: PRACTICE });
  mockParams = { courseId: course.id, key: 's2' };
  const practice = rtl.render(React.createElement(TopicSquareScreen));
  expect(await practice.findByText('Is a delivery van an asset or a liability?', {}, { timeout: 8000 })).toBeTruthy();
  boundary.llama!.scriptCompletion({ text: GRADE });
  rtl.fireEvent.changeText(practice.getByTestId('practice-input'), 'An asset');
  rtl.fireEvent.press(practice.getByTestId('practice-check'));
  expect(await practice.findByTestId('practice-feedback', {}, { timeout: 8000 })).toBeTruthy();
  rtl.fireEvent.press(practice.getByTestId('practice-done'));
  expect(useTopics.getState().courses[0].progress.s2.stars).toBe(3);
  expect(await practice.findByTestId('square-finished')).toBeTruthy();
}, 60000);

it('says so, with a way to load the model, when the AI cannot write a square', async () => {
  installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../src/stores');
  const { TopicSquareScreen } = require('../../src/topics/TopicScreens');
  const { useTopics } = require('../../src/topics/store');
  useAppStore.setState({ downloadedModels: [], activeModelId: null });
  useTopics.setState({ courses: [] });
  const id = useTopics.getState().add({ topic: 'x', goal: '', level: 'Complete beginner', how: '', minutes: 10 },
    { title: 'T', summary: '', style: '', theme: '', squares: [{ key: 's1', format: 'lesson', title: 'A', focus: 'a', unit: 'U' }] });
  mockParams = { courseId: id, key: 's1' };
  const screen = rtl.render(React.createElement(TopicSquareScreen));
  expect(await screen.findByTestId('square-error', {}, { timeout: 8000 })).toBeTruthy();
  expect(screen.getByTestId('square-force-load')).toBeTruthy();
  expect(screen.getByTestId('square-retry')).toBeTruthy();
}, 30000);

it('writes a square from the learner\'s own sources, and a bad result adds a lesson that explains it another way', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../src/stores');
  const { hardwareService } = require('../../src/services/hardware');
  const { TopicSquareScreen } = require('../../src/topics/TopicScreens');
  const { useTopics } = require('../../src/topics/store');
  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
  useTopics.setState({ courses: [] });

  const source = { id: 'n1', title: 'My textbook', kind: 'note', addedAt: 0, text: 'Depreciation spreads the cost of an asset over its useful life. The straight-line method divides cost minus salvage value by the years.' };
  const id = useTopics.getState().add({ topic: 'Accounting', goal: '', level: 'Complete beginner', how: '', minutes: 10 },
    { title: 'Accounting', summary: '', style: '', theme: '', squares: [
      { key: 's1', format: 'quiz', title: 'Depreciation', focus: 'straight-line depreciation of an asset', unit: 'U' },
      { key: 's2', format: 'lesson', title: 'Next', focus: 'next', unit: 'U' },
    ] }, { sources: [source] });

  // The prompt the AI gets for the square carries the matching passage of the learner's own source.
  const { llmService } = require('../../src/services/llm');
  const seen: string[] = [];
  const original = llmService.generateResponse.bind(llmService);
  jest.spyOn(llmService, 'generateResponse').mockImplementation(async (...args: any[]) => { seen.push(JSON.stringify(args[0])); return original(...args); });
  boundary.llama!.scriptCompletion({ text: JSON.stringify({ questions: [{ q: 'Which method divides cost minus salvage by years?', options: ['Straight-line', 'Declining', 'None'], answer: 0, why: 'It spreads cost evenly.' }, { q: 'Q2', options: ['a', 'b'], answer: 1, why: 'w' }] }) });
  mockParams = { courseId: id, key: 's1' };
  const screen = rtl.render(React.createElement(TopicSquareScreen));
  expect(await screen.findByText('Which method divides cost minus salvage by years?', {}, { timeout: 8000 })).toBeTruthy();
  expect(seen.join(' ')).toContain('My textbook');
  expect(seen.join(' ')).toContain('straight-line method divides cost');

  // Two wrong answers: one star, so a lesson explaining it again is added right after.
  rtl.fireEvent.press(screen.getByText('Declining'));
  rtl.fireEvent.press(screen.getByTestId('quiz-next'));
  rtl.fireEvent.press(screen.getByText('a'));
  rtl.fireEvent.press(screen.getByTestId('quiz-next'));
  expect(await screen.findByTestId('square-remedial')).toBeTruthy();
  const course = useTopics.getState().courses[0];
  expect(course.squares.map((s: any) => s.key)).toEqual(['s1', 's1r', 's2']);
  expect(course.squares[1]).toMatchObject({ format: 'lesson', remedial: true });
  expect(course.progress.s1.stars).toBe(1);
  jest.restoreAllMocks();
}, 60000);

it('finds sources online, has the AI choose, reads the pages, and keeps only those it could read', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const { useAppStore } = require('../../src/stores');
  const { hardwareService } = require('../../src/services/hardware');
  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });

  const page = (n: number) => `<html><body><p>${'Accounting records every transaction as debits and credits. '.repeat(10)}Page ${n}</p></body></html>`;
  (global as any).fetch = jest.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('duckduckgo.com')) {
      return { ok: true, status: 200, text: async () => [1, 2, 3].map((n) => `<div class="result__body"><a class="result__a" href="https://learn${n}.test/page">Learn ${n}</a><a class="result__snippet">About accounting ${n}</a></a></div>`).join('') };
    }
    if (u.includes('learn2.test')) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => page(1) };
  });
  const { findSources } = require('../../src/topics/service');
  boundary.llama!.scriptCompletion({ text: '1, 2, 3' });
  const found = await findSources('Accounting', 'read accounts');
  expect(found.length).toBeGreaterThan(0);
  expect(found.every((s: any) => s.kind === 'web' && s.url && s.text.length >= 300)).toBe(true);
}, 60000);

it('a course made from a project belongs to that project, and the project\'s page only lists its own courses', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../src/stores');
  const { hardwareService } = require('../../src/services/hardware');
  const { TopicsScreen } = require('../../src/topics/TopicScreens');
  const { useTopics } = require('../../src/topics/store');
  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
  const plan = { title: 'Other', summary: '', style: '', theme: '', squares: [{ key: 's1', format: 'lesson' as const, title: 'A', focus: 'a', unit: 'U' }] };
  useTopics.setState({ courses: [] });
  useTopics.getState().add({ topic: 'Elsewhere', goal: '', level: 'x', how: '', minutes: 10 }, plan, { sources: [], projectId: 'other-project' });

  mockParams = { projectId: 'p1', topic: 'Biology 101' };
  boundary.llama!.scriptCompletion({ text: PLAN });
  const screen = rtl.render(React.createElement(TopicsScreen));
  expect(screen.queryByText('Other')).toBeNull();
  rtl.fireEvent.press(screen.getByTestId('course-new'));
  expect(screen.getByTestId('course-topic').props.value).toBe('Biology 101');
  rtl.fireEvent.press(screen.getByTestId('course-make'));
  await rtl.waitFor(() => expect(useTopics.getState().courses.length).toBe(2), { timeout: 8000 });
  expect(useTopics.getState().courses.find((c: any) => c.title === 'Accounting basics')?.projectId).toBe('p1');
}, 60000);
