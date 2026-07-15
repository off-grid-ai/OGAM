/**
 * HAPPY-PATH (UI, BEHAVIORAL) — creating a project the way a user does: on the real ProjectEditScreen, type
 * a name into the real input and tap Save; then on the real ProjectsScreen the new project is listed.
 *
 * Real screens + real projectStore; only navigation is seeded. Entry is a genuine user gesture (type + tap),
 * not a direct store call.
 *
 * NOTE (from the tap-behavioral audit): "new chat" is covered behaviorally by firstMessage (tap send creates
 * the conversation), and "delete message" was removed — there is NO user-facing delete-message affordance
 * (the message action menu is copy/edit/retry/speak/generate-image), so it was never a real user flow.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

let mockRoute: { params: Record<string, unknown> } = { params: {} };
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack, setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useRoute: () => mockRoute,
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

describe('happy — create a project by tapping through the real form', () => {
  it('typing a name and tapping Save creates the project, which then lists on the Projects screen', () => {
    installNativeBoundary();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, fireEvent } = requireRTL();
    const { useProjectStore } = require('../../../src/stores');
    const { ProjectEditScreen } = require('../../../src/screens/ProjectEditScreen');
    const { ProjectsScreen } = require('../../../src/screens/ProjectsScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    mockRoute = { params: {} }; // no projectId → "New Project"

    // --- User taps through the create form ---
    const form = render(React.createElement(ProjectEditScreen, {}));
    fireEvent.changeText(form.getByPlaceholderText('e.g., Spanish Learning, Code Review'), 'Q3 Research');
    // The form requires a system prompt too (Save alerts otherwise) — a real user fills it.
    fireEvent.changeText(form.getByPlaceholderText('Enter the instructions or context for the AI...'), 'You are a research assistant.');
    fireEvent.press(form.getByText('Save'));
    form.unmount();

    // --- The new project is now listed on the Projects screen ---
    const projects = render(React.createElement(ProjectsScreen, {}));
    expect(projects.getByText('Q3 Research')).toBeTruthy();
    expect(useProjectStore.getState().projects.some((p: { name: string }) => p.name === 'Q3 Research')).toBe(true);
  });
});
