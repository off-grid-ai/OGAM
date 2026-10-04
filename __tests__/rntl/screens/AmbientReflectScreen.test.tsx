/**
 * Reflect renders the week from the store: empty state with nothing, and bars + stats + top people
 * when there are conversations this week. Aggregation is unit-tested; here we prove the screen wires.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ goBack: jest.fn() }) };
});
jest.mock('../../../src/theme', () => {
  const colors = {
    background: '#000', text: '#fff', textMuted: '#999', textSecondary: '#bbb',
    surface: '#111', border: '#333', primary: '#34D399'
  };
  return { useTheme: () => ({ colors, isDark: true }), useThemedStyles: (fn: any) => fn(colors, { small: {}, medium: {}, large: {} }) };
});
jest.mock('../../../src/stores/ambientTimelineStore', () => {
  let state: any = { sessions: [], doneTaskIds: [] };
  const hook = (selector: any) => selector(state);
  hook.__set = (patch: any) => { state = { ...state, ...patch }; };
  return { useAmbientTimelineStore: hook };
});

import { AmbientReflectScreen } from '../../../src/screens/AmbientReflectScreen';
import { useAmbientTimelineStore } from '../../../src/stores/ambientTimelineStore';
const store = useAmbientTimelineStore as any;

const now = Date.now();
const session = (id: string, over: any = {}) => ({
  id, startMs: now, endMs: now + 1, speechMs: 120000,
  summary: { title: 'Standup', headline: 'Ship Friday.', decisions: [], actionItems: ['Fix build'], people: ['Priya'] },
  summaryStatus: 'ok', flaggedSegmentIds: [], segments: [], ...over
});

describe('AmbientReflectScreen', () => {
  beforeEach(() => store.__set({ sessions: [], doneTaskIds: [] }));

  it('shows the empty state with no conversations this week', () => {
    const { getByTestId } = render(<AmbientReflectScreen />);
    expect(getByTestId('ambient-reflect-empty')).toBeTruthy();
  });

  it('renders bars, stats and top people for the week', () => {
    store.__set({ sessions: [session('a'), session('b')] });
    const { getByTestId, queryAllByTestId, getByText } = render(<AmbientReflectScreen />);
    expect(getByTestId('ambient-reflect-bars')).toBeTruthy();
    expect(getByText('0/2')).toBeTruthy();        // commitments kept / total
    expect(queryAllByTestId('ambient-reflect-person')).toHaveLength(1);
    expect(getByText('Priya')).toBeTruthy();
  });
});
