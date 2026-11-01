/**
 * projectsApp — the Projects tab and the project editor on a real stack navigator, as the app wires
 * them: the real ProjectsScreen and ProjectEditScreen (a modal over it), with the real project and
 * chat stores. ProjectDetail is a plain screen that names the project it was opened for, so a test
 * reads where a tap went. Only the device is faked (nativeBoundary).
 *
 * The test file must `jest.unmock('@react-navigation/native')`.
 */
import { installNativeBoundary, requireRTL, GB } from './nativeBoundary';

type Rtl = ReturnType<typeof requireRTL>;

export interface ProjectsApp {
  rtl: Rtl;
  view: ReturnType<Rtl['render']>;
  route(): { name: string; params?: Record<string, unknown> } | undefined;
  /** Open a screen the way another part of the app does (e.g. ProjectDetail's Edit). */
  open(name: string, params?: Record<string, unknown>): void;
  useProjectStore: typeof import('../../src/stores/projectStore').useProjectStore;
  useChatStore: typeof import('../../src/stores/chatStore').useChatStore;
  /** Fill the editor's fields (only those given) and press Save. */
  fillAndSave(fields: { name?: string; description?: string; systemPrompt?: string }): Promise<void>;
}

export const PROJECT_FIELDS = {
  name: 'e.g., Spanish Learning, Code Review',
  description: 'Brief description of this project',
  systemPrompt: 'Enter the instructions or context for the AI...',
} as const;

export async function mountProjectsApp(opts: {
  /** The person removed the starter projects (through the store's own delete). */
  noStarterProjects?: boolean;
  /** Before the screens mount: write state through the stores' own actions. */
  seed?: (stores: Pick<ProjectsApp, 'useProjectStore' | 'useChatStore'>) => void | Promise<void>;
} = {}): Promise<ProjectsApp> {
  installNativeBoundary({ ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 4 * GB } });
  const React = require('react');
  const rtl = requireRTL();
  const nav = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { Text } = require('react-native');
  const { useProjectStore } = require('../../src/stores/projectStore');
  const { useChatStore } = require('../../src/stores/chatStore');
  const { ProjectsScreen } = require('../../src/screens/ProjectsScreen');
  const { ProjectEditScreen } = require('../../src/screens/ProjectEditScreen');

  if (opts.noStarterProjects) {
    for (const project of [...useProjectStore.getState().projects]) await useProjectStore.getState().deleteProject(project.id);
  }
  await opts.seed?.({ useProjectStore, useChatStore });

  const Stack = createNativeStackNavigator();
  const ref = nav.createNavigationContainerRef();
  const Detail = ({ route }: { route: { params?: { projectId?: string } } }) =>
    React.createElement(Text, null, `Project detail ${route.params?.projectId}`);
  const view = rtl.render(
    React.createElement(
      nav.NavigationContainer,
      { ref },
      React.createElement(
        Stack.Navigator,
        null,
        React.createElement(Stack.Screen, { name: 'ProjectsTab', component: ProjectsScreen }),
        React.createElement(Stack.Screen, { name: 'ProjectEdit', component: ProjectEditScreen, options: { presentation: 'modal' } }),
        React.createElement(Stack.Screen, { name: 'ProjectDetail', component: Detail }),
      ),
    ),
  );

  return {
    rtl,
    view,
    route: () => ref.getCurrentRoute(),
    open: (name, params) => { rtl.act(() => { ref.navigate(name, params); }); },
    useProjectStore,
    useChatStore,
    fillAndSave: async fields => {
      for (const key of ['name', 'description', 'systemPrompt'] as const) {
        const value = fields[key];
        if (value !== undefined) rtl.fireEvent.changeText(view.getByPlaceholderText(PROJECT_FIELDS[key]), value);
      }
      await rtl.act(async () => { rtl.fireEvent.press(view.getByTestId('project-edit-save')); });
    },
  };
}
