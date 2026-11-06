/**
 * useProjectDocumentCounts when the knowledge database cannot be opened (a native failure: the
 * disk is full or the file is damaged). The rows then show chats and last use without a count.
 *
 * Real knowledgeBase and hook; the stand-in is the native op-sqlite module, whose open() fails.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useProjectDocumentCounts } from '../../../src/hooks/useProjectDocumentCounts';

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => { throw new Error('disk I/O error'); },
}));

describe('useProjectDocumentCounts with an unreadable knowledge database', () => {
  it('leaves the rows without a document count', async () => {
    const view = renderHook(() => useProjectDocumentCounts(['alpha'], true));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(view.result.current).toEqual({});
  });
});
