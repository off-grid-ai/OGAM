/**
 * ToolsScreen Tests
 *
 * The tools picker is a full page (it replaced the old bottom-sheet drawer). Tests:
 * - Renders the page header and all free tool rows
 * - Pro Tools row is pinned to the top of the listing and is shown to everyone
 * - Pro Tools routing: free -> ProDetail upsell, pro -> the Pro Tools screen
 * - Tool toggles flow through the core settings store
 * - Back button navigates back
 *
 * The screen runs on a real React Navigation stack (withNavigatorRoutes) holding the routes it can
 * leave to, and on the real app store. Pro access reaches the store through its own actions.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ToolsScreen } from '../../../src/screens/ToolsScreen';
import { AVAILABLE_TOOLS } from '../../../src/services/tools/registry';
import { registerScreen, _clearScreensForTesting } from '../../../src/navigation/screenRegistry';
import { PRO_TOOLS_SCREEN } from '../../../src/hooks/useIsProActive';
import { useAppStore } from '../../../src/stores/appStore';
import { withNavigatorRoutes } from '../../harness/realNavigation';

jest.unmock('@react-navigation/native');

const PRO_VIDEO_TOOL_IDS = ['generate_video', 'make_film'];
const FREE_TOOLS = AVAILABLE_TOOLS.filter(tool => !PRO_VIDEO_TOOL_IDS.includes(tool.id));

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => <Text {...props}>{name}</Text>;
});
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => <Text {...props}>{name}</Text>;
});

const renderTools = () =>
  render(
    withNavigatorRoutes(<ToolsScreen />, {
      openedFrom: 'Chat',
      destinations: ['ProDetail', PRO_TOOLS_SCREEN],
    }),
  );

describe('ToolsScreen', () => {
  beforeEach(() => {
    _clearScreensForTesting();
    const app = useAppStore.getState();
    app.updateSettings({ enabledTools: ['web_search', 'calculator'] });
    app.setHasRegisteredPro(false);
    app.setHasSavedProCredential(false);
    app.setProActive(false);
    app.setProDeviceAdmission('unknown');
  });
  afterEach(() => {
    _clearScreensForTesting();
  });

  it('renders the page header and every free tool row', () => {
    const { getByText, getByTestId, queryByTestId } = renderTools();
    expect(getByText('Tools')).toBeTruthy();
    for (const tool of FREE_TOOLS) {
      expect(getByTestId(`tool-picker-row-${tool.id}`)).toBeTruthy();
    }
    // Video tools are Pro (d51e111c1, a3f6bd8cf): without Pro video they are not offered.
    for (const id of PRO_VIDEO_TOOL_IDS) {
      expect(queryByTestId(`tool-picker-row-${id}`)).toBeNull();
    }
  });

  it('shows the Pro Tools row to everyone (even free users)', () => {
    const { getByTestId, getByText } = renderTools();
    expect(getByTestId('tools-pro-tools')).toBeTruthy();
    expect(getByText('Pro Tools')).toBeTruthy();
  });

  it('routes a free user to the Pro upsell when Pro Tools is pressed', async () => {
    const { getByTestId, findByTestId, queryByTestId } = renderTools();
    fireEvent.press(getByTestId('tools-pro-tools'));
    expect(await findByTestId('route-ProDetail')).toBeTruthy();
    expect(queryByTestId(`route-${PRO_TOOLS_SCREEN}`)).toBeNull();
  });

  it('routes a pro user straight to the Pro Tools screen', async () => {
    const app = useAppStore.getState();
    app.setHasRegisteredPro(true);
    app.setHasSavedProCredential(true);
    app.setProActive(true);
    app.setProDeviceAdmission('active');
    registerScreen({ name: PRO_TOOLS_SCREEN, component: () => null });
    const { getByTestId, findByTestId, queryByTestId } = renderTools();
    fireEvent.press(getByTestId('tools-pro-tools'));
    expect(await findByTestId(`route-${PRO_TOOLS_SCREEN}`)).toBeTruthy();
    expect(queryByTestId('route-ProDetail')).toBeNull();
  });

  it('toggles a tool through the core settings store', () => {
    const { getByTestId } = renderTools();
    // web_search + calculator are enabled, get_current_datetime is not.
    fireEvent(getByTestId('tool-picker-toggle-get_current_datetime'), 'valueChange', true);
    expect(useAppStore.getState().settings.enabledTools).toEqual([
      'web_search', 'calculator', 'get_current_datetime',
    ]);
  });

  it('navigates back when the back button is pressed', async () => {
    const { getByText, queryByText } = renderTools();
    fireEvent.press(getByText('arrow-left'));
    // The Tools page left the stack; the screen it was opened from is all that remains.
    await waitFor(() => expect(queryByText('Pro Tools')).toBeNull());
  });
});
