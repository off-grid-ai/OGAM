/**
 * GenerationSettingsModal Component Tests
 *
 * The chat's settings sheet. It no longer copies the model settings: those live in one place,
 * Model settings, and the sheet links there. Tests cover what the sheet still does:
 * - Visibility and title
 * - Last-reply performance stats
 * - Conversation actions (Project, Gallery)
 * - The Model settings row, which really navigates to the ModelSettings route
 * - Delete chat
 *
 * The sheet runs inside a real React Navigation stack (harness/realNavigation), so a press is
 * asserted on the route it lands on.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GenerationSettingsModal } from '../../../src/components/GenerationSettingsModal';
import { withNavigatorRoutes } from '../../harness/realNavigation';
import { requireRTL } from '../../harness/nativeBoundary';
import { launchGeneration } from '../../harness/generationDevice';

// Real navigation: the sheet sits on the top of a real stack.
jest.unmock('@react-navigation/native');

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
};

const renderSheet = (props: Partial<React.ComponentProps<typeof GenerationSettingsModal>> = {}) =>
  render(
    withNavigatorRoutes(<GenerationSettingsModal {...defaultProps} {...props} />, {
      destinations: ['ModelSettings'],
    }),
  );

describe('GenerationSettingsModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null when not visible', () => {
    const { queryByTestId } = renderSheet({ visible: false });
    expect(queryByTestId('app-sheet')).toBeNull();
  });

  it('renders "Chat settings" title when visible', () => {
    const { getByText } = renderSheet();
    expect(getByText('Chat settings')).toBeTruthy();
  });

  it('shows conversation actions when callbacks are provided', () => {
    const { getByText } = renderSheet({
      onOpenProject: jest.fn(),
      onOpenGallery: jest.fn(),
      onDeleteConversation: jest.fn(),
      conversationImageCount: 3,
    });

    expect(getByText(/Project:/)).toBeTruthy();
    expect(getByText('Gallery (3)')).toBeTruthy();
    expect(getByText('Delete chat')).toBeTruthy();
  });

  it('hides Gallery action when conversationImageCount is 0', () => {
    const { queryByText } = renderSheet({ onOpenGallery: jest.fn(), conversationImageCount: 0 });
    expect(queryByText(/Gallery/)).toBeNull();
  });

  it('shows no performance stats before anything was generated', () => {
    const { queryByText } = renderSheet();
    expect(queryByText('Last reply')).toBeNull();
  });

  it('carries no model settings of its own: they live in Model settings', () => {
    const { queryByText, queryByTestId, getByTestId } = renderSheet();

    // The sections, the Fastest button and Reset moved to the Model settings screen.
    expect(queryByText('Temperature')).toBeNull();
    expect(queryByText('Text model hardware')).toBeNull();
    expect(queryByText('Transcription model')).toBeNull();
    expect(queryByText('Notice when you want a picture')).toBeNull();
    expect(queryByText('Reset to defaults')).toBeNull();
    expect(queryByTestId('fastest-settings-button')).toBeNull();
    // One row opens them.
    expect(getByTestId('chat-settings-open-model-settings')).toBeTruthy();
  });

  it('closes the sheet and opens Model settings when the Model settings row is pressed', async () => {
    const onClose = jest.fn();
    const { getByTestId, findByTestId, queryByTestId } = renderSheet({ onClose });
    expect(queryByTestId('route-ModelSettings')).toBeNull();

    fireEvent.press(getByTestId('chat-settings-open-model-settings'));

    expect(onClose).toHaveBeenCalled();
    // After the sheet closes, the stack really moves to the Model settings route.
    expect(await findByTestId('route-ModelSettings')).toBeTruthy();
  });

  it('calls onClose then onDeleteConversation when Delete is pressed', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const onDeleteConversation = jest.fn();

    const { getByTestId } = renderSheet({ onClose, onDeleteConversation });

    fireEvent.press(getByTestId('chat-settings-delete-chat'));

    expect(onClose).toHaveBeenCalled();
    // The delete waits for the sheet to close.
    expect(onDeleteConversation).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(onDeleteConversation).toHaveBeenCalled();
  });

  it('shows active project name in Project action', () => {
    const { getByText } = renderSheet({ onOpenProject: jest.fn(), activeProjectName: 'My Project' });
    expect(getByText('Project: My Project')).toBeTruthy();
  });

  it('calls onClose then onOpenProject when Project action is pressed', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const onOpenProject = jest.fn();

    const { getByText } = renderSheet({ onClose, onOpenProject });

    fireEvent.press(getByText(/Project:/));

    expect(onClose).toHaveBeenCalled();
    jest.advanceTimersByTime(350);
    expect(onOpenProject).toHaveBeenCalled();
  });

  it('calls onClose then onOpenGallery when Gallery action is pressed', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const onOpenGallery = jest.fn();

    const { getByText } = renderSheet({ onClose, onOpenGallery, conversationImageCount: 5 });

    fireEvent.press(getByText('Gallery (5)'));

    expect(onClose).toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(onOpenGallery).toHaveBeenCalled();
  });

  it('shows "Default" when activeProjectName is null', () => {
    const { getByText } = renderSheet({ onOpenProject: jest.fn(), activeProjectName: null });
    expect(getByText('Project: Default')).toBeTruthy();
  });

  it('does not show conversation actions when no callbacks provided', () => {
    const { queryByText } = renderSheet();

    expect(queryByText(/Project:/)).toBeNull();
    expect(queryByText(/Gallery/)).toBeNull();
    expect(queryByText('Delete chat')).toBeNull();
  });
});

describe('GenerationSettingsModal performance stats', () => {
  it('shows the last generation stats after the model answers', async () => {
    // A phone with a loaded model answers once; the real llmService records the run's stats.
    const device = await launchGeneration();
    device.boundary.llama!.scriptCompletion({ text: 'One two three four five.' });
    // The clock moves on while the answer streams, as it does on a phone.
    let now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => (now += 40));
    await device.generationService.generateResponse(device.conversationId, device.ask('Count to five'));
    clock.mockRestore();
    const stats = device.llmService.getPerformanceStats();
    expect(stats.lastTokensPerSecond).toBeGreaterThan(0);
    expect(stats.lastTokenCount).toBeGreaterThan(0);

    // The module graph was reset: render with the fresh React, sheet and navigation.
    const FreshReact = require('react');
    const rtl = requireRTL();
    const { GenerationSettingsModal: Modal } = require('../../../src/components/GenerationSettingsModal');
    const { withNavigatorRoutes: freshNavigator } = require('../../harness/realNavigation');
    const { getByText } = rtl.render(freshNavigator(FreshReact.createElement(Modal, defaultProps)));

    expect(getByText('Last reply')).toBeTruthy();
    expect(getByText(`${stats.lastTokenCount} tokens`)).toBeTruthy();
    expect(getByText(`${stats.lastTokensPerSecond.toFixed(1)} tokens a second`)).toBeTruthy();
  });
});
