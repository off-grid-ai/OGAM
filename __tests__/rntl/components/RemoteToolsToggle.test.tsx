/**
 * RemoteToolsToggle Component Tests
 *
 * The badge is the manual knob for tool calling support on remote models:
 * detection heuristics are unreliable for custom models, so tapping the badge
 * must persist an override in the remote server store.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { RemoteToolsToggle } from '../../../src/components/RemoteToolsToggle';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import type { RemoteModel } from '../../../src/types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../src/theme', () => ({
  useTheme: () => ({
    colors: {
      warning: '#FF9500',
      textMuted: '#999',
      surfaceLight: '#eee',
    },
  }),
}));

function makeModel(overrides: Partial<RemoteModel> = {}): RemoteModel {
  return {
    id: 'my-custom-model',
    name: 'My Custom Model',
    serverId: 'srv-1',
    capabilities: { supportsVision: false, supportsToolCalling: false, supportsThinking: false },
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

describe('RemoteToolsToggle', () => {
  beforeEach(() => {
    useRemoteServerStore.setState({
      servers: [],
      discoveredModels: {},
      toolCallingOverrides: {},
    });
  });

  it('shows "No tools" when the model does not support tool calling', () => {
    const { getByText } = render(<RemoteToolsToggle model={makeModel()} />);
    expect(getByText('No tools')).toBeTruthy();
  });

  it('shows "Tools" when the model supports tool calling', () => {
    const model = makeModel({
      capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
    });
    const { getByText } = render(<RemoteToolsToggle model={model} />);
    expect(getByText('Tools')).toBeTruthy();
  });

  it('pressing the badge stores an enabling override for a model without detected support', () => {
    const model = makeModel();
    useRemoteServerStore.getState().setDiscoveredModels('srv-1', [model]);

    const { getByTestId } = render(<RemoteToolsToggle model={model} />);
    fireEvent.press(getByTestId('tools-toggle-my-custom-model'));

    const state = useRemoteServerStore.getState();
    expect(state.toolCallingOverrides['srv-1:my-custom-model']).toBe(true);
    expect(state.discoveredModels['srv-1'][0].capabilities.supportsToolCalling).toBe(true);
  });

  it('a fast double-tap without a re-render nets out to the original value', () => {
    const model = makeModel();
    useRemoteServerStore.getState().setDiscoveredModels('srv-1', [model]);

    // Both presses hit the same rendered element (the `model` prop is stale
    // after the first press); the handler must read fresh store state so the
    // second press undoes the first instead of repeating it.
    const { getByTestId } = render(<RemoteToolsToggle model={model} />);
    const badge = getByTestId('tools-toggle-my-custom-model');
    fireEvent.press(badge);
    fireEvent.press(badge);

    const state = useRemoteServerStore.getState();
    expect(state.discoveredModels['srv-1'][0].capabilities.supportsToolCalling).toBe(false);
    expect(state.toolCallingOverrides['srv-1:my-custom-model']).toBe(false);
  });

  it('pressing the badge stores a disabling override for a model with detected support', () => {
    const model = makeModel({
      capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
    });
    useRemoteServerStore.getState().setDiscoveredModels('srv-1', [model]);

    const { getByTestId } = render(<RemoteToolsToggle model={model} />);
    fireEvent.press(getByTestId('tools-toggle-my-custom-model'));

    const state = useRemoteServerStore.getState();
    expect(state.toolCallingOverrides['srv-1:my-custom-model']).toBe(false);
    expect(state.discoveredModels['srv-1'][0].capabilities.supportsToolCalling).toBe(false);
  });
});
