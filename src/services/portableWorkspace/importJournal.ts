import AsyncStorage from '@react-native-async-storage/async-storage';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { ragDatabase } from '../rag/database';
import { ragService } from '../rag';
import type { WorkspaceFilePort } from './types';

const JOURNAL_KEY = 'portable-workspace-import-journal-v1';
let recoveryReady = false;

export interface WorkspaceImportJournal {
  version: 1;
  projectIds: string[];
  conversationIds: string[];
  messageIds: string[];
  attachmentIds: string[];
  documentIds: string[];
  paths: string[];
}

const stringArray = (value: unknown, label: string, maxLength: number): string[] => {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error(`Invalid workspace journal ${label}`);
  const strings = value.map(item => {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxLength) throw new Error(`Invalid workspace journal ${label}`);
    return item;
  });
  if (new Set(strings).size !== strings.length) throw new Error(`Duplicate workspace journal ${label}`);
  return strings;
};

const parseJournal = (raw: string, files: WorkspaceFilePort): WorkspaceImportJournal => {
  if (raw.length > 256 * 1024) throw new Error('Workspace recovery journal is too large');
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
    throw new Error('Invalid workspace recovery journal');
  }
  const paths = stringArray(value.paths, 'paths', 2048);
  if (paths.length > 2_000 || paths.some(path => !files.isOwnedImportPath(path))) {
    throw new Error('Workspace recovery journal contains an unowned path');
  }
  return {
    version: 1,
    projectIds: stringArray(value.projectIds, 'projectIds', 512),
    conversationIds: stringArray(value.conversationIds, 'conversationIds', 512),
    messageIds: stringArray(value.messageIds, 'messageIds', 512),
    attachmentIds: stringArray(value.attachmentIds, 'attachmentIds', 512),
    documentIds: stringArray(value.documentIds, 'documentIds', 512),
    paths,
  };
};

const persistStores = async (): Promise<void> => {
  const chats = useChatStore.getState();
  await Promise.all([
    AsyncStorage.setItem('local-llm-project-storage', JSON.stringify({ state: { projects: useProjectStore.getState().projects }, version: 0 })),
    AsyncStorage.setItem('local-llm-chat-storage', JSON.stringify({
      state: { conversations: chats.conversations, activeConversationId: chats.activeConversationId }, version: 0,
    })),
  ]);
};

export const writeImportJournal = (journal: WorkspaceImportJournal): Promise<void> =>
  AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));

export const clearImportJournal = (): Promise<void> => AsyncStorage.removeItem(JOURNAL_KEY);

/** Roll back a crash-interrupted additive import before new workspace work begins. */
export async function recoverWorkspaceImport(files: WorkspaceFilePort): Promise<void> {
  const raw = await AsyncStorage.getItem(JOURNAL_KEY);
  if (!raw) { recoveryReady = true; return; }
  const journal = parseJournal(raw, files);
  await ragService.ensureReady();
  useProjectStore.setState(state => ({ projects: state.projects.filter(project => !journal.projectIds.includes(project.id)) }));
  useChatStore.setState(state => ({
    conversations: state.conversations
      .filter(conversation => !journal.conversationIds.includes(conversation.id))
      .map(conversation => ({
        ...conversation,
        messages: conversation.messages
          .filter(message => !journal.messageIds.includes(message.id))
          .map(message => ({
            ...message,
            attachments: message.attachments?.filter(attachment => !journal.attachmentIds.includes(attachment.id)),
          })),
      })),
  }));
  ragDatabase.beginPortableImport();
  try {
    ragDatabase.deletePortableDocuments(journal.documentIds);
    ragDatabase.commitPortableImport();
  } catch (error) {
    try { ragDatabase.rollbackPortableImport(); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Workspace database recovery failed');
    }
    throw error;
  }
  const cleanup = await Promise.allSettled(journal.paths.map(path => files.remove(path)));
  const failures = cleanup.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason);
  if (failures.length > 0) throw new AggregateError(failures, 'Workspace file recovery failed');
  await persistStores();
  await clearImportJournal();
  recoveryReady = true;
}

export async function initializeWorkspaceRecovery(files: WorkspaceFilePort): Promise<boolean> {
  recoveryReady = false;
  try {
    await recoverWorkspaceImport(files);
    return true;
  } catch {
    // Fail closed. Startup continues, but the transfer port stays unavailable
    // until a clean restart/recovery instead of mutating through corrupt state.
    return false;
  }
}

export const isWorkspaceRecoveryReady = (): boolean => recoveryReady;

export { persistStores as persistWorkspaceStores };
