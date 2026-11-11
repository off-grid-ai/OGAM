/**
 * Tablet layouts: the 13.2" tablet gets two panes / two columns, while phones keep
 * the existing single-pane layouts.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { resetStores } from '../../utils/testHelpers';

const mockLayout = { twoPane: false };
jest.mock('../../../src/hooks/useLayoutClass', () => ({
  ...jest.requireActual('../../../src/hooks/useLayoutClass'),
  useLayoutClass: () => jest.requireActual('../../../src/hooks/useLayoutClass')
    .layoutInfoFor(mockLayout.twoPane ? 1280 : 412, 800),
}));
jest.mock('../../../src/screens/ProjectsScreen', () => {
  const { Text } = require('react-native');
  return { ProjectsScreen: () => <Text>projects-list</Text> };
});
jest.mock('../../../src/screens/AgentsScreen', () => {
  const { Text } = require('react-native');
  return { AgentsScreen: () => <Text>agents-list</Text> };
});
jest.mock('@react-native-community/slider', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props: any) => <View {...props} /> };
});

import { WorkspaceScreen } from '../../../src/screens/WorkspaceScreen';
import { ModelSettingsScreen } from '../../../src/screens/ModelSettingsScreen';

describe('tablet layouts', () => {
  beforeEach(() => resetStores());

  it('phone Workspace keeps the Projects / Agents switch', () => {
    mockLayout.twoPane = false;
    const screen = render(<WorkspaceScreen />);
    expect(screen.queryByTestId('workspace-two-pane')).toBeNull();
    expect(screen.getByText('projects-list')).toBeTruthy();
    expect(screen.queryByText('agents-list')).toBeNull();
    fireEvent.press(screen.getByTestId('workspace-agents'));
    expect(screen.getByText('agents-list')).toBeTruthy();
  });

  it('large tablet Workspace shows Projects and Agents side by side', () => {
    mockLayout.twoPane = true;
    const screen = render(<WorkspaceScreen />);
    expect(screen.getByTestId('workspace-two-pane')).toBeTruthy();
    expect(screen.getByText('projects-list')).toBeTruthy();
    expect(screen.getByText('agents-list')).toBeTruthy();
    expect(screen.queryByTestId('workspace-agents')).toBeNull();
  });

  it('phone Model Settings keeps collapsed single-column sections', () => {
    mockLayout.twoPane = false;
    const screen = render(<NavigationContainer><ModelSettingsScreen /></NavigationContainer>);
    expect(screen.queryByTestId('model-settings-two-column')).toBeNull();
    expect(screen.queryByTestId('text-advanced-toggle')).toBeNull();
  });

  it('large tablet Model Settings opens the main sections in two columns', () => {
    mockLayout.twoPane = true;
    const screen = render(<NavigationContainer><ModelSettingsScreen /></NavigationContainer>);
    expect(screen.getByTestId('model-settings-two-column')).toBeTruthy();
    expect(screen.getByTestId('text-advanced-toggle')).toBeTruthy();
    expect(screen.getByTestId('image-advanced-toggle')).toBeTruthy();
  });
});
