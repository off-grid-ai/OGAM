import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import { exportBackup, importBackup } from '../../../src/atlasTools/backup';
const mockStore = new Map<string, string>();
let mockArchive = '';
const mockCollect = jest.fn(async (_ids: string[]) => [{
  projectId: 'therapy', name: 'history.pdf', size: 3, enabled: true,
  createdAt: '2026-01-01', base64: 'YWJj', chunks: [{ content: 'My history', position: 0 }],
}]);
const mockRestore = jest.fn(async (_files: any[], _ids: string[]) => 1);
jest.mock('../../../src/atlasTools/projectBackupFiles', () => ({
  collectProjectFiles: (...a: any[]) => mockCollect(...a as [string[]]),
  restoreProjectFiles: (...a: any[]) => mockRestore(...a as [any[], string[]]),
  // The real preflight check: restore must refuse corrupt manifests before touching any store.
  validateProjectFiles: jest.requireActual('../../../src/atlasTools/projectBackupFiles').validateProjectFiles,
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getAllKeys: jest.fn(async () => [...mockStore.keys()]),
  multiGet: jest.fn(async (keys: string[]) => keys.map(k => [k, mockStore.get(k) ?? null])),
  multiSet: jest.fn(async (items: [string,string][]) => { for (const [k,v] of items) mockStore.set(k,v); }),
}}));
jest.mock('react-native-fs', () => ({ __esModule: true, default: {
  CachesDirectoryPath: '/cache',
  stat: jest.fn(async () => ({ size: Buffer.byteLength(mockArchive) })),
  readFile: jest.fn(async () => mockArchive),
  writeFile: jest.fn(async (_p: string, v: string) => { mockArchive = v; }),
  unlink: jest.fn(async () => undefined),
}}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(async () => [{ uri:'file:///cache/backup.atlasbackup', name:'backup.atlasbackup' }]),
  saveDocuments: jest.fn(async () => [{ name:'backup.atlasbackup' }]),
  types: { json:'json', plainText:'text', allFiles:'*/*' },
}));
jest.mock('../../../src/utils/resolvePickedFileUri', () => ({
  resolvePickedFileUri: jest.fn(async () => '/cache/backup.atlasbackup'),
}));
jest.mock('../../../src/stores/encryptedChatStorage', () => ({
  encryptedChatStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));
const projects = () => JSON.stringify({state:{projects:[{id:'therapy',name:'Therapy',systemPrompt:'Notes'}]},version:0});
describe('portable backup project file round trip', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockStore.clear(); mockArchive = '';
    mockStore.set('local-llm-project-storage', projects());
    (Platform as any).OS = 'android';
    (NativeModules as any).AtlasDevice = {
      encryptPortableBackup: jest.fn(async (raw:string, password:string) => `atlasbackup:v1:${  Buffer.from(JSON.stringify({raw,password})).toString('base64')}`),
      decryptPortableBackup: jest.fn(async (v:string,password:string) => {
        const payload = JSON.parse(Buffer.from(v.slice('atlasbackup:v1:'.length),'base64').toString());
        if (payload.password !== password) throw new Error('Wrong backup password');
        return payload.raw;
      }),
    };
  });
  it('exports project documents into an encrypted v2 archive and restores the IDs and bytes', async () => {
    await exportBackup('very-long-backup-password');
    expect(mockArchive.startsWith('atlasbackup:v1:')).toBe(true);
    expect(mockCollect).toHaveBeenCalledWith(['therapy']);
    const record = JSON.parse(Buffer.from(mockArchive.slice('atlasbackup:v1:'.length), 'base64').toString());
    const data = JSON.parse(record.raw);
    expect(data.version).toBe(2);
    expect(data.projectFiles[0]).toMatchObject({ projectId:'therapy', name:'history.pdf', base64:'YWJj' });
    mockStore.clear();
    expect(await importBackup('very-long-backup-password')).toBe(2);
    expect(mockRestore).toHaveBeenCalledWith([
      expect.objectContaining({projectId:'therapy',name:'history.pdf'}),
    ],['therapy']);
    expect(mockStore.has('local-llm-project-storage')).toBe(true);
  });
  it('plain backup stays v1 without project file data', async () => {
    await exportBackup();
    expect(JSON.parse(mockArchive)).toMatchObject({version:1});
    expect(JSON.parse(mockArchive).projectFiles).toBeUndefined();
    expect(mockCollect).not.toHaveBeenCalled();
  });
  it('refuses corrupt restored project files before importing settings', async () => {
    await exportBackup('very-long-backup-password');
    mockRestore.mockRejectedValueOnce(new Error('Invalid project document in backup'));
    const before = JSON.stringify([...mockStore.entries()].sort());
    await expect(importBackup('very-long-backup-password')).rejects.toThrow(/Invalid project document/);
    // The project documents are restored last; when that fails the settings written before it are put back.
    expect(JSON.stringify([...mockStore.entries()].sort())).toBe(before);
  });
});

describe('restoring a backup on the same phone', () => {
  it("keeps this phone's protected projects that the backup does not contain", async () => {
    const { keepDeviceProtected } = require('../../../src/atlasTools/backup');
    const onPhone = { id: 'therapy', name: 'Locked project', pinVerifier: 'pin:v1:1', protectedBlob: 'atlasitem:v1:abc' };
    mockStore.set('local-llm-project-storage', JSON.stringify({ state: { projects: [onPhone, { id: 'old', name: 'Old' }] }, version: 0 }));
    const fromBackup = JSON.stringify({ state: { projects: [{ id: 'school', name: 'School' }] }, version: 0 });
    (AsyncStorage as any).getItem = jest.fn(async (k: string) => mockStore.get(k) ?? null);
    const merged = JSON.parse(await keepDeviceProtected('local-llm-project-storage', fromBackup));
    // The backup replaces ordinary projects, but never deletes a protected one that lives only here.
    expect(merged.state.projects.map((p: any) => p.id)).toEqual(['school', 'therapy']);
  });
});
