/**
 * A learning cycle reads documents the person gives it: everything readable in the Atlas folder goes into the subject's project
 * (real sqlite and indexing; only file extraction, the embedding model and the folder listing are faked), a second run adds
 * nothing twice, and a file that cannot be read is reported without stopping the rest.
 */
import { installRealSqlite } from '../../harness/sqliteFake';

it('adds the readable files of the folder to a project named after the subject, once', async () => {
  installRealSqlite();
  jest.doMock('../../../src/atlasTools/deviceTools', () => ({ workspaceDir: async () => '/ws' }));
  const RNFS = require('react-native-fs');
  const { documentService } = require('../../../src/services/documentService');
  const { embeddingService } = require('../../../src/services/rag/embedding');
  const { ragService } = require('../../../src/services/rag');
  const { projectForSubject, addWorkspaceFolder, summarize } = require('../../../src/learning/documents');

  const tree: Record<string, Array<{ name: string; dir?: boolean }>> = {
    '/ws': [{ name: 'tax-guide.txt' }, { name: 'photo.png' }, { name: 'notes', dir: true }, { name: 'Converted', dir: true }, { name: 'broken.md' }],
    '/ws/notes': [{ name: 'penalties.md' }],
    '/ws/Converted': [{ name: 'copy.md' }],
  };
  RNFS.readDir.mockImplementation(async (d: string) => (tree[d] ?? []).map((e) => ({ name: e.name, path: `${d}/${e.name}`, size: 100, isDirectory: () => !!e.dir })));
  jest.spyOn(documentService, 'processDocumentFromPath').mockImplementation((async (path: string) => {
    if (path.endsWith('broken.md')) throw new Error('unreadable');
    return { type: 'document', textContent: `Text of ${path}. The filing deadline is April 15.` };
  }) as never);
  jest.spyOn(embeddingService, 'load').mockResolvedValue(undefined as never);
  jest.spyOn(embeddingService, 'getDimension').mockReturnValue(2);
  jest.spyOn(embeddingService, 'embed').mockImplementation((async () => [1, 0]) as never);
  jest.spyOn(embeddingService, 'embedBatch').mockImplementation((async (ts: string[]) => ts.map(() => [1, 0])) as never);

  const projectId = projectForSubject('Taxes');
  expect(projectForSubject('Taxes')).toBe(projectId); // the same subject finds the same project

  const first = await addWorkspaceFolder(projectId);
  expect(first.dir).toBe('/ws');
  expect(first.result.added.sort()).toEqual(['penalties.md', 'tax-guide.txt']);
  expect(first.result.failed).toEqual([{ name: 'broken.md', reason: 'unreadable' }]);
  expect((await ragService.getDocumentsByProject(projectId)).map((d: { name: string }) => d.name).sort()).toEqual(['penalties.md', 'tax-guide.txt']);
  expect(summarize(first.result)).toBe('2 added. 1 could not be read: broken.md.');

  const again = await addWorkspaceFolder(projectId);
  expect(again.result.added).toEqual([]);
  expect(again.result.skipped.sort()).toEqual(['penalties.md', 'tax-guide.txt']);
}, 60000);
