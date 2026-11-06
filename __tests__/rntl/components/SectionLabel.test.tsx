import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SectionLabel } from '../../../src/components/SectionLabel';
import { useTheme } from '../../../src/theme';

describe('SectionLabel', () => {
  it('names the group as a header a screen reader can jump to', () => {
    render(<SectionLabel title="Hardware" testID="hardware-label" />);
    const label = screen.getByRole('header', { name: 'Hardware' });
    expect(label).toBe(screen.getByTestId('hardware-label'));
  });

  it('is a quiet uppercase label in the theme\'s muted ink', () => {
    let muted = '';
    const Probe = () => {
      muted = useTheme().colors.textMuted;
      return <SectionLabel title="What runs here" />;
    };
    render(<Probe />);
    const style = StyleSheet.flatten(screen.getByText('What runs here').props.style);
    expect(style.textTransform).toBe('uppercase');
    expect(style.color).toBe(muted);
  });

  it('takes a style on top of its own, for a label that sits in a row with actions', () => {
    render(<SectionLabel title="MCP servers" style={{ marginBottom: 0 }} />);
    const style = StyleSheet.flatten(screen.getByText('MCP servers').props.style);
    expect(style.marginBottom).toBe(0);
    expect(style.textTransform).toBe('uppercase');
  });
});
