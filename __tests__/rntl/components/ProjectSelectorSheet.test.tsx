/**
 * ProjectSelectorSheet Component Tests
 *
 * Tests for the project selection bottom sheet:
 * - Visibility toggling (via AppSheet mock)
 * - Default option always present
 * - Project list rendering
 * - Checkmark indicator on active project
 * - Selection callbacks (project and default)
 * - First letter icon display
 *
 * Priority: P1 (High)
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ProjectSelectorSheet } from '../../../src/components/ProjectSelectorSheet';
import type { Project } from '../../../src/types';


const mockProjects: Project[] = [
  {
    id: '1',
    name: 'Alpha',
    description: 'First project',
    systemPrompt: 'prompt1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    name: 'Beta',
    description: 'Second project',
    systemPrompt: 'prompt2',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

describe('ProjectSelectorSheet', () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    projects: mockProjects,
    activeProject: null as Project | null,
    onSelectProject: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Visibility
  // ============================================================================
  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(
      <ProjectSelectorSheet {...defaultProps} visible={false} />,
    );
    expect(queryByTestId('app-sheet')).toBeNull();
  });

  // ============================================================================
  // Default Option
  // ============================================================================
  it('renders Default option always', () => {
    const { getByText } = render(
      <ProjectSelectorSheet {...defaultProps} />,
    );
    expect(getByText('Default')).toBeTruthy();
  });

  // ============================================================================
  // Project List
  // ============================================================================
  it('renders all project names', () => {
    const { getByText } = render(
      <ProjectSelectorSheet {...defaultProps} />,
    );
    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('Beta')).toBeTruthy();
  });

  // ============================================================================
  // Checkmark Indicators
  // ============================================================================
  it('shows checkmark on active project', () => {
    const { getAllByText } = render(
      <ProjectSelectorSheet
        {...defaultProps}
        activeProject={mockProjects[0]}
      />,
    );
    // The checkmark character should appear exactly once for the active project
    const checkmarks = getAllByText('\u2713');
    expect(checkmarks).toHaveLength(1);
  });

  it('shows checkmark on Default when no active project', () => {
    const { getAllByText } = render(
      <ProjectSelectorSheet {...defaultProps} activeProject={null} />,
    );
    const checkmarks = getAllByText('\u2713');
    expect(checkmarks).toHaveLength(1);
  });

  // ============================================================================
  // Selection Callbacks
  // ============================================================================
  it('calls onSelectProject(null) and onClose when Default is tapped', () => {
    const onSelectProject = jest.fn();
    const onClose = jest.fn();
    const { getByText } = render(
      <ProjectSelectorSheet
        {...defaultProps}
        onSelectProject={onSelectProject}
        onClose={onClose}
      />,
    );
    fireEvent.press(getByText('Default'));
    expect(onSelectProject).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onSelectProject(project) and onClose when a project is tapped', () => {
    const onSelectProject = jest.fn();
    const onClose = jest.fn();
    const { getByText } = render(
      <ProjectSelectorSheet
        {...defaultProps}
        onSelectProject={onSelectProject}
        onClose={onClose}
      />,
    );
    fireEvent.press(getByText('Alpha'));
    expect(onSelectProject).toHaveBeenCalledWith(mockProjects[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ============================================================================
  // First Letter Icon
  // ============================================================================
  it('displays project first letter as icon', () => {
    const { getByText } = render(
      <ProjectSelectorSheet {...defaultProps} />,
    );
    // Default shows "D", Alpha shows "A", Beta shows "B"
    expect(getByText('D')).toBeTruthy();
    expect(getByText('A')).toBeTruthy();
    expect(getByText('B')).toBeTruthy();
  });
});
