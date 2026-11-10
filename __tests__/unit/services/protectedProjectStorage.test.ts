import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import { protectedProjectStorage, protectProject, unlockProject, permanentlyUnprotectProject, relockProjects, sealNewProjectChat, openProtectedProjectsForBackup } from '../../../src/stores/protectedProjectStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: {
    getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
  },
}));
const fakeProjects: any = { projects: [] };
const fakeChats: any = { conversations: [] };
const fakeStudy: any = { saved: {} };
const mockDocuments = jest.fn(async (..._args: any[]): Promise<any[]> => []);
jest.mock('../../../src/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => fakeProjects,
    setState: (fn: any) => Object.assign(fakeProjects, typeof fn === 'function' ? fn(fakeProjects) : fn),
    persist: { hasHydrated: () => fakeProjects.isHydrated !== false },
  },
}));
jest.mock('../../../src/stores/chatStore', () => ({ useChatStore: { getState: () => fakeChats } }));
const mockProtectChat = jest.fn(async (..._args: any[]) => undefined);
const mockUnlockChat = jest.fn(async (..._args: any[]) => undefined);
const mockUnlocked = new Set<string>();
jest.mock('../../../src/stores/encryptedChatStorage', () => ({
  protectChat: (...args: any[]) => mockProtectChat(...args),
  unlockChat: (...args: any[]) => mockUnlockChat(...args),
  isChatUnlocked: (id: string) => mockUnlocked.has(id),
}));
const mockStudyListeners = new Set<(s: any, prev: any) => void>();
jest.mock('../../../src/study/engine', () => ({ useStudyStore: {
  getState: () => fakeStudy,
  setState: (fn: any) => {
    const prev = { ...fakeStudy };
    Object.assign(fakeStudy, typeof fn === 'function' ? fn(fakeStudy) : fn);
    mockStudyListeners.forEach((l) => l(fakeStudy, prev));
  },
  subscribe: (l: any) => { mockStudyListeners.add(l); return () => mockStudyListeners.delete(l); },
} }));
const mockFiles = new Map<string, string>();
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs', CachesDirectoryPath: '/cache',
  exists: jest.fn(async (p: string) => mockFiles.has(p)),
  readFile: jest.fn(async (p: string) => { if (!mockFiles.has(p)) throw new Error('missing'); return mockFiles.get(p); }),
  writeFile: jest.fn(async (p: string, d: string) => { mockFiles.set(p, d); }),
  unlink: jest.fn(async (p: string) => { mockFiles.delete(p); }),
  mkdir: jest.fn(async () => undefined),
}));
jest.mock('../../../src/services/rag', () => ({ ragService: {
  getDocumentsByProject: (...args: any[]) => mockDocuments(...args),
  exportProjectDocuments: async () => [],
  eraseProjectDocumentsFromIndex: async () => undefined,
  importProjectDocuments: async () => undefined,
} }));
const KEY = 'local-llm-project-storage';
const project = (id: string) => ({ id, name: 'My secret writing project', description: 'Story background', systemPrompt: 'Private story notes',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
const snapshot = (projects: any[]) => JSON.stringify({ state: { projects }, version: 0 });
const encode = (text: string) => `atlasitem:v1:${  Buffer.from(text).toString('base64')}`;
const decode = (blob: string) => Buffer.from(blob.slice('atlasitem:v1:'.length), 'base64').toString();

describe('selective protection for metadata-only projects', () => {
  const disk = new Map<string, string>();
  beforeEach(async () => {
    disk.clear(); mockFiles.clear(); fakeProjects.projects = []; fakeProjects.isHydrated = true; fakeChats.conversations = []; fakeStudy.saved = {};
    (Platform as any).OS = 'android';
    mockDocuments.mockReset().mockResolvedValue([]);
    mockProtectChat.mockReset().mockResolvedValue(undefined); mockUnlockChat.mockReset().mockResolvedValue(undefined); mockUnlocked.clear();
    (NativeModules as any).AtlasDevice = {
      createChatPinVerifier: jest.fn(async (pin: string) => `pin:v1:${  pin}`),
      encryptProtectedItem: jest.fn(async (_kind: string, _id: string, text: string, pin: string, verifier: string) => {
        if (verifier !== `pin:v1:${  pin}`) throw new Error('Wrong PIN');
        return encode(text);
      }),
      decryptProtectedItem: jest.fn(async (_kind: string, _id: string, blob: string, pin: string, verifier: string) => {
        if (verifier !== `pin:v1:${  pin}`) throw new Error('Wrong PIN');
        return decode(blob);
      }),
      removeProtectedItemKey: jest.fn(async () => true),
      verifyChatPin: jest.fn(async (pin: string, verifier: string) => verifier === `pin:v1:${pin}`),
      encryptPortableBackup: jest.fn(async (plain: string, pass: string) => `atlasbackup:v1:${Buffer.from(JSON.stringify({ plain, pass })).toString('base64')}`),
      decryptPortableBackup: jest.fn(async (blob: string, pass: string) => {
        const o = JSON.parse(Buffer.from(blob.slice('atlasbackup:v1:'.length), 'base64').toString());
        if (o.pass !== pass) throw new Error('Wrong key');
        return o.plain;
      }),
    };
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => disk.get(key) ?? null);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => { disk.set(key, value); });
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => { disk.delete(key); });
    await protectedProjectStorage.removeItem(KEY);
  });
  it('keeps ordinary projects readable without any mandatory encryption', async () => {
    await protectedProjectStorage.setItem(KEY, snapshot([project('ordinary')]));
    expect(disk.get(KEY)).toContain('My secret writing project');
    expect((NativeModules as any).AtlasDevice.encryptProtectedItem).not.toHaveBeenCalled();
  });
  it('encrypts only the chosen metadata-only project and permanently unlocks after PIN verification', async () => {
    fakeProjects.projects = [project('ordinary'), project('secret')];
    await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
    await protectProject('secret', '123456');
    const saved = disk.get(KEY)!;
    expect(saved).toContain('ordinary');
    const secureRecord = JSON.parse(saved).state.projects.find((p: any) => p.id === 'secret');
    expect(secureRecord.description).toBe('');
    expect(secureRecord.systemPrompt).toBe('');
    expect(secureRecord.name).toBe('Locked project');
    expect(secureRecord.protectedBlob).toMatch(/^atlasitem:v1:/);
    expect(fakeProjects.projects[1].name).toBe('Locked project');
    await expect(unlockProject('secret', 'wrong')).rejects.toThrow();
    await unlockProject('secret', '123456');
    expect(fakeProjects.projects[1].systemPrompt).toBe('Private story notes');
    await permanentlyUnprotectProject('secret', '123456');
    expect(fakeProjects.projects[1].pinVerifier).toBeUndefined();
    expect(disk.get(KEY)).toContain('Private story notes');
    expect((NativeModules as any).AtlasDevice.removeProtectedItemKey).toHaveBeenCalled();
  });
  it('preserves an unlocked project ciphertext while replacing a different project', async () => {
    fakeProjects.projects = [project('first'), project('second')];
    await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
    await protectProject('first', '111111');
    await protectProject('second', '222222');
    await unlockProject('first', '111111');
    await permanentlyUnprotectProject('second', '222222');
    const first = JSON.parse(disk.get(KEY)!).state.projects.find((p: any) => p.id === 'first');
    expect(decode(first.protectedBlob)).toContain('Private story notes');
    expect(decode(first.protectedBlob)).not.toContain('Locked project');
  });
  it('does not overwrite saved projects when backgrounded before hydration', async () => {
    await protectedProjectStorage.setItem(KEY, snapshot([project('on-disk')]));
    const before = disk.get(KEY);
    fakeProjects.projects = [];
    fakeProjects.isHydrated = false;
    await relockProjects();
    expect(disk.get(KEY)).toBe(before);
  });
  it('seals knowledge-base documents in the protected vault before replacing project metadata', async () => {
    fakeProjects.projects = [project('secret')];
    await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
    const { ragService } = require('../../../src/services/rag');
    const { protectedVault } = require('../../../src/stores/protectedProjectVault');
    const docs = [{ id: 1, name: 'Notes', path: '/private', size: 12, createdAt: '2026-01-01', enabled: 1, chunks: [] }];
    const exportSpy = jest.spyOn(ragService, 'exportProjectDocuments').mockResolvedValueOnce(docs);
    const sealSpy = jest.spyOn(protectedVault, 'seal').mockResolvedValueOnce(undefined);
    try {
      await protectProject('secret', '123456');
      expect(exportSpy).toHaveBeenCalledWith('secret');
      expect(sealSpy).toHaveBeenCalledWith('secret', { pin: '123456', verifier: 'pin:v1:123456' }, docs);
      expect(disk.get(KEY)).not.toContain('Private story notes');
      expect(fakeProjects.projects[0].name).toBe('Locked project');
    } finally {
      exportSpy.mockRestore();
      sealSpy.mockRestore();
    }
  });
  it('moves study outputs into an encrypted file, out of plain storage and memory', async () => {
    fakeProjects.projects = [project('secret')];
    await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
    fakeStudy.saved.secret = [{ title: 'Private quiz', createdAt: 1 }];
    fakeStudy.saved.other = [{ title: 'Public guide', createdAt: 2 }];
    await protectProject('secret', '123456');
    const file = [...mockFiles.entries()].find(([k]) => k.endsWith('secret.study'));
    expect(file).toBeDefined();
    expect(file![1].startsWith('atlasitem:v1:')).toBe(true);
    expect(decode(file![1])).toContain('Private quiz');
    expect(fakeStudy.saved.secret).toBeUndefined();
    expect(fakeStudy.saved.other).toHaveLength(1);
  });
  it('opens study outputs on unlock, re-encrypts changes, and drops them on re-lock', async () => {
    fakeProjects.projects = [project('secret')];
    await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
    fakeStudy.saved.secret = [{ title: 'Private quiz', createdAt: 1 }];
    await protectProject('secret', '123456');
    await unlockProject('secret', '123456');
    expect(fakeStudy.saved.secret).toEqual([{ title: 'Private quiz', createdAt: 1 }]);
    const { useStudyStore } = require('../../../src/study/engine');
    useStudyStore.setState((st: any) => ({ saved: { ...st.saved, secret: [...st.saved.secret, { title: 'New game', createdAt: 3 }] } }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const file = [...mockFiles.entries()].find(([k]) => k.endsWith('secret.study'))!;
    expect(decode(file[1])).toContain('New game');
    await relockProjects();
    expect(fakeStudy.saved.secret).toBeUndefined();
  });
  it('permanently unprotecting returns study outputs to ordinary storage', async () => {
    fakeProjects.projects = [project('secret')];
    await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
    fakeStudy.saved.secret = [{ title: 'Private quiz', createdAt: 1 }];
    await protectProject('secret', '123456');
    await permanentlyUnprotectProject('secret', '123456');
    expect(fakeStudy.saved.secret).toEqual([{ title: 'Private quiz', createdAt: 1 }]);
    expect([...mockFiles.keys()].some((k) => k.endsWith('secret.study'))).toBe(false);
  });
  it("encrypts the project's existing chats with the project PIN before locking it", async () => {
    fakeProjects.projects = [project('therapy')];
    await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
    fakeChats.conversations = [
      { id: 'c1', projectId: 'therapy' }, { id: 'c2', projectId: 'therapy' },
      { id: 'own-pin', projectId: 'therapy', pinVerifier: 'pin:v1:999999' },
      { id: 'temp', projectId: 'therapy', isPrivate: true }, { id: 'other', projectId: 'elsewhere' },
    ];
    await protectProject('therapy', '123456');
    expect(mockProtectChat.mock.calls).toEqual([['c1', '123456'], ['c2', '123456']]);
    expect(fakeProjects.projects[0].pinVerifier).toBe('pin:v1:123456');
  });
  it('does not lock the project when a chat cannot be encrypted', async () => {
    fakeProjects.projects = [project('therapy')];
    await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
    fakeChats.conversations = [{ id: 'c1', projectId: 'therapy' }];
    mockProtectChat.mockRejectedValueOnce(new Error('Chat is not yet saved'));
    await expect(protectProject('therapy', '123456')).rejects.toThrow(/not yet saved/);
    expect(fakeProjects.projects[0].pinVerifier).toBeUndefined();
  });
  it("unlocking the project opens its chats that share the PIN", async () => {
    fakeProjects.projects = [project('therapy')];
    await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
    await protectProject('therapy', '123456');
    fakeChats.conversations = [
      { id: 'c1', projectId: 'therapy', pinVerifier: 'v' }, { id: 'open', projectId: 'therapy', pinVerifier: 'v' },
      { id: 'plain', projectId: 'therapy' },
    ];
    mockUnlocked.add('open');
    mockProtectChat.mockClear();
    await unlockProject('therapy', '123456');
    // The still-plain chat is sealed with the project PIN, then opened with the locked one.
    expect(mockProtectChat.mock.calls).toEqual([['plain', '123456']]);
    expect(mockUnlockChat.mock.calls).toEqual([['c1', '123456'], ['plain', '123456']]);
  });
  it('seals a chat created inside an unlocked protected project, retrying until it is saved', async () => {
    jest.useFakeTimers();
    try {
      fakeProjects.projects = [project('therapy')];
      await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
      await protectProject('therapy', '123456');
      await unlockProject('therapy', '123456');
      mockProtectChat.mockReset().mockRejectedValueOnce(new Error('Protected chat is missing from saved data.')).mockResolvedValue(undefined);
      mockUnlockChat.mockClear();
      const sealing = sealNewProjectChat('new-chat', 'therapy');
      await jest.advanceTimersByTimeAsync(300);
      await sealing;
      expect(mockProtectChat).toHaveBeenCalledTimes(2);
      expect(mockUnlockChat).toHaveBeenCalledWith('new-chat', '123456');
    } finally { jest.useRealTimers(); }
  });
  it('does not seal a new chat once the project is locked again', async () => {
    await sealNewProjectChat('new-chat', 'never-unlocked');
    expect(mockProtectChat).not.toHaveBeenCalled();
  });
  it('seals an unlocked protected project portably for a backup and opens it on a new phone with its PIN', async () => {
    const { protectedVault } = require('../../../src/stores/protectedProjectVault');
    const { protectedStudyVault } = require('../../../src/stores/protectedStudyVault');
    fakeProjects.projects = [project('therapy')];
    await protectedProjectStorage.setItem(KEY, snapshot(fakeProjects.projects));
    fakeStudy.saved.therapy = [{ title: 'Coping skills quiz', createdAt: 1 }];
    await protectProject('therapy', '123456');
    await unlockProject('therapy', '123456');
    const docs = [{ id: -1, name: 'Personal History', path: 'atlas-note:Personal History', size: 5, createdAt: 'x', enabled: 1, chunks: [] }];
    jest.spyOn(protectedVault, 'readAll').mockResolvedValueOnce(docs);
    const [stubbed] = await openProtectedProjectsForBackup();
    expect(stubbed.name).toBe('Locked project');
    expect(stubbed.systemPrompt).toBe('');
    expect(stubbed.protectedBlob!.startsWith('atlasbackup:v1:')).toBe(true);
    expect(JSON.stringify(stubbed)).not.toMatch(/Private story notes|Personal History|Coping skills/);

    // New phone: only the portable stub exists. The first unlock moves it onto on-phone keys.
    await relockProjects();
    mockFiles.clear(); disk.clear();
    fakeProjects.projects = [stubbed];
    await protectedProjectStorage.setItem(KEY, snapshot([stubbed]));
    const sealDocs = jest.spyOn(protectedVault, 'seal').mockResolvedValue(undefined);
    const sealStudy = jest.spyOn(protectedStudyVault, 'seal');
    await expect(unlockProject('therapy', '000000')).rejects.toThrow(/Incorrect PIN/);
    await unlockProject('therapy', '123456');
    expect(sealDocs).toHaveBeenCalledWith('therapy', { pin: '123456', verifier: 'pin:v1:123456' }, docs);
    expect(sealStudy).toHaveBeenCalledWith('therapy', { pin: '123456', verifier: 'pin:v1:123456' }, [{ title: 'Coping skills quiz', createdAt: 1 }]);
    expect(fakeProjects.projects[0].systemPrompt).toBe('Private story notes');
    const saved = JSON.parse(disk.get(KEY)!).state.projects[0];
    expect(saved.protectedBlob.startsWith('atlasitem:v1:')).toBe(true); // now on this phone's keys
  });
});
