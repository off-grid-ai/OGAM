/**
 * HAPPY-PATH (UI, BEHAVIORAL) — persistence across a relaunch: a project the user CREATES via the real form
 * survives an app relaunch and renders on the Projects screen.
 *
 * The stores use REAL zustand `persist` to AsyncStorage (stateful mock). Launch 1 creates the project through
 * the real ProjectEditScreen form (type name + system prompt, tap Save) — the persist middleware writes it.
 * A relaunch is modelled by jest.resetModules() + re-requiring the stores, which triggers the REAL rehydration.
 * No mock of the persistence logic, no createProject() shortcut. (Conversations use the same persist
 * middleware; the project proves the round trip.)
 */
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: {} }), // new project (no projectId)
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — a user-created project survives a relaunch (real persist + real form)', () => {
  it('create via the form → relaunch → the project is still on the Projects screen', async () => {
    // --- Launch 1: create the project through the REAL form gesture ---
    jest.resetModules();
    {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const React = require('react');
      const { requireRTL } = require('../../harness/nativeBoundary');
      const { render, fireEvent } = requireRTL();
      const { ProjectEditScreen } = require('../../../src/screens/ProjectEditScreen');
      /* eslint-enable @typescript-eslint/no-var-requires */

      const form = render(React.createElement(ProjectEditScreen, {}));
      fireEvent.changeText(form.getByPlaceholderText('e.g., Spanish Learning, Code Review'), 'Persisted Project');
      fireEvent.changeText(form.getByPlaceholderText('Enter the instructions or context for the AI...'), 'You are a helpful research assistant.');
      fireEvent.press(form.getByText('Save'));
      form.unmount();
      await new Promise((r) => setTimeout(r, 0)); // let the persist middleware flush to AsyncStorage
    }

    // --- Relaunch: fresh module graph → stores rehydrate from persisted storage ---
    jest.resetModules();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { requireRTL } = require('../../harness/nativeBoundary');
    const { render, waitFor } = requireRTL();
    const { useProjectStore } = require('../../../src/stores');
    const { ProjectsScreen } = require('../../../src/screens/ProjectsScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    await useProjectStore.persist?.rehydrate?.();
    await waitFor(() => { expect(useProjectStore.getState().projects.length).toBeGreaterThan(0); });

    // The project the user created survived the relaunch and renders on the Projects screen.
    const view = render(React.createElement(ProjectsScreen, {}));
    expect(view.getByText('Persisted Project')).toBeTruthy();
  });
});
