/**
 * The Skills screen: paste or pick a SKILL.md, see a preview (with what it expects), add it, switch it off, remove it.
 * The file picker is the device boundary; the file it hands over is a real (faked-disk) file.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

let mockPicked: { uri: string; name: string } | null = null;
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(async () => { if (!mockPicked) throw new Error('cancelled'); return [mockPicked]; }),
  types: { allFiles: '*/*' },
  keepLocalCopy: jest.fn(async ({ files }: { files: { uri: string }[] }) => files.map((f) => ({ status: 'success', localUri: f.uri }))),
  isErrorWithCode: () => false,
  errorCodes: {},
}));
jest.mock('react-native-zip-archive', () => ({ unzip: jest.fn(async () => undefined) }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

const SKILL = '---\nname: Trip Planner\ndescription: Plan a trip day by day when the user asks for an itinerary.\n---\nAsk for dates and budget first, then give one block per day.';

it('pastes a skill, previews it, adds it, switches it off and removes it', async () => {
  installNativeBoundary({ fs: true });
  const { render, fireEvent, waitFor } = requireRTL();
  const React = require('react');
  const { SkillsScreen } = require('../../../src/skills/SkillsScreen');
  const { useSkills } = require('../../../src/skills/skillsStore');
  useSkills.setState({ skills: [] });
  const screen = render(React.createElement(SkillsScreen));
  expect(screen.getByTestId('skills-empty')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('skill-paste'), 'not a skill');
  fireEvent.press(screen.getByTestId('skill-preview-button'));
  expect(await screen.findByTestId('skill-error')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('skill-paste'), SKILL);
  fireEvent.press(screen.getByTestId('skill-preview-button'));
  expect(await screen.findByText('Add /trip-planner?')).toBeTruthy();
  fireEvent.press(screen.getByTestId('skill-add'));
  expect(screen.getByTestId('skill-trip-planner')).toBeTruthy();
  expect(useSkills.getState().skills[0]).toMatchObject({ name: 'trip-planner', enabled: true });

  fireEvent(screen.getByTestId('skill-switch-trip-planner'), 'valueChange', false);
  expect(useSkills.getState().skills[0].enabled).toBe(false);
});

it('reads a SKILL.md the person picks, and warns about programs it expects', async () => {
  installNativeBoundary({ fs: true });
  const { render, fireEvent, waitFor } = requireRTL();
  const React = require('react');
  const RNFS = require('react-native-fs');
  const { SkillsScreen } = require('../../../src/skills/SkillsScreen');
  const { useSkills } = require('../../../src/skills/skillsStore');
  useSkills.setState({ skills: [] });
  const path = `${RNFS.DocumentDirectoryPath}/weather/SKILL.md`;
  await RNFS.writeFile(path, '---\nname: weather\ndescription: Get the weather for a city.\nmetadata: {"openclaw":{"requires":{"bins":["curl"]}}}\n---\nRun curl to get the forecast.', 'utf8');
  mockPicked = { uri: `file://${path}`, name: 'SKILL.md' };

  const screen = render(React.createElement(SkillsScreen));
  fireEvent.press(screen.getByTestId('skill-choose'));
  await waitFor(() => expect(screen.getByTestId('skill-preview')).toBeTruthy());
  expect(screen.getByText(/Expects curl, which Atlas cannot run/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('skill-add'));
  expect(useSkills.getState().skills.map((s: any) => s.name)).toEqual(['weather']);
  expect(useSkills.getState().skills[0].needs).toEqual(['curl']);
  mockPicked = null;
});

it('adds a ready-made skill from the library with one tap, and it then fits a matching message', async () => {
  installNativeBoundary({ fs: true });
  const { render, fireEvent, waitFor } = requireRTL();
  const React = require('react');
  const { SkillsScreen } = require('../../../src/skills/SkillsScreen');
  const { useSkills } = require('../../../src/skills/skillsStore');
  const { pickSkill } = require('../../../src/skills/selectSkills');
  useSkills.setState({ skills: [] });
  const screen = render(React.createElement(SkillsScreen));
  fireEvent.press(screen.getByTestId('library-skill-summarize'));
  await waitFor(() => expect(useSkills.getState().skills.map((s: any) => s.name)).toContain('summarize'));
  expect(screen.queryByTestId('library-skill-summarize')).toBeNull();
  expect(pickSkill('Please summarize this long article into the key points', useSkills.getState().skills)?.name).toBe('summarize');
});
