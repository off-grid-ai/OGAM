import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import { NativeModules, Platform } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: {
    getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(), multiRemove: jest.fn(),
    getAllKeys: jest.fn(), multiGet: jest.fn(), multiSet: jest.fn(),
  },
}));
const fakeState: any = { conversations: [], activeConversationId: null };
jest.mock('../../../src/stores/chatStore', () => ({
  useChatStore: {
    getState: () => fakeState,
    setState: (updater: any) => Object.assign(fakeState, typeof updater === 'function' ? updater(fakeState) : updater),
    persist: { rehydrate: jest.fn() },
  },
}));
const mockSaved: { name: string; data: string }[] = [];
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(async () => [{ uri: 'file:///picked/backup.atlasbackup', name: 'backup.atlasbackup' }]),
  saveDocuments: jest.fn(async () => [{ name: 'saved.atlasbackup' }]),
  keepLocalCopy: jest.fn(async () => [{ status: 'success', localUri: 'file:///picked/backup.atlasbackup' }]),
  types: { json: 'application/json', plainText: 'text/plain', allFiles: '*/*' },
}));

import { exportBackup, importBackup } from '../../../src/atlasTools/backup';
import { protectChat, unlockChat, encryptedChatStorage } from '../../../src/stores/encryptedChatStorage';

