/**
 * RED-FLOW (integration, UI-driven delete) — Q9: deleting a project orphans its chats with a dangling
 * projectId.
 *
 * projectStore.deleteProject only filters the projects array — it never cascades to the conversations that
 * referenced it. So a chat keeps a projectId pointing at a project that no longer exists: it stops appearing
 * under any project view and isn't re-filable. The DELETE is driven the way a user does it — mount the REAL
 * ProjectDetailScreen, tap "Delete Project", confirm in the alert — over the REAL chatStore/projectStore (no
 * native leaf). The assertion is the store INVARIANT where the bug lives (a dangling project reference), which
 * is what a re-file/project-view flow later trips over. Pure stores + real screen; no deleteProject() shortcut.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ProjectDetailScreen } from '../../../src/screens/ProjectDetailScreen';
import { ProjectChatsScreen } from '../../../src/screens/ProjectChatsScreen';
import { useChatStore, useProjectStore } from '../../../src/stores';
import { createProject } from '../../utils/factories';

let routeProjectId = 'proj-1';
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useRoute: () => ({ params: { projectId: routeProjectId } }),
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

describe('Q9 — deleting a project orphans its chats (red-flow, real delete gesture)', () => {
  it('does not leave a chat pointing at a deleted project', async () => {
    useProjectStore.setState({ projects: [createProject({ id: 'proj-1', name: 'Research' })] });
    const convId = useChatStore.getState().createConversation('m', 'My filed chat', 'proj-1');

    // Precondition: the chat is visibly filed under the project (real ProjectChatsScreen list).
    const list = render(<ProjectChatsScreen />);
    expect(list.getByText('My filed chat')).toBeTruthy();
    list.unmount();

    // User opens the project and deletes it the real way: tap "Delete Project" → confirm "Delete".
    const detail = render(<ProjectDetailScreen />);
    fireEvent.press(detail.getByText('Delete Project'));
    fireEvent.press(await waitFor(() => detail.getByText('Delete')));

    // The project is gone.
    await waitFor(() => { expect(useProjectStore.getState().getProject('proj-1')).toBeUndefined(); });

    // Correct: the chat is no longer bound to a project that doesn't exist (re-filable / unfiled).
    // Today deleteProject doesn't cascade, so its projectId still points at the deleted project → RED.
    const conv = useChatStore.getState().conversations.find(c => c.id === convId)!;
    const danglingRef = conv.projectId != null && useProjectStore.getState().getProject(conv.projectId) == null;
    expect(danglingRef).toBe(false);
  });
});
