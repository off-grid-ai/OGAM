/**
 * HAPPY-PATH (UI, BEHAVIORAL) — projects are kept when a launch cannot read them.
 *
 * Launch 1 creates a project through the real ProjectEditScreen form. Launch 2's first read of the project
 * store fails once (the AsyncStorage boundary), and the user creates another project through the same form.
 * Launch 3 reads storage normally: the Projects screen lists both, and the saved one was not overwritten
 * by the launch defaults. A relaunch is a fresh module graph over the saved AsyncStorage (real persist).
 */
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: {} }), // new project (no projectId)
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const PROJECT_STORE_KEY = 'local-llm-project-storage';

/** A launch: fresh modules over the saved storage; optionally the project store's first read fails. */
async function launch(opts: { failFirstRead?: boolean } = {}) {
  jest.resetModules();
  const failed = opts.failFirstRead
    ? require('../../harness/chatHarness').failFirstStorageRead(PROJECT_STORE_KEY).failed
    : undefined;
  const React = require('react');
  const { requireRTL } = require('../../harness/nativeBoundary');
  const rtl = requireRTL();
  const { useProjectStore } = require('../../../src/stores');
  if (failed) await failed;
  else await rtl.waitFor(() => expect(useProjectStore.persist.hasHydrated()).toBe(true));
  return {
    React,
    rtl,
    /** Create a project the way the user does: type a name and instructions into the form, tap Save. */
    async createProject(name: string) {
      const { ProjectEditScreen } = require('../../../src/screens/ProjectEditScreen');
      const form = rtl.render(React.createElement(ProjectEditScreen, {}));
      rtl.fireEvent.changeText(form.getByPlaceholderText('e.g., Spanish Learning, Code Review'), name);
      rtl.fireEvent.changeText(
        form.getByPlaceholderText('Enter the instructions or context for the AI...'),
        `Instructions for ${name}.`,
      );
      rtl.fireEvent.press(form.getByText('Save'));
      form.unmount();
      await new Promise(r => setTimeout(r, 50)); // the persist middleware flushes to AsyncStorage
    },
    renderProjects() {
      const { ProjectsScreen } = require('../../../src/screens/ProjectsScreen');
      return rtl.render(React.createElement(ProjectsScreen, {}));
    },
  };
}

describe('happy — projects are kept when a launch cannot read them', () => {
  it('a project made during a launch whose read failed is added to the saved ones, and both are listed after', async () => {
    // --- Launch 1: one project, saved ---
    const first = await launch();
    await first.createProject('Saved Project');
    const before = first.renderProjects();
    await first.rtl.waitFor(() => expect(before.getByText('Saved Project')).toBeTruthy());
    before.unmount();

    // --- Launch 2: the project store's first read fails; the saved project is not on screen ---
    const failed = await launch({ failFirstRead: true });
    const during = failed.renderProjects();
    expect(during.queryByText('Saved Project')).toBeNull();
    during.unmount();
    await failed.createProject('Made While Unreadable');
    await new Promise(r => setTimeout(r, 300)); // the retried read and the save it releases

    // --- Launch 3: storage healthy ---
    const third = await launch();
    const after = third.renderProjects();
    await third.rtl.waitFor(() => expect(after.getByText('Saved Project')).toBeTruthy());
    expect(after.getByText('Made While Unreadable')).toBeTruthy();
    expect(after.getAllByText('Saved Project')).toHaveLength(1);
  }, 30_000);
});
