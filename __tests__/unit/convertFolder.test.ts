/** Converting a folder: web pages, CSV and the like become .md files in Converted; text files are left alone. Fakes only the file system. */
import RNFS from 'react-native-fs';
import { convertFolderToMarkdown, outputName, isConvertible } from '../../src/services/convertFolder';

const tree: Record<string, Array<{ name: string; dir?: boolean }>> = {
  '/ws': [{ name: 'notes.txt' }, { name: 'page.html' }, { name: 'sub', dir: true }, { name: 'Converted', dir: true }],
  '/ws/sub': [{ name: 'page.html' }, { name: 'data.csv' }],
  '/ws/Converted': [{ name: 'old.csv' }],
};
const contents: Record<string, string> = {
  '/ws/page.html': '<h1>Top</h1><p>Hello</p>',
  '/ws/sub/page.html': '<h2>Inner</h2>',
  '/ws/sub/data.csv': 'a,b\n1,2',
};
const written: Record<string, string> = {};

beforeEach(() => {
  Object.keys(written).forEach((k) => delete written[k]);
  (RNFS.readDir as jest.Mock).mockImplementation(async (d: string) => (tree[d] ?? []).map((e) => ({ name: e.name, path: `${d}/${e.name}`, isDirectory: () => !!e.dir })));
  (RNFS.readFile as jest.Mock).mockImplementation(async (p: string) => { if (p in contents) return contents[p]; throw new Error('missing'); });
  (RNFS.writeFile as jest.Mock).mockImplementation(async (p: string, t: string) => { written[p] = t; });
  (RNFS.mkdir as jest.Mock).mockResolvedValue(undefined);
});

it('converts web pages and CSV files in the folder and its subfolders, leaves text files and the Converted folder alone', async () => {
  const r = await convertFolderToMarkdown('/ws');
  expect(r.failed).toEqual([]);
  expect(r.converted.sort()).toEqual(['data.md', 'page.md', 'sub-page.md']);
  expect(written['/ws/Converted/page.md']).toContain('# Top');
  expect(written['/ws/Converted/sub-page.md']).toContain('## Inner');
  expect(written['/ws/Converted/data.md']).toContain('| a | b |');
});

it('reports a file that cannot be read and carries on with the rest', async () => {
  delete contents['/ws/sub/data.csv'];
  try {
    const r = await convertFolderToMarkdown('/ws');
    expect(r.failed).toEqual([{ name: 'data.csv', reason: 'missing' }]);
    expect(r.converted).toHaveLength(2);
  } finally { contents['/ws/sub/data.csv'] = 'a,b\n1,2'; }
});

it('does nothing when there is nothing to convert', async () => {
  (RNFS.readDir as jest.Mock).mockResolvedValue([{ name: 'a.txt', path: '/x/a.txt', isDirectory: () => false }]);
  expect(await convertFolderToMarkdown('/x')).toEqual({ converted: [], failed: [] });
  expect(RNFS.writeFile).not.toHaveBeenCalled();
});

it('names output files so none overwrites another', () => {
  const taken = new Set<string>();
  expect([outputName('a.docx', taken, 'one'), outputName('a.pdf', taken, 'one'), outputName('a.pdf', taken, 'one')]).toEqual(['a.md', 'one-a.md', 'one-a-2.md']);
  expect(isConvertible('Plan.DOCX')).toBe(true);
  expect(isConvertible('notes.txt')).toBe(false);
});
