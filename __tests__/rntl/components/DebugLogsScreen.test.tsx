import React from 'react';
import { FlatList } from 'react-native';
import { render } from '@testing-library/react-native';
import { DebugLogsScreen } from '../../../src/components/DebugLogsScreen';
import { useDebugLogsStore } from '../../../src/stores/debugLogsStore';

describe('DebugLogsScreen', () => {
  beforeEach(() => {
    useDebugLogsStore.setState({ logs: [] });
  });

  it('lists logs in an inverted list that never clips its rows', () => {
    useDebugLogsStore.getState().addLog({ timestamp: 1, level: 'log', message: 'first line' });
    useDebugLogsStore.getState().addLog({ timestamp: 2, level: 'warn', message: 'second line' });

    const { getByText, UNSAFE_getByType } = render(<DebugLogsScreen visible onClose={jest.fn()} />);

    expect(getByText('second line')).toBeTruthy();
    const list = UNSAFE_getByType(FlatList);
    expect(list.props.inverted).toBe(true);
    expect(list.props.removeClippedSubviews).toBe(false);
  });
});
