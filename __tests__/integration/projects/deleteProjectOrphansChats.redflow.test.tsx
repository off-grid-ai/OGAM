/**
 * RED-FLOW (integration, UI-driven delete) — Q9: deleting a project orphans its chats with a dangling
 * projectId.
 *
 * projectStore.deleteProject only filters the projects array — it never cascades to the conversations that
 * referenced it. So a chat keeps a projectId pointing at a project that no longer exists: it stops appearing
 * under any project view and isn't re-filable. The DELETE is driven the way a user does it — mount the REAL
 * ProjectDetailScreen, open Edit, tap "Delete project", confirm in the alert — over the REAL chatStore/projectStore (no
 * native leaf). The assertion is the store INVARIANT where the bug lives (a dangling project reference), which
 * is what a re-file/project-view flow later trips over. Pure stores + real screen; no deleteProject() shortcut.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ProjectDetailScreen } from '../../../src/screens/ProjectDetailScreen';
import { ProjectChatsScreen } from '../../../src/screens/ProjectChatsScreen';
import { ProjectEditScreen } from '../../../src/screens/ProjectEditScreen';
import { useChatStore, useProjectStore } from '../../../src/stores';
import { createProject } from '../../utils/factories';
import { withNavigator } from '../../harness/realNavigation';

let routeProjectId = 'proj-1';

/** The real project screen opened from the list, with the real Edit project screen it opens. */
function projectStack(projectId: string): React.ReactElement {
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { Text } = require('react-native');
  const Stack = createNativeStackNavigator();
  const initialState = { index: 1, routes: [{ name: 'ProjectsList' }, { name: 'ProjectDetail', params: { projectId } }] };
  return (
    <NavigationContainer initialState={initialState}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="ProjectsList">{() => <Text testID="route-ProjectsList">Projects</Text>}</Stack.Screen>
        <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
        <Stack.Screen name="ProjectEdit" component={ProjectEditScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

describe('Q9 — deleting a project orphans its chats (red-flow, real delete gesture)', () => {
  it('does not leave a chat pointing at a deleted project', async () => {
    useProjectStore.setState({ projects: [createProject({ id: 'proj-1', name: 'Research' })] });
    const convId = useChatStore.getState().createConversation('m', 'My filed chat', 'proj-1');

    // Precondition: the chat is visibly filed under the project (real ProjectChatsScreen list).
    const list = render(withNavigator(<ProjectChatsScreen />, { projectId: routeProjectId }));
    expect(list.getByText('My filed chat')).toBeTruthy();
    list.unmount();

    // User opens the project and deletes it the real way: Edit → "Delete project" → confirm "Delete".
    const detail = render(projectStack(routeProjectId));
    fireEvent.press(detail.UNSAFE_getByProps({ name: 'edit-2' }));
    fireEvent.press(await waitFor(() => detail.getByTestId('project-edit-delete')));
    fireEvent.press(await waitFor(() => detail.getByText('Delete')));

    // The project is gone.
    await waitFor(() => { expect(useProjectStore.getState().getProject('proj-1')).toBeUndefined(); });
    // Back past the deleted project's own screen to the list.
    await waitFor(() => expect(detail.getByTestId('route-ProjectsList')).toBeTruthy());

    // Correct: the chat is no longer bound to a project that doesn't exist (re-filable / unfiled).
    // Today deleteProject doesn't cascade, so its projectId still points at the deleted project → RED.
    const conv = useChatStore.getState().conversations.find(c => c.id === convId)!;
    const danglingRef = conv.projectId != null && useProjectStore.getState().getProject(conv.projectId) == null;
    expect(danglingRef).toBe(false);
  });
});