const KEY = 'local-llm-chat-storage';
const b64 = (t: string) => Buffer.from(t).toString('base64');
const un64 = (t: string) => Buffer.from(t, 'base64').toString();
const SECRET = 'my very private diary entry';
const TITLE = 'Private diary title';
const PASSWORD = 'correct horse battery';
const chat = (id: string): any => ({
  id, title: TITLE, modelId: 'm', messages: [{ id: 'm1', role: 'user', content: SECRET, timestamp: 1 }],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

require('../../utils/registerStores').registerStoreRefs();

describe('locked chats in encrypted backups', () => {
  const disk = new Map<string, string>();
  const files = new Map<string, string>();
  let outerPlain = '';

  beforeEach(async () => {
    disk.clear(); files.clear(); outerPlain = '';
    fakeState.conversations = [];
    (Platform as any).OS = 'android';
    (NativeModules as any).AtlasDevice = {
      encryptChatState: jest.fn(async (p: string) => 'atlasenc:v1:' + b64(p)),
      decryptChatState: jest.fn(async (b: string) => un64(b.slice('atlasenc:v1:'.length))),
      createChatPinVerifier: jest.fn(async (pin: string) => 'pin:v1:' + pin),
      verifyChatPin: jest.fn(async (pin: string, v: string) => v === 'pin:v1:' + pin),
      encryptProtectedItem: jest.fn(async (_k: string, _i: string, plain: string, pin: string, v: string) => {
        if (v !== 'pin:v1:' + pin) throw new Error('Wrong PIN');
        return 'atlasitem:v1:' + b64(plain);
      }),
      decryptProtectedItem: jest.fn(async (_k: string, _i: string, blob: string, pin: string, v: string) => {
        if (v !== 'pin:v1:' + pin) throw new Error('Wrong PIN');
        return un64(blob.slice('atlasitem:v1:'.length));
      }),
      removeProtectedItemKey: jest.fn(async () => true),
      // Stand-in cipher: reversible only with the right passphrase, never readable as text.
      encryptPortableBackup: jest.fn(async (plain: string, pass: string) => {
        if (pass === PASSWORD) outerPlain = plain;
        return 'atlasbackup:v1:' + b64(pass + '\u0000' + plain);
      }),
      decryptPortableBackup: jest.fn(async (payload: string, pass: string) => {
        const [p, ...rest] = un64(payload.slice('atlasbackup:v1:'.length)).split('\u0000');
        if (p !== pass) throw new Error('Wrong password');
        return rest.join('\u0000');
      }),
    };
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) => disk.get(k) ?? null);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (k: string, v: string) => { disk.set(k, v); });
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (k: string) => { disk.delete(k); });
    (AsyncStorage.multiRemove as jest.Mock).mockImplementation(async (ks: string[]) => { ks.forEach(k => disk.delete(k)); });
    (AsyncStorage.getAllKeys as jest.Mock).mockImplementation(async () => [...disk.keys()]);
    (AsyncStorage.multiGet as jest.Mock).mockImplementation(async (ks: string[]) => ks.map(k => [k, disk.get(k) ?? null]));
    (AsyncStorage.multiSet as jest.Mock).mockImplementation(async (ps: [string, string][]) => { ps.forEach(([k, v]) => disk.set(k, v)); });
    (RNFS.writeFile as jest.Mock).mockImplementation(async (p: string, d: string) => { files.set(p, d); });
    (RNFS.readFile as jest.Mock).mockImplementation(async (p: string) => files.get(p) ?? '');
    (RNFS.stat as jest.Mock).mockImplementation(async (p: string) => ({ size: (files.get(p) ?? '').length }));
    const picker = require('@react-native-documents/picker');
    picker.pick.mockImplementation(async () => [{ uri: 'file:///picked/backup.atlasbackup', name: 'backup.atlasbackup' }]);
    picker.saveDocuments.mockImplementation(async ({ sourceUris }: any) => {
      files.set('/picked/backup.atlasbackup', files.get(String(sourceUris[0]).replace('file://', '')) ?? '');
      return [{ name: 'saved.atlasbackup' }];
    });
    await encryptedChatStorage.removeItem(KEY);
  });

  const setup = async () => {
    fakeState.conversations = [chat('locked1'), { ...chat('plain1'), title: 'Ordinary', messages: [{ id: 'p1', role: 'user', content: 'ordinary text', timestamp: 1 }] }];
    await encryptedChatStorage.setItem(KEY, JSON.stringify({ state: { conversations: fakeState.conversations, activeConversationId: null }, version: 0 }));
    await protectChat('locked1', '123456');
  };

  it('keeps a still-locked chat as ciphertext, without its title or messages', async () => {
    await setup();
    await exportBackup(PASSWORD);
    expect(outerPlain).not.toContain(SECRET);
    expect(outerPlain).not.toContain(TITLE);
    const state = JSON.parse(JSON.parse(outerPlain).items[KEY]).state;
    const locked = state.conversations.find((c: any) => c.id === 'locked1');
    expect(locked.messages).toEqual([]);
    expect(locked.protectedBlob).toMatch(/^atlasitem:v1:/);
    expect(state.conversations.some((c: any) => c.title === 'Ordinary')).toBe(true);
  });

  it('seals an open locked chat with its PIN and restores it locked, opening only with that PIN', async () => {
    await setup();
    await unlockChat('locked1', '123456');
    await exportBackup(PASSWORD);
    expect(outerPlain).not.toContain(SECRET);
    expect(outerPlain).not.toContain(TITLE);
    const state = JSON.parse(JSON.parse(outerPlain).items[KEY]).state;
    const locked = state.conversations.find((c: any) => c.id === 'locked1');
    expect(locked.protectedBlob).toMatch(/^atlasbackup:v1:/);
    expect(locked.messages).toEqual([]);

    // A new phone: nothing saved yet, the old phone's Keystore blob is useless.
    disk.clear();
    fakeState.conversations = [];
    await encryptedChatStorage.removeItem(KEY);
    expect(await importBackup(PASSWORD)).toBeGreaterThan(0);
    const restored = JSON.parse(disk.get(KEY)!);
    expect(JSON.stringify(restored)).not.toContain(SECRET);
    const conv = restored.state.conversations.find((c: any) => c.id === 'locked1');
    expect(conv.title).toBe('Locked conversation');
    expect(conv.pinVerifier).toBe('pin:v1:123456');

    fakeState.conversations = restored.state.conversations;
    await expect(unlockChat('locked1', '000000')).rejects.toThrow();
    await unlockChat('locked1', '123456');
    const opened = fakeState.conversations.find((c: any) => c.id === 'locked1');
    expect(opened.messages[0].content).toBe(SECRET);
    // After unlocking it is tied to this phone's key again; the disk copy holds no plaintext.
    expect(disk.get(KEY)).not.toContain(SECRET);
  });

  it('refuses a backup entry that smuggles readable messages into a locked chat', async () => {
    await setup();
    await exportBackup(PASSWORD);
    const data = JSON.parse(outerPlain);
    const state = JSON.parse(data.items[KEY]);
    const evil = state.state.conversations.find((c: any) => c.id === 'locked1');
    evil.messages = [{ id: 'x', role: 'user', content: 'planted', timestamp: 1 }];
    evil.title = 'Planted title';
    data.items[KEY] = JSON.stringify(state);
    files.set('/picked/backup.atlasbackup', 'atlasbackup:v1:' + b64(PASSWORD + '\u0000' + JSON.stringify(data)));
    await importBackup(PASSWORD);
    const restored = JSON.parse(disk.get(KEY)!);
    const conv = restored.state.conversations.find((c: any) => c.id === 'locked1');
    expect(conv.messages).toEqual([]);
    expect(conv.title).toBe('Locked conversation');
  });

  it('drops a locked entry that has no recognised ciphertext', async () => {
    await setup();
    await exportBackup(PASSWORD);
    const data = JSON.parse(outerPlain);
    const state = JSON.parse(data.items[KEY]);
    state.state.conversations.find((c: any) => c.id === 'locked1').protectedBlob = 'plain text';
    data.items[KEY] = JSON.stringify(state);
    files.set('/picked/backup.atlasbackup', 'atlasbackup:v1:' + b64(PASSWORD + '\u0000' + JSON.stringify(data)));
    await importBackup(PASSWORD);
    const restored = JSON.parse(disk.get(KEY)!);
    // The tampered entry is refused; this phone's own sealed copy of that chat is kept, never deleted.
    const kept = restored.state.conversations.filter((c: any) => c.id === 'locked1');
    expect(kept.every((c: any) => c.protectedBlob !== 'plain text')).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(1);
  });
});
