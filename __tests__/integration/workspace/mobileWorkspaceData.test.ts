import type { WorkspaceSnapshot } from '@offgrid/sync/portable';
import { BackupEngine, WORKSPACE_SCHEMA_VERSION } from '@offgrid/sync/portable';

const mockExecuteSync: jest.Mock<any, [string]> = jest.fn((sql: string) => {
  if (sql.includes('SELECT')) return { rows: [] };
  if (sql.includes('INSERT INTO rag_documents')) return { rows: [], insertId: 41 };
  if (sql.includes('INSERT INTO rag_chunks')) return { rows: [], insertId: 42 };
  return { rows: [] };
});

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ executeSync: mockExecuteSync }),
}));

// The native embedding runtime is the uncontrollable boundary; production
// chunking, embedding orchestration, SQLite writes, and stores remain real.
jest.mock('llama.rn', () => ({
  initLlama: async () => ({
    embedding: async () => ({ embedding: Array.from({ length: 384 }, () => 0.25) }),
    release: async () => undefined,
  }),
}));

import { MobileWorkspaceData } from '../../../src/services/portableWorkspace/mobileWorkspaceData';
import type { WorkspaceFilePort } from '../../../src/services/portableWorkspace/types';
import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';
import { ragDatabase } from '../../../src/services/rag/database';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeWorkspaceRecovery } from '../../../src/services/portableWorkspace/importJournal';
import { workspaceArchive } from '../../../src/services/portableWorkspace/nativeWorkspaceBoundary';

