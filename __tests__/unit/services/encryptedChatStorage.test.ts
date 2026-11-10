import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import { encryptedChatStorage, protectChat, unlockChat, permanentlyUnprotectChat, relockProtectedChats } from '../../../src/stores/encryptedChatStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: {
    getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(), multiRemove: jest.fn(),
  },
}));
const fakeState: any = { conversations: [], activeConversationId: null };
jest.mock('../../../src/stores/chatStore', () => ({
  useChatStore: {
    getState: () => fakeState,
    setState: (updater: any) => Object.assign(fakeState, typeof updater === 'function' ? updater(fakeState) : updater),
    persist: { hasHydrated: () => fakeState.isHydrated !== false },
  },
}));

const KEY = 'local-llm-chat-storage';
const encode = (text: string) => `atlasitem:v1:${  Buffer.from(text).toString('base64')}`;
const decode = (text: string) => Buffer.from(text.slice('atlasitem:v1:'.length), 'base64').toString();
const chat = (id: string, content = 'a secret conversation'): any => ({
  id, title: `Sensitive title ${  id}`, modelId: 'model', messages: [{ id: 'm', role: 'user', content, timestamp: 10 }],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
const snapshot = (conversations: any[]) => JSON.stringify({ state: { conversations, activeConversationId: null }, version: 0 });

require('../../utils/registerStores').registerStoreRefs();

describe('selective and migration-safe chat storage', () => {
  const disk = new Map<string, string>();
  beforeEach(async () => {
    disk.clear();
    fakeState.conversations = [];
    fakeState.activeConversationId = null;
    fakeState.isHydrated = true;
    (Platform as any).OS = 'android';
    (NativeModules as any).AtlasDevice = {
      encryptChatState: jest.fn(async (plain: string) => `atlasenc:v1:${  plain}`),
      decryptChatState: jest.fn(async (blob: string) => blob.replace(/^atlasenc:v1:/, '')),
      createChatPinVerifier: jest.fn(async (pin: string) => `pin:v1:${  pin}`),
      verifyChatPin: jest.fn(async (pin: string, verifier: string) => verifier === `pin:v1:${  pin}`),
      encryptProtectedItem: jest.fn(async (_kind: string, _id: string, plain: string, pin: string, verifier: string) => {
        if (verifier !== `pin:v1:${  pin}`) throw new Error('Wrong PIN');
        return encode(plain);
      }),
      decryptProtectedItem: jest.fn(async (_kind: string, _id: string, blob: string, pin: string, verifier: string) => {
        if (verifier !== `pin:v1:${  pin}`) throw new Error('Wrong PIN');
        return decode(blob);
      }),
      removeProtectedItemKey: jest.fn(async () => true),
    };
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => disk.get(key) ?? null);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => { disk.set(key, value); });
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => { disk.delete(key); });
    (AsyncStorage.multiRemove as jest.Mock).mockImplementation(async (keys: string[]) => { keys.forEach(key => disk.delete(key)); });
    await encryptedChatStorage.removeItem(KEY);
  });

  it('persists ordinary chats without mandatory app-wide encryption', async () => {
    await encryptedChatStorage.setItem(KEY, snapshot([chat('ordinary')]));
    expect(disk.get(KEY)).toContain('Sensitive title ordinary');
    expect(disk.get('atlas-chat-encrypted-v1')).toBeUndefined();
    expect((NativeModules as any).AtlasDevice.encryptChatState).not.toHaveBeenCalled();
  });
  it('migrates an older whole-archive Keystore record before deleting it', async () => {
    disk.set('atlas-chat-encrypted-v1', `atlasenc:v1:${  snapshot([chat('normal')])}`);
    const restored = await encryptedChatStorage.getItem(KEY);
    expect(restored).toContain('Sensitive title normal');
    expect(disk.has('atlas-chat-encrypted-v1')).toBe(false);
    expect(disk.get(KEY)).toBe(restored);
  });
  it('migrates older PIN-locked chats to individually encrypted placeholders', async () => {
    const legacy = { ...chat('locked'), pinVerifier: 'pin:v1:123456' };
    disk.set('atlas-chat-encrypted-v1', `atlasenc:v1:${  snapshot([legacy])}`);
    const restored = JSON.parse((await encryptedChatStorage.getItem(KEY))!);
    expect(restored.state.conversations[0].messages).toEqual([]);
    expect(restored.state.conversations[0].title).toBe('Locked conversation');
    expect(restored.state.conversations[0].protectedBlob).toMatch(/^atlasenc:v1:/);
    expect((NativeModules as any).AtlasDevice.encryptChatState).toHaveBeenCalled();
  });
  it('protects one chat and permanently restores it after verifying the same PIN', async () => {
    const normal = chat('normal');
    const secret = chat('secret', 'confidential project notes');
    fakeState.conversations = [normal, secret];
    await encryptedChatStorage.setItem(KEY, snapshot(fakeState.conversations));
    await protectChat('secret', '123456');
    const secured = disk.get(KEY)!;
    expect(secured).toContain('Sensitive title normal');
    expect(secured).not.toContain('confidential project notes');
    expect(secured).not.toContain('Sensitive title secret');
    expect(fakeState.conversations[1].messages).toHaveLength(0);
    await expect(unlockChat('secret', 'wrong')).rejects.toThrow();
    await unlockChat('secret', '123456');
    expect(fakeState.conversations[1].messages[0].content).toBe('confidential project notes');
    await permanentlyUnprotectChat('secret', '123456');
    expect(fakeState.conversations[1].pinVerifier).toBeUndefined();
    expect(disk.get(KEY)).toContain('confidential project notes');
    expect((NativeModules as any).AtlasDevice.removeProtectedItemKey).toHaveBeenCalled();
  });
  it('does not replace another unlocked chat ciphertext with a locked placeholder', async () => {
    fakeState.conversations = [chat('first', 'preserve original first'), chat('second', 'preserve original second')];
    await encryptedChatStorage.setItem(KEY, snapshot(fakeState.conversations));
    await protectChat('first', '111111');
    await protectChat('second', '222222');
    await unlockChat('first', '111111');
    await permanentlyUnprotectChat('second', '222222');
    const first = JSON.parse(disk.get(KEY)!).state.conversations.find((c: any) => c.id === 'first');
    expect(decode(first.protectedBlob)).toContain('preserve original first');
    expect(decode(first.protectedBlob)).not.toContain('Locked conversation');
  });
  it('does not overwrite saved chats when backgrounded before hydration', async () => {
    await encryptedChatStorage.setItem(KEY, snapshot([chat('on-disk', 'important')]));
    const before = disk.get(KEY);
    fakeState.conversations = [];
    fakeState.isHydrated = false;
    await relockProtectedChats();
    expect(disk.get(KEY)).toBe(before);
  });
  it('fails closed if the native protection API is unavailable', async () => {
    fakeState.conversations = [chat('secret')];
    await encryptedChatStorage.setItem(KEY, snapshot(fakeState.conversations));
    (NativeModules as any).AtlasDevice = undefined;
    await expect(protectChat('secret', '123456')).rejects.toThrow();
    expect(disk.get(KEY)).toContain('Sensitive title secret');
  });
});
