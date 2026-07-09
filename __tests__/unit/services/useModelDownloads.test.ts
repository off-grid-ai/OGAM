/**
 * useModelDownloads — the reactive hook over ModelDownloadService used by every
 * screen. Verifies it lists on mount, re-lists (coalesced) when the service notifies,
 * and unsubscribes on unmount.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';

const mockList = jest.fn();
const mockSubscribe = jest.fn();
let notify: () => void = () => {};
jest.mock('../../../src/services/modelDownloadService', () => ({
  modelDownloadService: {
    list: (...a: any[]) => mockList(...a),
    subscribe: (cb: () => void) => mockSubscribe(cb),
  },
}));

import { useModelDownloads } from '../../../src/services/modelDownloadService/useModelDownloads';

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockList.mockResolvedValue([{ id: 'text:a', status: 'downloading' }]);
  mockSubscribe.mockImplementation((cb: () => void) => { notify = cb; return () => { notify = () => {}; }; });
});
afterEach(() => jest.useRealTimers());

describe('useModelDownloads', () => {
  it('lists on mount and subscribes', async () => {
    const { result } = renderHook(() => useModelDownloads());
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].id).toBe('text:a');
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('re-lists (coalesced) when the service notifies', async () => {
    renderHook(() => useModelDownloads());
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    mockList.mockResolvedValue([{ id: 'text:a', status: 'completed' }, { id: 'image:b', status: 'downloading' }]);
    act(() => { notify(); notify(); notify(); }); // rapid ticks coalesce to one refresh
    act(() => { jest.advanceTimersByTime(250); });
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('unsubscribes on unmount', async () => {
    const unsub = jest.fn();
    mockSubscribe.mockReturnValue(unsub);
    const { unmount } = renderHook(() => useModelDownloads());
    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});