const singleEntryZip = (key: string, unixMode = 0): Uint8Array => {
  const name = new TextEncoder().encode(key);
  const local = new Uint8Array(30 + name.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(26, name.length, true);
  local.set(name, 30);
  const central = new Uint8Array(46 + name.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 768, true);
  centralView.setUint16(28, name.length, true);
  centralView.setUint32(38, unixMode * 65536, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);
  return Uint8Array.from([...local, ...central, ...end]);
};

const filePort = (): WorkspaceFilePort => ({
  exists: jest.fn(async () => false),
  isOwnedImportPath: path => path.startsWith('/documents/'),
  copy: jest.fn(async () => undefined),
  textDestination: id => `/documents/${id}.txt`,
  materializeText: jest.fn(async () => undefined),
  remove: jest.fn(async () => undefined),
});

const snapshot = (): WorkspaceSnapshot => ({
  schemaVersion: WORKSPACE_SCHEMA_VERSION,
  selection: { kind: 'all' },
  workspaces: [],
  projects: [{
    id: 'imported-project', name: 'Imported', description: 'Portable', systemPrompt: 'Be useful.',
    createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z',
  }],
  conversations: [{
    id: 'imported-chat', projectId: 'imported-project', title: 'Portable chat', modelId: 'model',
    createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z',
  }],
  messages: [{
    id: 'imported-message', conversationId: 'imported-chat', role: 'user', content: 'Hello',
    createdAt: '2026-07-17T00:00:00.000Z',
  }],
  documents: [{
    id: 'portable-document', projectId: 'imported-project', name: 'notes.txt', kind: 'text', size: 5,
    createdAt: '2026-07-17T00:00:00.000Z', enabled: true,
    textContent: 'Portable notes contain enough meaningful text to produce a searchable chunk.',
  }],
  attachments: [{
    id: 'portable-attachment', messageId: 'imported-message', name: 'inline.txt', kind: 'text',
    size: 6, textContent: 'inline',
  }],
});

describe('MobileWorkspaceData real store and SQLite integration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockExecuteSync.mockImplementation((sql: string) => {
      if (sql.includes('SELECT')) return { rows: [] };
      if (sql.includes('INSERT INTO rag_documents')) return { rows: [], insertId: 41 };
      if (sql.includes('INSERT INTO rag_chunks')) return { rows: [], insertId: 42 };
      return { rows: [] };
    });
    (ragDatabase as any).ready = false;
    (ragDatabase as any).db = null;
    useProjectStore.setState({ projects: [] });
    useChatStore.setState({ conversations: [], activeConversationId: null });
  });

  it('applies a validated keep-existing snapshot across the actual stores and SQL owner', async () => {
    const data = new MobileWorkspaceData(filePort());

    const result = await data.applyAtomically(snapshot(), {
      collisionPolicy: 'keep-existing',
      files: [],
    });

    expect(result).toEqual({ projects: 1, conversations: 1, messages: 1, documents: 1, attachments: 1 });
    expect(useProjectStore.getState().projects.map(project => project.id)).toEqual(['imported-project']);
    expect(useChatStore.getState().conversations[0].messages[0]).toMatchObject({
      id: 'imported-message', content: 'Hello', attachments: [{ id: 'portable-attachment', textContent: 'inline' }],
    });
    expect(mockExecuteSync).toHaveBeenCalledWith('BEGIN');
    expect(mockExecuteSync).toHaveBeenCalledWith('COMMIT');
    expect(mockExecuteSync.mock.calls.some(([sql]) => sql.includes('INSERT INTO rag_documents'))).toBe(true);
  });

  it('keeps existing ids and names without overwriting them', async () => {
    useProjectStore.setState({ projects: [{
      id: 'imported-project', name: 'Local', description: '', systemPrompt: '',
      createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z',
    }] });
    useChatStore.setState({ conversations: [{
      id: 'imported-chat', title: 'Local chat', modelId: 'local', messages: [],
      createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z',
    }] });
    mockExecuteSync.mockImplementation((sql: string) => sql.includes('SELECT')
      ? { rows: [{ id: 2, portable_id: 'portable-document', project_id: 'imported-project', name: 'notes.txt', path: '', size: 5, created_at: '2026-07-16T00:00:00.000Z', enabled: 1 }] }
      : { rows: [] });
    const data = new MobileWorkspaceData(filePort());

    const result = await data.applyAtomically(snapshot(), { collisionPolicy: 'keep-existing', files: [] });

    expect(result).toEqual({ projects: 0, conversations: 0, messages: 1, documents: 0, attachments: 1 });
    expect(useProjectStore.getState().projects[0].name).toBe('Local');
    expect(useChatStore.getState().conversations[0].title).toBe('Local chat');
    expect(useChatStore.getState().conversations[0].messages[0].id).toBe('imported-message');
  });

  it('extracts and indexes a verified file-only desktop document before staging is released', async () => {
    const input = snapshot();
    input.documents[0] = { ...input.documents[0], archiveKey: 'files/documents/notes.txt' };
    delete input.documents[0].textContent;
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce(
      'Desktop file content is extracted through the real document service and indexed on Mobile.',
    );
    const files = filePort();
    const data = new MobileWorkspaceData(files);

    const result = await data.applyAtomically(input, {
      collisionPolicy: 'keep-existing',
      files: [{
        key: 'files/documents/notes.txt', size: 84, sha256: 'a'.repeat(64),
        stagedPath: '/cache/verified/notes.txt', destinationPath: '/documents/imported/notes.txt',
      }],
    });

    expect(result.documents).toBe(1);
    expect(RNFS.readFile).toHaveBeenCalledWith('/cache/verified/notes.txt', 'utf8');
    expect(files.copy).toHaveBeenCalledWith('/cache/verified/notes.txt', '/documents/imported/notes.txt');
    expect(mockExecuteSync.mock.calls.some(([sql]) => sql.includes('INSERT INTO rag_embeddings'))).toBe(true);
  });

  it('fails closed on an unowned path in a corrupted recovery journal', async () => {
    useProjectStore.setState({ projects: [{
      id: 'keep-me', name: 'Local', description: '', systemPrompt: '',
      createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z',
    }] });
    await AsyncStorage.setItem('portable-workspace-import-journal-v1', JSON.stringify({
      version: 1, projectIds: ['keep-me'], conversationIds: [], messageIds: [], attachmentIds: [], documentIds: [],
      paths: ['/private/user-owned/photo.jpg'],
    }));
    const files = filePort();

    expect(await initializeWorkspaceRecovery(files)).toBe(false);
    expect(useProjectStore.getState().projects[0].id).toBe('keep-me');
    expect(files.remove).not.toHaveBeenCalled();
  });

  it('replays a valid crash journal once and repeated recovery is idempotent', async () => {
    useProjectStore.setState({ projects: [{
      id: 'crashed-project', name: 'Partial', description: '', systemPrompt: '',
      createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z',
    }] });
    await AsyncStorage.setItem('portable-workspace-import-journal-v1', JSON.stringify({
      version: 1, projectIds: ['crashed-project'], conversationIds: [], messageIds: [], attachmentIds: [],
      documentIds: ['crashed-document'], paths: ['/documents/recovery/file.txt'],
    }));
    const files = filePort();

    expect(await initializeWorkspaceRecovery(files)).toBe(true);
    expect(useProjectStore.getState().projects).toEqual([]);
    expect(files.remove).toHaveBeenCalledTimes(1);
    expect(mockExecuteSync.mock.calls.some(([sql]) => sql.includes('portable_id = ?'))).toBe(true);

    expect(await initializeWorkspaceRecovery(files)).toBe(true);
    expect(files.remove).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['path traversal', '../outside.txt', 0, 'Unsafe archive entry'],
    ['symbolic link', 'files/link', 0xa000, 'unsupported type'],
  ])('rejects a ZIP %s before native extraction', async (_label, key, mode, message) => {
    const bytes = singleEntryZip(key, mode);
    (RNFS.stat as jest.Mock).mockResolvedValue({ size: bytes.length });
    (RNFS.read as jest.Mock).mockImplementation(async (_path: string, length: number, position: number) =>
      Buffer.from(bytes.slice(position, position + length)).toString('base64'));
    const engine = new BackupEngine(
      new MobileWorkspaceData(filePort()),
      workspaceArchive,
      { deliverFile: async () => undefined, pickFile: async () => null },
      () => '2026-07-17T00:00:00.000Z',
      { cleanupReporter: { reportCleanupFailure: () => undefined } },
    );

    await expect(engine.importPath(`/picked/${mode}.zip`)).rejects.toThrow(message);
    expect(RNFS.mkdir).not.toHaveBeenCalled();
  });
});
