/**
 * Reading what a paired Off Grid AI Desktop can take, over its gateway. Boundary faked: fetch only.
 */
import { readOffGridDesktopRoom } from '../../../src/services/offGridDesktopModels';
import type { RemoteServer } from '../../../src/types';

const server = { id: 's', name: 'Mac', endpoint: 'http://192.168.1.34:7878/', apiKey: 'key' } as RemoteServer;
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

function gateway(catalog: [number, unknown], installed: [number, unknown]) {
  global.fetch = jest.fn(async (url: string) =>
    url.endsWith('/v1/models/catalog') ? reply(...catalog) : reply(...installed),
  ) as unknown as typeof fetch;
}

describe('readOffGridDesktopRoom', () => {
  it('reads the computer memory and its installed models', async () => {
    gateway(
      [200, { memoryGb: 34, kinds: [], models: [{ id: 'wan', missingBytes: 5 }, { id: 'c' }] }],
      [200, { installed: ['a', ' ', 'b'] }],
    );
    // What a download still fetches is kept per catalog id, only where the computer reports it.
    await expect(readOffGridDesktopRoom(server)).resolves.toEqual({
      memoryGb: 34,
      installed: ['a', 'b'],
      missingBytes: { wan: 5 },
    });
  });

  it('leaves the memory unknown for an older Desktop', async () => {
    gateway([200, { kinds: [], models: [] }], [200, { installed: [] }]);
    await expect(readOffGridDesktopRoom(server)).resolves.toEqual({ installed: [], missingBytes: {} });
  });

  it('says why when the Desktop refuses the key', async () => {
    gateway([401, { error: 'nope' }], [401, null]);
    await expect(readOffGridDesktopRoom(server)).rejects.toThrow('Desktop did not accept this API key');
  });

  it('passes on the Desktop error when the installed list fails', async () => {
    gateway([200, { memoryGb: 8 }], [500, { error: 'Models are loading.' }]);
    await expect(readOffGridDesktopRoom(server)).rejects.toThrow('Models are loading.');
  });

  it('falls back to a plain reason when the Desktop gives none', async () => {
    gateway([500, null], [200, { installed: [] }]);
    await expect(readOffGridDesktopRoom(server)).rejects.toThrow('Desktop did not say which models it has.');
  });
});
