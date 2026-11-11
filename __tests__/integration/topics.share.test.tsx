/**
 * Send a course to another phone as a file and open it there: squares and written content arrive, progress and web page text do not.
 * Fakes only the device boundary (files, the save and open pickers).
 */
import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() };
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
}));

let mockSaved: { uri: string; name: string; text: string } | null = null;
let mockChosen: string | null = null;
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(async () => [{ uri: mockChosen, name: 'Accounting.atlascourse.json' }]),
  saveDocuments: jest.fn(async ({ sourceUris, fileName }: any) => {
    const RNFS = require('react-native-fs');
    mockSaved = { uri: sourceUris[0], name: fileName, text: await RNFS.readFile(sourceUris[0].replace('file://', ''), 'utf8') };
    return [{ name: fileName }];
  }),
  keepLocalCopy: jest.fn(async () => [{ status: 'success', localUri: mockChosen }]),
  types: { allFiles: '*/*' },
  isErrorWithCode: () => false,
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));

it('sends a course as a file and opens it on another phone without the progress', async () => {
  const boundary = installNativeBoundary({ fs: true });
  const rtl = requireRTL();
  const React = require('react');
  const RNFS = require('react-native-fs');
  const { TopicsScreen, TopicBoardScreen } = require('../../src/topics/TopicScreens');
  const { useTopics } = require('../../src/topics/store');
  void boundary;

  useTopics.setState({ courses: [{
    id: 'c1', topic: 'Accounting', title: 'Accounting basics', summary: 'Read a balance sheet', style: 'Worked examples', theme: 'The Ledger Road',
    request: { topic: 'Accounting', goal: '', level: 'Complete beginner', how: '', minutes: 10 },
    squares: [{ key: 's1', format: 'lesson', title: 'Assets', focus: 'what an asset is', unit: 'Foundations' }, { key: 's2', format: 'quiz', title: 'Check', focus: 'basics', unit: 'Foundations' }],
    content: { s1: { kind: 'lesson', sections: [{ heading: 'Assets', text: 'Things the business owns.' }], keyPoints: ['A = L + E'] } },
    progress: { s1: { stars: 3, doneAt: 1 } }, createdAt: 1, projectId: 'p-private',
    sources: [{ id: 'w', title: 'A web page', kind: 'web', url: 'https://example.com/a', text: 'COPYRIGHTED PAGE TEXT', addedAt: 1 }, { id: 'n', title: 'My notes', kind: 'note', text: 'my own notes', addedAt: 1 }],
  }] });

  mockParams = { courseId: 'c1' };
  const board = rtl.render(React.createElement(TopicBoardScreen));
  rtl.fireEvent.press(board.getByTestId('course-share'));
  await rtl.waitFor(() => expect(mockSaved).not.toBeNull());
  expect(mockSaved!.name).toBe('Accounting basics.atlascourse.json');
  expect(mockSaved!.text).not.toContain('COPYRIGHTED PAGE TEXT');
  board.unmount();

  // On the other phone: the person picks the file.
  useTopics.setState({ courses: [] });
  mockChosen = '/mock/Accounting.atlascourse.json';
  await RNFS.writeFile(mockChosen, mockSaved!.text, 'utf8');
  mockParams = {};
  const list = rtl.render(React.createElement(TopicsScreen));
  rtl.fireEvent.press(list.getByTestId('course-import'));
  await rtl.waitFor(() => expect(useTopics.getState().courses).toHaveLength(1));
  const got = useTopics.getState().courses[0];
  expect(got.id).not.toBe('c1');
  expect(got.squares.map((s: any) => s.title)).toEqual(['Assets', 'Check']);
  expect(got.content.s1.keyPoints).toEqual(['A = L + E']);
  expect(got.progress).toEqual({});
  expect(got.projectId).toBeUndefined();
  expect(got.sources.map((s: any) => s.title)).toEqual(['My notes']);
  expect(mockNav.navigate).toHaveBeenCalledWith('TopicBoard', { courseId: got.id });

  // A file that is not a course says so.
  await RNFS.writeFile(mockChosen, '{"hello":1}', 'utf8');
  const Alert = require('react-native').Alert;
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  rtl.fireEvent.press(list.getByTestId('course-import'));
  await rtl.waitFor(() => expect(spy).toHaveBeenCalledWith('Could not open that course', 'That is not an Atlas course file.'));
});
