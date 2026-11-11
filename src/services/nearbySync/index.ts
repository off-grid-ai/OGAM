import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { useProjectStore } from '../../stores/projectStore';
import { useChatStore } from '../../stores/chatStore';
import { useAgentStore } from '../../stores/agentStore';
import { useAuthStore } from '../../stores/authStore';
import { collectProjectFiles, restoreProjectFiles } from '../../atlasTools/projectBackupFiles';
import { mergeAgents, mergeConversations, mergeProjects, validateSnapshot } from './merge';
import type { SyncSnapshot } from './merge';
import { applyTombstones, captureRemovals, combineTombstones, emptyTombstones, validateTombstones } from './tombstones';
import type { Tombstones, SyncKind } from './tombstones';
import { applyStores, localStores } from './stores';
import { applySecrets, localSecrets } from './secrets';
import { audioOnPhone, receiveAudio, sendMissingAudio, type AudioChunk } from './audio';
import { useRecordings } from '../../atlasRecorder/store';

const PREF = 'atlas-sync-enabled-v1';
const SHARE_SECRETS_PREF = 'atlas-sync-share-credentials-v1';
const DELETED_PREF = 'atlas-sync-deletions-v1';
/** How long after the last local change the paired phones are synced. */
const PUSH_DELAY_MS = 5000;
type NativeReply = { peerId: string; payload: string; transport: 'wifi' | 'bluetooth' };
type Peer = { id: string; address: string };
type NativeNearby = {
  start(): Promise<{ deviceId: string; address: string; port: number }>;
  stop(): Promise<boolean>;
  invitation(): Promise<string>;
  pair(uri: string, payload: string): Promise<NativeReply>;
  sync(id: string, payload: string): Promise<NativeReply>;
  respond(requestId: string, payload: string): Promise<boolean>;
  peers(): Promise<Peer[]>;
  unpair(id: string): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};
