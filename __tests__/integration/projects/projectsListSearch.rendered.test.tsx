/**
 * The projects list has the same search as the chats list: a field fixed above the list that filters
 * as I type, by a project's name or description.
 *
 * SPEC (the user's view): on the Projects tab the search field is a bar fixed above the projects, with
 * a shadow along its bottom edge that the list scrolls under. Typing narrows the list to the matching
 * projects; a search with no match says so; clearing brings every project back.
 *
 * Projects are made the way the user makes them, through the real ProjectEditScreen form, and listed by
 * the real ProjectsScreen over the real persisted store. Only native leaves are faked.
 */
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: {} }), // new project (no projectId)
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type Node = { parent?: Node | null; props?: Record<string, unknown> };
const isInside = (node: Node, ancestor: Node) => {
  for (let at: Node | null | undefined = node; at; at = at.parent) if (at === ancestor) return true;
  return false;
};

describe('projects list search field', () => {
  it('stays put above the projects and filters by name as I type', async () => {
    jest.resetModules();
    const React = require('react');
    const { requireRTL } = require('../../harness/nativeBoundary');
    const rtl = requireRTL();
    const { useProjectStore } = require('../../../src/stores');
    await rtl.waitFor(() => expect(useProjectStore.persist.hasHydrated()).toBe(true));

    const { ProjectEditScreen } = require('../../../src/screens/ProjectEditScreen');
    for (const name of ['Trip Planning', 'Grocery Lists', 'Reading Notes']) {
      const form = rtl.render(React.createElement(ProjectEditScreen, {}));
      rtl.fireEvent.changeText(form.getByPlaceholderText('e.g., Spanish Learning, Code Review'), name);
      rtl.fireEvent.changeText(form.getByPlaceholderText('Enter the instructions or context for the AI...'), `Instructions for ${name}.`);
      rtl.fireEvent.press(form.getByText('Save'));
      form.unmount();
    }

    const { ProjectsScreen } = require('../../../src/screens/ProjectsScreen');
    const list = rtl.render(React.createElement(ProjectsScreen, {}));
    await rtl.waitFor(() => expect(list.getByText('Grocery Lists')).toBeTruthy());

    // The field is a bar fixed above the list, not part of what scrolls.
    const field = list.getByTestId('project-search-input') as Node;
    expect(isInside(field, list.getByTestId('project-list') as Node)).toBe(false);

    rtl.fireEvent.changeText(list.getByTestId('project-search-input'), 'groc');
    expect(list.getByText('Grocery Lists')).toBeTruthy();
    expect(list.queryByText('Trip Planning')).toBeNull();
    expect(list.queryByText('Reading Notes')).toBeNull();

    rtl.fireEvent.changeText(list.getByTestId('project-search-input'), 'nothing like this');
    expect(list.getByText('No projects match your search.')).toBeTruthy();

    rtl.fireEvent.press(list.getByLabelText('Clear project search'));
    for (const name of ['Trip Planning', 'Grocery Lists', 'Reading Notes']) expect(list.getByText(name)).toBeTruthy();
  });
});
