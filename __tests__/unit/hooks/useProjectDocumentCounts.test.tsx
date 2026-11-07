/**
 * useProjectDocumentCounts — how many knowledge documents each project holds, for its Projects row.
 *
 * Real knowledgeBase, document service and both SQLite stores. The only stand-ins are native
 * (harness/documentEngine): op-sqlite is a real in-memory node:sqlite, the filesystem is memfs. The
 * case where the database cannot be opened lives in useProjectDocumentCounts.unreadable.test.tsx.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { installDocumentEngine } from '../../harness/documentEngine';

type Hook = typeof import('../../../src/hooks/useProjectDocumentCounts').useProjectDocumentCounts;

function setup() {
  const boundary = installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 6 * GB } });
  const engine = installDocumentEngine(boundary.fs!);
  const { knowledgeBase } = require('../../../src/services/rag');
  const { useProjectDocumentCounts } = require('../../../src/hooks/useProjectDocumentCounts') as { useProjectDocumentCounts: Hook };
  const rtl = requireRTL();

  /** Put a file in Downloads and add it to the project, the way the picker hands it over. */
  const add = async (projectId: string, fileName: string) => {
    const path = `/docs/Downloads/${projectId}-${fileName}`;
    const text = `${fileName} belongs to ${projectId}.`;
    engine.seedText(path, text);
    await knowledgeBase.addFile({ projectId, filePath: path, fileName, fileSize: text.length });
  };
  return { add, useProjectDocumentCounts, rtl };
}

describe('useProjectDocumentCounts', () => {
  it('counts each project\'s documents once the tab is in view, and reads again when it comes back', async () => {
    const h = setup();
    await h.add('alpha', 'one.txt');
    await h.add('alpha', 'two.txt');
    await h.add('beta', 'only.txt');

    const view = h.rtl.renderHook(
      ({ active }: { active: boolean }) => h.useProjectDocumentCounts(['alpha', 'beta', 'empty'], active),
      { initialProps: { active: false } },
    );
    // Out of view, nothing is read.
    await h.rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(view.result.current).toEqual({});

    view.rerender({ active: true });
    await h.rtl.waitFor(() => expect(view.result.current).toEqual({ alpha: 2, beta: 1, empty: 0 }));

    // A document added inside a project shows once the tab is back in view.
    view.rerender({ active: false });
    await h.add('beta', 'later.txt');
    expect(view.result.current.beta).toBe(1);
    view.rerender({ active: true });
    await h.rtl.waitFor(() => expect(view.result.current.beta).toBe(2));
  });

  it('a new list of the same projects does not read again', async () => {
    const h = setup();
    await h.add('gamma', 'one.txt');
    const view = h.rtl.renderHook(
      ({ ids }: { ids: string[] }) => h.useProjectDocumentCounts(ids, true),
      { initialProps: { ids: ['gamma'] } },
    );
    await h.rtl.waitFor(() => expect(view.result.current).toEqual({ gamma: 1 }));
    const first = view.result.current;

    await h.add('gamma', 'two.txt');
    view.rerender({ ids: ['gamma'] });
    await h.rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(view.result.current).toBe(first);
  });

  it('a count that arrives after the tab is gone is dropped', async () => {
    const h = setup();
    await h.add('delta', 'one.txt');
    const view = h.rtl.renderHook(() => h.useProjectDocumentCounts(['delta'], true));
    view.unmount();
    await h.rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(view.result.current).toEqual({});
  });
});