export interface NearbyStatus {
  enabled: boolean;
  shareSecrets: boolean;
  deviceId: string;
  peers: Peer[];
  lastSync?: string;
  lastError?: string;
  syncing: boolean;
}
type Incoming = { requestId: string; peerId: string; payload: string; newPair: boolean };
/** A piece of recording audio (not a full sync message), or null. */
const audioChunk = (payload: string): (AudioChunk & { sourceId: string }) | null => {
  if (!payload.startsWith('{"kind":"audio"')) return null;
  try { return JSON.parse(payload); } catch { return null; }
};
export const nearbyAvailable = Platform.OS === 'android' && Boolean(NativeModules.AtlasNearbySync);
const native = (): NativeNearby => {
  if (!nearbyAvailable) throw new Error('Offline peer sync needs the updated Android build.');
  return NativeModules.AtlasNearbySync as NativeNearby;
};
class NearbySyncService {
  private deviceId = '';
  private enabled = false;
  private shareSecrets = false;
  private active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
  private running = false;
  private polling: ReturnType<typeof setInterval> | null = null;
  private listener: { remove(): void } | null = null;
  private appListener: { remove(): void } | null = null;
  private busy = false;
  private mergeQueue: Promise<void> = Promise.resolve();
  private deleted: Tombstones = emptyTombstones();
  private applyingRemote = false;
  private trackingStarted = false;
  private listeners = new Set<(s: NearbyStatus) => void>();
  private status: NearbyStatus = { enabled: false, shareSecrets: false, deviceId: '', peers: [], syncing: false };
  getStatus() { return this.status; }
  subscribe(fn: (s: NearbyStatus) => void) { this.listeners.add(fn); fn(this.status); return () => { this.listeners.delete(fn); }; }
  private publish(patch: Partial<NearbyStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }
  private isLocked() {
    const state = useAuthStore.getState();
    return state.isEnabled && state.isLocked;
  }
  private async hydrated() {
    const stores = [useProjectStore, useChatStore, useAgentStore] as const;
    for (const store of stores) {
      if (store.persist?.hasHydrated?.() === false) await store.persist.rehydrate();
    }
  }
  private observeRemovals(kind: SyncKind, before: { id: string; pinVerifier?: string; protectedBlob?: string; isPrivate?: boolean }[],
    after: { id: string }[]) {
    if (this.applyingRemote || this.restoring > 0 || before === after) return;
    const next = captureRemovals(before, after, { current: this.deleted, kind });
    if (Object.keys(next[kind]).length === Object.keys(this.deleted[kind]).length) return;
    this.deleted = next;
    AsyncStorage.setItem(DELETED_PREF, JSON.stringify(this.deleted)).catch(error =>
      this.publish({ lastError: String(error) }));
  }
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  /** A change made on this phone goes to the paired phones a few seconds later, not at the next minute tick. */
  private schedulePush() {
    if (this.applyingRemote || this.restoring > 0 || !this.running) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.syncAll().catch(() => undefined);
    }, PUSH_DELAY_MS);
  }
  private watchStores() {
    if (this.trackingStarted) return;
    this.trackingStarted = true;
    useChatStore.subscribe((next, previous) => {
      if (next.conversations !== previous.conversations) {
        this.observeRemovals('conversations', previous.conversations, next.conversations);
        // Streaming a reply rewrites the chat on every token; wait until it is finished.
        if (!next.isStreaming) this.schedulePush();
      }
    });
    useProjectStore.subscribe((next, previous) => {
      if (next.projects !== previous.projects) {
        this.observeRemovals('projects', previous.projects, next.projects);
        this.schedulePush();
      }
    });
    useAgentStore.subscribe((next, previous) => {
      if (next.agents !== previous.agents) {
        this.observeRemovals('agents', previous.agents, next.agents);
        this.schedulePush();
      }
    });
    useRecordings.subscribe((next, previous) => {
      if (next.recordings !== previous.recordings) {
        this.observeRemovals('recordings', previous.recordings, next.recordings);
        this.schedulePush();
      }
    });
  }
  /** Forget that an item was deleted (the user undid the delete), so it is not removed from the other phone. */
  forgetDeletion(kind: SyncKind, id: string) {
    if (!(id in this.deleted[kind])) return;
    const { [id]: _gone, ...rest } = this.deleted[kind];
    this.deleted = { ...this.deleted, [kind]: rest };
    AsyncStorage.setItem(DELETED_PREF, JSON.stringify(this.deleted)).catch(error =>
      this.publish({ lastError: String(error) }));
  }
  /** > 0 while a backup is being restored. */
  private restoring = 0;
  /** Runs `fn` (a restore) without the stores' changes counting as deletions to send to the other phone. */
  async suppressRemovals<T>(fn: () => Promise<T>): Promise<T> {
    this.restoring++;
    try { return await fn(); } finally { this.restoring--; }
  }
  /** Set when the last snapshot had to leave project files out (kept visible after a sync that otherwise worked). */
  private fileNote: string | undefined;
  private async snapshot(): Promise<SyncSnapshot> {
    await this.hydrated();
    const projects = useProjectStore.getState().projects
      .filter(p => !p.pinVerifier && !p.protectedBlob);
    const allowed = new Set(projects.map(p => p.id));
    const conversations = useChatStore.getState().conversations
      .filter(c => !c.isPrivate && !c.pinVerifier && !c.protectedBlob &&
        (!c.projectId || allowed.has(c.projectId)))
      .map(c => ({ ...c, messages: c.messages.map(m => ({ ...m, audioPath: undefined })) }));
    const agents = useAgentStore.getState().agents;
    // One missing attachment, or more files than the size limit, must not stop chats, settings and
    // recordings from syncing: send everything else and say the files were skipped.
    let files: Awaited<ReturnType<typeof collectProjectFiles>> = [];
    this.fileNote = undefined;
    try { files = await collectProjectFiles(projects.map(p => p.id)); } catch (e) {
      this.fileNote = `Project files were not synced: ${e instanceof Error ? e.message : String(e)}`;
      this.publish({ lastError: this.fileNote });
    }
    // Locked projects and chats go across sealed with their own PIN, so they open on the other
    // phone with the same PIN. Only ones opened since Atlas started can be sealed that way.
    const { openProtectedProjectsForBackup } = require('../../stores/protectedProjectStorage');
    const { openLockedChatsForBackup } = require('../../stores/encryptedChatStorage');
    const lockedProjects = await openProtectedProjectsForBackup().catch(() => []);
    const lockedChats = await openLockedChatsForBackup().catch(() => []);
    const recordings = useRecordings.getState().recordings;
    return {
      version: 1, sourceId: this.deviceId, projects: [...projects, ...lockedProjects],
      conversations: [...conversations, ...lockedChats], agents, files, deleted: this.deleted,
      stores: await localStores(), audio: await audioOnPhone(recordings.map(r => r.id)),
      // Credentials never leave this device without an explicit opt-in.
      ...(this.shareSecrets ? { secrets: await localSecrets() } : {}),
    };
  }
  /** After an exchange, send the other phone the recording audio it does not have yet. */
  private async sendAudio(peerId: string, remote: SyncSnapshot) {
    await sendMissingAudio(useRecordings.getState().recordings, remote.audio, async (chunk) => {
      const reply = await native().sync(peerId, JSON.stringify({ ...chunk, sourceId: this.deviceId }));
      if (reply.payload.startsWith('{"error":')) throw new Error(JSON.parse(reply.payload).error);
    }).catch(error => this.publish({ lastError: `Recording audio: ${String(error?.message ?? error)}` }));
  }
  private async apply(json: string, expectedPeerId: string): Promise<void> {
    const pending = this.mergeQueue.then(() => this.applyOne(json, expectedPeerId));
    this.mergeQueue = pending.catch(() => undefined);
    return pending;
  }
  private async applyOne(json: string, expectedPeerId: string): Promise<void> {
    const remote = validateSnapshot(JSON.parse(json));
    if (remote.sourceId !== expectedPeerId || remote.sourceId === this.deviceId)
      throw new Error('Wrong device identity in encrypted sync message');
    await this.hydrated();
    const incomingDeleted = validateTombstones(remote.deleted);
    const { isProtectedProjectOpen } = require('../../stores/protectedProjectStorage');
    const { isLockedChatOpen } = require('../../stores/encryptedChatStorage');
    const projectsBefore = useProjectStore.getState().projects;
    const incomingProjects = applyTombstones(remote.projects, incomingDeleted.projects);
    const provisionalProjects = mergeProjects(projectsBefore, incomingProjects);
    const allowed = new Set(provisionalProjects.items.filter(p => !p.pinVerifier && !p.protectedBlob)
      .map(p => p.id));
    const files = (remote.files ?? []).filter(file => allowed.has(file.projectId));
    if (files.length) await restoreProjectFiles(files, [...allowed], true);
    // Re-read local state after file IO; users may edit while an offline transfer runs.
    const combined = combineTombstones(this.deleted, incomingDeleted);
    const nextProjects = mergeProjects(
      applyTombstones(useProjectStore.getState().projects, combined.projects),
      applyTombstones(remote.projects, combined.projects), isProtectedProjectOpen);
    const projectIds = new Set(nextProjects.items.filter(p => !p.pinVerifier && !p.protectedBlob)
      .map(p => p.id));
    const nextChats = mergeConversations(
      applyTombstones(useChatStore.getState().conversations, combined.conversations),
      applyTombstones(remote.conversations.filter(c => !c.projectId || projectIds.has(c.projectId) || c.pinVerifier),
        combined.conversations), isLockedChatOpen);
    const nextAgents = mergeAgents(
      applyTombstones(useAgentStore.getState().agents, combined.agents),
      applyTombstones(remote.agents, combined.agents));
    this.applyingRemote = true;
    try {
      useProjectStore.setState({ projects: nextProjects.items });
      useChatStore.setState({ conversations: nextChats.items });
      useAgentStore.setState({ agents: nextAgents.items });
      this.deleted = combined;
    } finally { this.applyingRemote = false; }
    await AsyncStorage.setItem(DELETED_PREF, JSON.stringify(this.deleted));
    // Everything else: settings, the language course, study, maps, notes, recordings...
    this.applyingRemote = true;
    try { await applyStores(remote.stores, this.deleted.recordings); } finally { this.applyingRemote = false; }
    // API keys last, once the remote servers they belong to are here.
    if (this.shareSecrets) await applySecrets(remote.secrets);
    this.publish({ lastSync: new Date().toISOString(), lastError: this.fileNote });
  }
  private async incoming(message: Incoming) {
    let ownsBusy = false;
    try {
      if (!this.enabled || !this.active || this.isLocked()) throw new Error('Offline sync is paused while Atlas is locked');
      const audio = audioChunk(message.payload);
      if (audio) {
        if (audio.sourceId !== message.peerId) throw new Error('Wrong device identity in recording audio');
        await receiveAudio(audio);
        await native().respond(message.requestId, '{"ok":true}');
        return;
      }
      if (this.busy) throw new Error('Another synchronization is in progress');
      this.busy = true;
      ownsBusy = true;
      this.publish({ syncing: true });
      await this.apply(message.payload, message.peerId);
      await native().respond(message.requestId, JSON.stringify(await this.snapshot()));
      await this.refreshPeers();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.publish({ lastError: reason });
      await native().respond(message.requestId, JSON.stringify({ error: reason })).catch(() => undefined);
    } finally {
      // Only the request that set the flag clears it: a refused second request must not mark a running sync as finished.
      if (ownsBusy) { this.busy = false; this.publish({ syncing: false }); }
    }
  }
  async init() {
    if (!nearbyAvailable || this.appListener) return;
    this.appListener = AppState.addEventListener('change', state => {
      this.active = state === 'active';
      if (!this.active) { this.stopRuntime().catch(() => undefined); return; }
      if (this.enabled) this.run().catch(e => this.publish({ lastError: String(e) }));
    });
    await this.hydrated();
    const savedDeletions = await AsyncStorage.getItem(DELETED_PREF);
    this.deleted = savedDeletions ? validateTombstones(JSON.parse(savedDeletions)) : emptyTombstones();
    this.watchStores();
    this.enabled = await AsyncStorage.getItem(PREF) === 'true';
    this.shareSecrets = await AsyncStorage.getItem(SHARE_SECRETS_PREF) === 'true';
    this.publish({ enabled: this.enabled, shareSecrets: this.shareSecrets });
    if (this.enabled && this.active) await this.run();
  }
  private async run() {
    if (this.running || !this.active || !this.enabled) return;
    const info = await native().start();
    this.deviceId = info.deviceId;
    this.running = true;
    this.publish({ deviceId: info.deviceId });
    this.listener = new NativeEventEmitter(NativeModules.AtlasNearbySync)
      .addListener('AtlasNearbyMessage', (event: Incoming) => { this.incoming(event); });
    await this.refreshPeers();
    this.polling = setInterval(() => { this.syncAll().catch(() => undefined); }, 60000);
    this.syncAll().catch(() => undefined);
  }
  private async stopRuntime() {
    if (this.polling) { clearInterval(this.polling); this.polling = null; }
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; }
    this.listener?.remove(); this.listener = null;
    this.running = false;
    if (nearbyAvailable) await native().stop();
  }
  async setShareSecrets(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(SHARE_SECRETS_PREF, enabled ? 'true' : 'false');
    this.shareSecrets = enabled;
    this.publish({ shareSecrets: enabled });
    if (enabled) this.schedulePush();
  }
  async setEnabled(enabled: boolean) {
    if (!nearbyAvailable) throw new Error('Offline sync requires Android.');
    this.enabled = enabled;
    await AsyncStorage.setItem(PREF, enabled ? 'true' : 'false');
    this.publish({ enabled, lastError: undefined });
    if (enabled && this.active) await this.run();
    if (!enabled) await this.stopRuntime();
  }
  async refreshPeers(): Promise<Peer[]> {
    const peers = await native().peers();
    this.publish({ peers });
    return peers;
  }
  async createInvitation() {
    if (!this.enabled) await this.setEnabled(true);
    if (!this.running) await this.run();
    return native().invitation();
  }
  async joinInvitation(uri: string) {
    if (!this.enabled) await this.setEnabled(true);
    if (!this.running) await this.run();
    if (this.busy) throw new Error('A sync is already running');
    this.busy = true; this.publish({ syncing: true });
    try {
      const response = await native().pair(uri, JSON.stringify(await this.snapshot()));
      if (response.payload.startsWith('{"error":')) throw new Error(JSON.parse(response.payload).error);
      await this.apply(response.payload, response.peerId);
      await this.sendAudio(response.peerId, JSON.parse(response.payload));
      await this.refreshPeers();
    } finally { this.busy = false; this.publish({ syncing: false }); }
  }
  async syncPeer(peerId: string) {
    if (!this.enabled || !this.active || this.busy || this.isLocked()) return;
    this.busy = true; this.publish({ syncing: true });
    try {
      const response = await native().sync(peerId, JSON.stringify(await this.snapshot()));
      if (response.payload.startsWith('{"error":')) throw new Error(JSON.parse(response.payload).error);
      await this.apply(response.payload, response.peerId);
      await this.sendAudio(response.peerId, JSON.parse(response.payload));
    } catch (e) {
      this.publish({ lastError: String(e) });
      throw e;
    } finally { this.busy = false; this.publish({ syncing: false }); }
  }
  async syncAll() {
    if (!this.running || this.busy || !this.active || this.isLocked()) return;
    const peers = await this.refreshPeers();
    for (const peer of peers) {
      try { await this.syncPeer(peer.id); } catch { /* Retry when both devices reconnect. */ }
    }
  }
  async unpair(id: string) {
    await native().unpair(id);
    await this.refreshPeers();
  }
}
export const nearbySync = new NearbySyncService();

/** True when this build has the in-app QR scanner (Android). */
export const qrScanAvailable = Platform.OS === 'android' && Boolean(NativeModules.AtlasQrScanner);

/**
 * Opens the in-app camera to read the other phone's pairing code. Resolves the pairing link,
 * or null when the person closed the camera. Only Atlas pairing codes are accepted.
 */
export async function scanPairingCode(): Promise<string | null> {
  if (!qrScanAvailable) throw new Error('The QR scanner needs the updated Android build.');
  const { PermissionsAndroid } = require('react-native');
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    throw new Error('The camera is turned off for Atlas. Allow it in Android Settings > Apps > Atlas > Permissions, then scan again.');
  }
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Camera permission is needed to scan the code.');
  return NativeModules.AtlasQrScanner.scan('atlas://sync?', 'Point the camera at the QR code on the other device');
}
