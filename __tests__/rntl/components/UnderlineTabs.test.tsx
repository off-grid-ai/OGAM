/**
 * UnderlineTabs: colour and the underline say which tab is chosen. Every label keeps one weight, so a
 * chosen tab never grows wider and pushes the ones after it (hand test 2026-11-07, Android).
 */
import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { UnderlineTabs, type UnderlineTab } from '../../../src/components/UnderlineTabs';

type Key = 'general' | 'text' | 'voice';
const tabs: UnderlineTab<Key>[] = [
  { key: 'general', label: 'General', testID: 'tab-general' },
  { key: 'text', label: 'Text', testID: 'tab-text' },
  { key: 'voice', label: 'Voice', testID: 'tab-voice' },
];

const labelStyle = (ui: ReturnType<typeof render>, id: string) =>
  StyleSheet.flatten(within(ui.getByTestId(id)).UNSAFE_getByType(Text).props.style);

describe('UnderlineTabs', () => {
  it('keeps every label at one weight, chosen or not, and colours the chosen one', () => {
    const ui = render(<UnderlineTabs tabs={tabs} active="text" onChange={() => undefined} />);
    const chosen = labelStyle(ui, 'tab-text');
    const other = labelStyle(ui, 'tab-general');
    expect(chosen.fontWeight).toBe(other.fontWeight);
    expect(chosen.fontFamily).toBe(other.fontFamily);
    expect(chosen.color).not.toBe(other.color);
    expect(ui.getByTestId('tab-text').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('reports the tab that was tapped', () => {
    const picked: Key[] = [];
    const ui = render(<UnderlineTabs tabs={tabs} active="general" onChange={key => picked.push(key)} />);
    fireEvent.press(ui.getByTestId('tab-voice'));
    expect(picked).toEqual(['voice']);
  });
});
