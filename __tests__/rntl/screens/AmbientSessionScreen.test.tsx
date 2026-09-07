/**
 * The conversation detail: the structured summary (decisions, actions, people) and the transcript from
 * the one session in the store, plus the graceful "gone" state when the session id no longer resolves.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Share } from 'react-native';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: jest.fn() }),
    useRoute: () => ({ params: { sessionId: 's1' } })
  };
});

jest.mock('../../../src/theme', () => {
  const colors = {
    background: '#000', text: '#fff', textMuted: '#999', textSecondary: '#bbb',
    surface: '#111', border: '#333', primary: '#34D399'
  };
  return { useTheme: () => ({ colors, isDark: true }), useThemedStyles: (fn: any) => fn(colors, { small: {}, medium: {}, large: {} }) };
});

jest.mock('../../../src/stores/ambientTimelineStore', () => {
  let sessions: any[] = [];
  return {
    useAmbientTimelineStore: Object.assign(
      (selector: (s: { sessions: any[] }) => unknown) => selector({ sessions }),
      { __set: (next: any[]) => { sessions = next; } }
    )
  };
});

import { AmbientSessionScreen } from '../../../src/screens/AmbientSessionScreen';
import { useAmbientTimelineStore } from '../../../src/stores/ambientTimelineStore';

const storeMock = useAmbientTimelineStore as unknown as { __set: (s: any[]) => void };

const full = {
  id: 's1',
  startMs: 1_000_000,
  endMs: 1_180_000,
  speechMs: 180_000,
  summary: {
    title: 'Vendor pricing',
    headline: 'They will send a revised quote Monday.',
    decisions: ['Go with vendor B'],
    actionItems: ['Send PO Monday'],
    people: ['Priya', 'Sam']
  },
  summaryStatus: 'ok',
  flaggedSegmentIds: ['a'],
  segments: [
    { id: 'a', startMs: 1_000_000, endMs: 1_002_000, transcript: 'Lets go with vendor B.' },
    { id: 'b', startMs: 1_005_000, endMs: 1_007_000, transcript: null }
  ]
};

describe('AmbientSessionScreen', () => {
  it('renders the summary and transcribed lines of a session', () => {
    storeMock.__set([full]);
    const { getByTestId, queryAllByTestId, getByText } = render(<AmbientSessionScreen />);
    expect(getByTestId('ambient-detail-headline')).toHaveTextContent(
      'They will send a revised quote Monday.'
    );
    expect(queryAllByTestId('ambient-decision')).toHaveLength(1);
    expect(queryAllByTestId('ambient-action')).toHaveLength(1);
    expect(getByTestId('ambient-people')).toHaveTextContent('Priya, Sam');
    // only the transcribed segment shows a line (the null one is skipped)
    expect(queryAllByTestId('ambient-transcript-line')).toHaveLength(1);
    expect(getByText('Lets go with vendor B.')).toBeTruthy();
  });

  it('shares an action item to the OS when tapped (follow-through)', () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    storeMock.__set([full]);
    const { getByTestId } = render(<AmbientSessionScreen />);
    fireEvent.press(getByTestId('ambient-action'));
    expect(shareSpy).toHaveBeenCalledWith({ message: 'Send PO Monday' });
    shareSpy.mockRestore();
  });

  it('shows a graceful message when the session is gone', () => {
    storeMock.__set([]);
    const { getByText } = render(<AmbientSessionScreen />);
    expect(getByText('This conversation is no longer available.')).toBeTruthy();
  });
});
