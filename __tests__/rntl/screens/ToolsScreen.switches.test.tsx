/**
 * Each tool switch on the Tools page reads clearly as on or off, and what a screen reader hears
 * matches what the switch shows: a switch labelled "<Tool>, ON" is checked and one labelled
 * "<Tool>, OFF" is not. Turning a tool on flips both together.
 *
 * Real ToolsScreen over the real app store and theme (no mocks of our code). This lives apart from
 * ToolsScreen.test.tsx because that file replaces the store with a mock for its routing rows, so a
 * switch there can never actually change.
 */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { ToolsScreen } from '../../../src/screens/ToolsScreen';
import { AVAILABLE_TOOLS } from '../../../src/services/tools/registry';

function expectEverySwitchMatchesItsLabel() {
  for (const tool of AVAILABLE_TOOLS) {
    const toggle = screen.getByTestId(`tool-picker-toggle-${tool.id}`);
    const label: string = toggle.props.accessibilityLabel;
    expect(label === `${tool.displayName}, ON` || label === `${tool.displayName}, OFF`).toBe(true);
    if (label.endsWith(', ON')) expect(toggle).toBeChecked();
    else expect(toggle).not.toBeChecked();
  }
}

describe('ToolsScreen switches', () => {
  it("shows each tool switch checked exactly when its label says ON, and flips both when tapped", () => {
    render(<ToolsScreen />);

    // Before: every switch agrees with its label; Calculator starts off.
    expectEverySwitchMatchesItsLabel();
    expect(screen.getByRole('switch', { name: 'Calculator, OFF' })).not.toBeChecked();
    expect(screen.queryByRole('switch', { name: 'Calculator, ON' })).toBeNull();

    // The person turns Calculator on.
    fireEvent(screen.getByRole('switch', { name: 'Calculator, OFF' }), 'valueChange', true);

    expect(screen.getByRole('switch', { name: 'Calculator, ON' })).toBeChecked();
    expect(screen.queryByRole('switch', { name: 'Calculator, OFF' })).toBeNull();
    expectEverySwitchMatchesItsLabel();

    // And off again.
    fireEvent(screen.getByRole('switch', { name: 'Calculator, ON' }), 'valueChange', false);

    expect(screen.getByRole('switch', { name: 'Calculator, OFF' })).not.toBeChecked();
    expect(screen.queryByRole('switch', { name: 'Calculator, ON' })).toBeNull();
    expectEverySwitchMatchesItsLabel();
  });
});
