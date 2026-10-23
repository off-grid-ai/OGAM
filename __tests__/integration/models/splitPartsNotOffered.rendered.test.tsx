/**
 * A model Hugging Face split into parts is not offered on the phone: the phone downloads a model as
 * one file, and one part alone loads as nothing.
 *
 * SPEC (the user's view): I open a repo that has a whole Q4_K_M file and a Q8_0 split into two parts.
 * The sizes list the Q4_K_M and neither part, so I cannot download half a model.
 *
 * Real ModelsScreen over the real Hugging Face service and stores. Faked at the device line only: the
 * network (the repo listing) and the in-memory disk.
 */
import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

const MODEL_ID = 'test/Split-Test-GGUF';
const WHOLE = { rfilename: 'Split-Test-Q4_K_M.gguf', size: 600 * MB };
const PARTS = [
  { rfilename: 'Split-Test-Q8_0-00001-of-00002.gguf', size: 400 * MB },
  { rfilename: 'Split-Test-Q8_0-00002-of-00002.gguf', size: 400 * MB },
];

describe('split models on the phone', () => {
  it('offers the whole file and none of the parts', async () => {
    installNativeBoundary({ fs: true });
    const originalFetch = globalThis.fetch;
    const siblings = [WHOLE, ...PARTS].map(f => ({ ...f, lfs: { size: f.size } }));
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/tree/main')) {
        return { ok: true, status: 200, json: async () => siblings.map(f => ({ type: 'file', path: f.rfilename, size: f.size, lfs: f.lfs })) } as Response;
      }
      if (url.pathname === '/api/models') {
        return { ok: true, status: 200, json: async () => [{ id: MODEL_ID, author: 'test', downloads: 1, likes: 0, tags: ['gguf'], siblings: [] }] } as Response;
      }
      if (url.pathname.startsWith('/api/models/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/models/'.length));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id, author: id.split('/')[0], downloads: 1, likes: 0, tags: ['gguf'],
            siblings: id === MODEL_ID && url.searchParams.get('blobs') === 'true' ? siblings : [],
          }),
        } as Response;
      }
      throw new Error(`Unexpected network request: ${url.toString()}`);
    }) as typeof fetch;

    try {
      const React = require('react');
      const { render, fireEvent, waitFor } = requireRTL();
      const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
      const models = render(React.createElement(ModelsScreen));

      fireEvent.changeText(models.getByTestId('search-input'), 'Split Test');
      fireEvent(models.getByTestId('search-input'), 'submitEditing');
      fireEvent.press(await waitFor(() => models.getByText('Split-Test-GGUF')));

      await waitFor(() => expect(models.getByText('Split-Test-Q4_K_M')).toBeTruthy());
      expect(models.queryByText(/00001-of-00002/)).toBeNull();
      expect(models.queryByText(/00002-of-00002/)).toBeNull();
      expect(models.queryByTestId('file-card-1')).toBeNull();
      models.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
