/**
 * Each tool switch on the Tools page is named by its tool, and what it shows matches the saved
 * choice: a switch is checked exactly when its tool is enabled. The on/off state is the switch's
 * own checked state, not words in its name. Turning a tool on flips the switch and the setting
 * together.
 *
 * Real ToolsScreen over the real app store and theme (no mocks of our code). This lives apart from
 * ToolsScreen.test.tsx because that file replaces the store with a mock for its routing rows, so a
 * switch there can never actually change.
 */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { ToolsScreen } from '../../../src/screens/ToolsScreen';
import { AVAILABLE_TOOLS } from '../../../src/services/tools/registry';
import { useAppStore } from '../../../src/stores';

// Video tools are Pro (d51e111c1, a3f6bd8cf): without Pro video the screen offers the free tools.
const FREE_TOOLS = AVAILABLE_TOOLS.filter(tool => !['generate_video', 'make_film'].includes(tool.id));

function expectEverySwitchMatchesTheSetting() {
  const enabled = useAppStore.getState().settings.enabledTools || [];
  for (const tool of FREE_TOOLS) {
    const toggle = screen.getByTestId(`tool-picker-toggle-${tool.id}`);
    expect(toggle.props.accessibilityLabel).toBe(tool.displayName);
    if (enabled.includes(tool.id)) expect(toggle).toBeChecked();
    else expect(toggle).not.toBeChecked();
  }
}

describe('ToolsScreen switches', () => {
  it('shows each tool switch checked exactly when its tool is enabled, and flips both when tapped', () => {
    render(<ToolsScreen />);

    // Before: every switch agrees with the setting; Calculator starts off.
    expectEverySwitchMatchesTheSetting();
    expect(screen.getByRole('switch', { name: 'Calculator' })).not.toBeChecked();

    // The person turns Calculator on.
    fireEvent(screen.getByRole('switch', { name: 'Calculator' }), 'valueChange', true);

    expect(screen.getByRole('switch', { name: 'Calculator' })).toBeChecked();
    expect(useAppStore.getState().settings.enabledTools).toContain('calculator');
    expectEverySwitchMatchesTheSetting();

    // And off again.
    fireEvent(screen.getByRole('switch', { name: 'Calculator' }), 'valueChange', false);

    expect(screen.getByRole('switch', { name: 'Calculator' })).not.toBeChecked();
    expect(useAppStore.getState().settings.enabledTools).not.toContain('calculator');
    expectEverySwitchMatchesTheSetting();
  });
});
