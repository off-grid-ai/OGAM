/**
 * An Atlas package saved to an SD card or flash drive is one zip that holds one zip per subject pack. Importing it adds the
 * books of every inner pack; a plain pack (text files only) still works as before. Fakes only the device boundary.
 */
const tree: Record<string, { name: string; path: string; size: string; isDirectory: () => boolean }[]> = {};
const entry = (dir: string, name: string, size = 100) => ({ name, path: `${dir}/${name}`, size: String(size), isDirectory: () => false });
const indexed: string[] = [];

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/docs',
    mkdir: jest.fn(async () => undefined),
    unlink: jest.fn(async () => undefined),
    readDir: jest.fn(async (dir: string) => tree[dir] ?? []),
  },
}));
jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(async (_src: string, target: string) => target),
}));
jest.mock('@react-native-documents/picker', () => ({ pick: jest.fn(), types: { zip: 'zip' } }));
jest.mock('../../src/utils/resolvePickedFileUri', () => ({ resolvePickedFileUri: jest.fn() }));
jest.mock('../../src/services/rag', () => ({
  ragService: { indexDocument: jest.fn(async ({ fileName }: { fileName: string }) => { indexed.push(fileName); }) },
}));

import { importZipFromPath } from '../../src/atlasTools/packImport';

beforeEach(() => { indexed.length = 0; for (const k of Object.keys(tree)) delete tree[k]; });

it('adds the books of every pack inside a package bundle', async () => {
  tree['/docs/atlas_packs/Atlas-Emergency-small'] = [entry('/docs/atlas_packs/Atlas-Emergency-small', '01_Medical.zip'), entry('/docs/atlas_packs/Atlas-Emergency-small', '02_Water.zip')];
  tree['/docs/atlas_packs/01_Medical'] = [entry('/docs/atlas_packs/01_Medical', 'first-aid.md'), entry('/docs/atlas_packs/01_Medical', 'drugs.md')];
  tree['/docs/atlas_packs/02_Water'] = [entry('/docs/atlas_packs/02_Water', 'purify.txt')];
  // The inner zips were unpacked next to the bundle, as the app does, so the fake lists them where they were unpacked.
  tree['/docs/atlas_packs/Atlas-Emergency-small'][0].path = '/in/01_Medical.zip';
  tree['/docs/atlas_packs/Atlas-Emergency-small'][1].path = '/in/02_Water.zip';

  const r = await importZipFromPath('p1', '/drive/Atlas-Emergency-small.zip', 'Atlas-Emergency-small.zip', () => undefined);
  expect(indexed.sort()).toEqual(['drugs.md', 'first-aid.md', 'purify.txt']);
  expect(r.added).toBe(3);
  expect(r.failed).toEqual([]);
});

it('still adds a plain pack of text files', async () => {
  tree['/docs/atlas_packs/pack'] = [entry('/docs/atlas_packs/pack', 'a.md'), entry('/docs/atlas_packs/pack', 'b.txt'), entry('/docs/atlas_packs/pack', 'picture.png')];
  const r = await importZipFromPath('p1', '/x/pack.zip', 'pack.zip', () => undefined);
  expect(indexed.sort()).toEqual(['a.md', 'b.txt']);
  expect(r.added).toBe(2);
});
