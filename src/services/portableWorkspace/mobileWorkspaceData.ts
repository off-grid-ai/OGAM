import type {
  AtomicImportContext,
  CollisionPolicy,
  DocumentRecord,
  FileRef,
  JsonValue,
  MediaKind,
  WorkspaceDataPort,
  WorkspaceExport,
  WorkspaceSelection,
  WorkspaceSnapshot,
} from '@offgrid/sync/portable';
import { WORKSPACE_SCHEMA_VERSION } from '@offgrid/sync/portable';
import type { Conversation, MediaAttachment, Message, Project } from '../../types';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { ragDatabase } from '../rag/database';
import { ragService } from '../rag';
import { chunkDocument } from '../rag/chunking';
import { embeddingService } from '../rag/embedding';
import { documentService } from '../documentService';
import type { WorkspaceFilePort } from './types';
import {
  clearImportJournal,
  persistWorkspaceStores,
  recoverWorkspaceImport,
  writeImportJournal,
} from './importJournal';

export interface WorkspaceImportSummary {
  projects: number;
  conversations: number;
  messages: number;
  documents: number;
  attachments: number;
}

const archiveExtension = (path: string): string => {
  const match = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(path);
  return match ? `.${match[1]}` : '';
};

const mediaKind = (attachment: MediaAttachment): MediaKind => {
  if (attachment.type === 'image') return 'image';
  if (attachment.type === 'audio') return 'audio';
  const name = attachment.fileName?.toLowerCase() ?? '';
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  return attachment.textContent ? 'text' : 'other';
};

const documentKind = (name: string): MediaKind => {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  return 'text';
};

const jsonMetadata = (message: Message): { [key: string]: JsonValue } | undefined => {
  const candidate = {
    generationTimeMs: message.generationTimeMs,
    generationMeta: message.generationMeta,
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls,
    toolName: message.toolName,
    isAudioModeMessage: message.isAudioModeMessage,
    waveformData: message.waveformData,
    audioDurationSeconds: message.audioDurationSeconds,
  };
  const value = JSON.parse(JSON.stringify(candidate)) as { [key: string]: JsonValue };
  return Object.keys(value).length > 0 ? value : undefined;
};

const metadataValue = <T>(metadata: { [key: string]: JsonValue } | undefined, key: string): T | undefined =>
  metadata?.[key] as T | undefined;

const safeFileName = (value: string): string => encodeURIComponent(value).replaceAll('%', '_');

const selectContent = (
  selection: WorkspaceSelection,
  allProjects: Project[],
  allConversations: Conversation[],
): { projects: Project[]; conversations: Conversation[] } | null => {
  if (selection.kind === 'project') {
    const projects = allProjects.filter(project => project.id === selection.id);
    return projects.length === 0 ? null : {
      projects,
      conversations: allConversations.filter(conversation => conversation.projectId === selection.id),
    };
  }
  if (selection.kind === 'conversation') {
    const conversations = allConversations.filter(conversation => conversation.id === selection.id);
    if (conversations.length === 0) return null;
    const projectId = conversations[0].projectId;
    return { projects: projectId ? allProjects.filter(project => project.id === projectId) : [], conversations };
  }
  return { projects: allProjects, conversations: allConversations };
};

export class MobileWorkspaceData implements WorkspaceDataPort<WorkspaceImportSummary> {
  constructor(private readonly files: WorkspaceFilePort) {}

  async collect(selection: WorkspaceSelection): Promise<WorkspaceExport | null> {
    const allProjects = useProjectStore.getState().projects;
    const allConversations = useChatStore.getState().conversations;
    const selected = selectContent(selection, allProjects, allConversations);
    if (!selected) return null;
    const { projects, conversations } = selected;

    const refs: FileRef[] = [];
    const messages = conversations.flatMap(conversation =>
      conversation.messages.map(message => ({
        id: message.id,
        conversationId: conversation.id,
        role: message.role,
        content: message.content,
        reasoningContent: message.reasoningContent,
        createdAt: new Date(message.timestamp).toISOString(),
        metadata: jsonMetadata(message),
      })),
    );

    const attachments = [] as WorkspaceSnapshot['attachments'];
    for (const conversation of conversations) {
      for (const message of conversation.messages) {
        for (const attachment of message.attachments ?? []) {
          const key = attachment.uri
            ? `files/attachments/${safeFileName(message.id)}/${safeFileName(attachment.id)}${archiveExtension(attachment.uri)}`
            : undefined;
          const archiveKey = key && (await this.files.exists(attachment.uri)) ? key : undefined;
          if (archiveKey) refs.push({ key: archiveKey, sourcePath: attachment.uri });
          attachments.push({
            id: attachment.id,
            messageId: message.id,
            name: attachment.fileName,
            kind: mediaKind(attachment),
            mimeType: attachment.mimeType,
            size: attachment.fileSize,
            width: attachment.width,
            height: attachment.height,
            durationSeconds: attachment.audioDurationSeconds,
            archiveKey,
            textContent: attachment.textContent,
          });
        }
      }
    }

    const documents: DocumentRecord[] = [];
    if (selection.kind !== 'conversation') {
      for (const project of projects) {
        const stored = await ragService.getDocumentsByProject(project.id);
        for (const document of stored) {
          const chunks = ragDatabase.getChunksByDocument(document.id);
          const textContent = chunks.sort((a, b) => a.position - b.position).map(chunk => chunk.content).join('\n\n');
          const key = document.path && (await this.files.exists(document.path))
            ? `files/documents/${safeFileName(project.id)}/${safeFileName(String(document.id))}${archiveExtension(document.path)}`
            : undefined;
          if (key) refs.push({ key, sourcePath: document.path });
          documents.push({
            id: document.portable_id ?? `mobile-rag:${project.id}:${document.id}`,
            projectId: project.id,
            name: document.name,
            kind: documentKind(document.name),
            size: document.size,
            createdAt: document.created_at,
            enabled: document.enabled === 1,
            archiveKey: key,
            textContent: textContent || undefined,
          });
        }
      }
    }

    return {
      snapshot: {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        selection,
        workspaces: [],
        projects: projects.map(project => ({
          id: project.id,
          name: project.name,
          description: project.description,
          systemPrompt: project.systemPrompt,
          icon: project.icon,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })),
        conversations: conversations.map(conversation => ({
          id: conversation.id,
          projectId: conversation.projectId,
          title: conversation.title,
          modelId: conversation.modelId,
          compactionSummary: conversation.compactionSummary,
          compactionCutoffMessageId: conversation.compactionCutoffMessageId,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        })),
        messages,
        documents,
        attachments,
      },
      files: refs,
    };
  }

  async applyAtomically(
    snapshot: WorkspaceSnapshot,
    context: AtomicImportContext,
  ): Promise<WorkspaceImportSummary> {
    this.assertKeepExisting(context.collisionPolicy);
    await recoverWorkspaceImport(this.files);
    await ragService.ensureReady();
    const oldProjects = useProjectStore.getState().projects;
    const oldConversations = useChatStore.getState().conversations;
    const existingProjectIds = new Set(oldProjects.map(project => project.id));
    const addedProjects = snapshot.projects.filter(project => !existingProjectIds.has(project.id));
    const resultingProjectIds = new Set([...existingProjectIds, ...addedProjects.map(project => project.id)]);
    const existingConversationIds = new Set(oldConversations.map(conversation => conversation.id));
    const addedConversationRecords = snapshot.conversations.filter(
      conversation => !existingConversationIds.has(conversation.id) &&
        (!conversation.projectId || resultingProjectIds.has(conversation.projectId)),
    );
    const addedConversationIds = new Set(addedConversationRecords.map(conversation => conversation.id));
    const resultingConversationIds = new Set([...existingConversationIds, ...addedConversationIds]);
    const existingMessageIds = new Set(oldConversations.flatMap(conversation => conversation.messages.map(message => message.id)));
    const messages = snapshot.messages.filter(message =>
      resultingConversationIds.has(message.conversationId) && !existingMessageIds.has(message.id),
    );
    const resultingMessageIds = new Set([...existingMessageIds, ...messages.map(message => message.id)]);
    const existingAttachmentIds = new Set(oldConversations.flatMap(conversation =>
      conversation.messages.flatMap(message => (message.attachments ?? []).map(attachment => attachment.id))));
    const attachments = snapshot.attachments.filter(attachment =>
      resultingMessageIds.has(attachment.messageId) && !existingAttachmentIds.has(attachment.id));

    const existingDocumentIds = new Set<string>();
    for (const projectId of resultingProjectIds) {
      const documents = await ragService.getDocumentsByProject(projectId);
      documents.forEach(document => {
        if (document.portable_id) existingDocumentIds.add(document.portable_id);
        else existingDocumentIds.add(`mobile-rag:${projectId}:${document.id}`);
      });
    }
    const documents = snapshot.documents.filter(document =>
      resultingProjectIds.has(document.projectId) &&
      !existingDocumentIds.has(document.id),
    );
    const acceptedArchiveKeys = new Set([
      ...documents.flatMap(document => document.archiveKey ? [document.archiveKey] : []),
      ...attachments.flatMap(attachment => attachment.archiveKey ? [attachment.archiveKey] : []),
    ]);
    const stagedByKey = new Map(context.files.map(file => [file.key, file]));
    const journalPaths = [
      ...acceptedArchiveKeys].map(key => stagedByKey.get(key)?.destinationPath).filter((path): path is string => Boolean(path));
    journalPaths.push(...documents.filter(document => !document.archiveKey).map(document => this.files.textDestination(document.id)));
    await writeImportJournal({
      version: 1,
      projectIds: addedProjects.map(project => project.id),
      conversationIds: addedConversationRecords.map(conversation => conversation.id),
      messageIds: messages.map(message => message.id),
      attachmentIds: attachments.map(attachment => attachment.id),
      documentIds: documents.map(document => document.id),
      paths: journalPaths,
    });
    let copiedPaths: string[] = [];
    let transactionOpen = false;
    let databaseCommitted = false;
    try {
      const preparedChunks = await this.prepareDocuments(documents, stagedByKey);
      const copied = await this.copyImportFiles(acceptedArchiveKeys, stagedByKey, documents);
      copiedPaths = copied.paths;
      ragDatabase.beginPortableImport();
      transactionOpen = true;
      for (const document of documents) {
        const path = document.archiveKey
          ? stagedByKey.get(document.archiveKey)?.destinationPath ?? ''
          : copied.textDocumentPaths.get(document.id) ?? '';
        ragDatabase.insertPortableDocument({
          portableId: document.id,
          projectId: document.projectId,
          name: document.name,
          path,
          size: document.size,
          createdAt: document.createdAt,
          enabled: document.enabled,
          chunks: preparedChunks.get(document.id) ?? [],
        });
      }
      const messagesByConversation = new Map<string, Message[]>();
      for (const record of messages) {
        const messageAttachments = attachments.filter(attachment => attachment.messageId === record.id);
        const mapped: Message = {
          id: record.id,
          role: record.role,
          content: record.content,
          reasoningContent: record.reasoningContent,
          timestamp: Date.parse(record.createdAt),
          generationTimeMs: metadataValue(record.metadata, 'generationTimeMs'),
          generationMeta: metadataValue(record.metadata, 'generationMeta'),
          toolCallId: metadataValue(record.metadata, 'toolCallId'),
          toolCalls: metadataValue(record.metadata, 'toolCalls'),
          toolName: metadataValue(record.metadata, 'toolName'),
          isAudioModeMessage: metadataValue(record.metadata, 'isAudioModeMessage'),
          waveformData: metadataValue(record.metadata, 'waveformData'),
          audioDurationSeconds: metadataValue(record.metadata, 'audioDurationSeconds'),
          attachments: messageAttachments.map(attachment => this.toMediaAttachment(attachment, stagedByKey)),
        };
        messagesByConversation.set(record.conversationId, [...(messagesByConversation.get(record.conversationId) ?? []), mapped]);
      }
      const importedConversations: Conversation[] = addedConversationRecords.map(record => ({
        id: record.id,
        title: record.title ?? 'Imported Conversation',
        modelId: record.modelId ?? '',
        messages: messagesByConversation.get(record.id) ?? [],
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        projectId: record.projectId,
        compactionSummary: record.compactionSummary,
        compactionCutoffMessageId: record.compactionCutoffMessageId,
      }));
      const updatedExistingConversations = oldConversations.map(conversation => {
        const importedMessages = messagesByConversation.get(conversation.id) ?? [];
        const existingMessages = conversation.messages.map(message => {
          const importedAttachments = attachments
            .filter(attachment => attachment.messageId === message.id)
            .map(attachment => this.toMediaAttachment(attachment, stagedByKey));
          return importedAttachments.length === 0
            ? message
            : { ...message, attachments: [...(message.attachments ?? []), ...importedAttachments] };
        });
        return importedMessages.length === 0 && existingMessages.every((message, index) => message === conversation.messages[index])
          ? conversation
          : { ...conversation, messages: [...existingMessages, ...importedMessages] };
      });
      useProjectStore.setState({ projects: [...oldProjects, ...addedProjects] });
      useChatStore.setState({ conversations: [...updatedExistingConversations, ...importedConversations] });
      ragDatabase.commitPortableImport();
      transactionOpen = false;
      databaseCommitted = true;
      await persistWorkspaceStores();
      await clearImportJournal();
      return {
        projects: addedProjects.length,
        conversations: importedConversations.length,
        messages: messages.length,
        documents: documents.length,
        attachments: attachments.length,
      };
    } catch (error) {
      const rollbackFailures: unknown[] = [];
      useProjectStore.setState({ projects: oldProjects });
      useChatStore.setState({ conversations: oldConversations });
      if (transactionOpen) {
        try { ragDatabase.rollbackPortableImport(); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
      } else if (databaseCommitted && documents.length > 0) {
        try {
          ragDatabase.beginPortableImport();
          ragDatabase.deletePortableDocuments(documents.map(document => document.id));
          ragDatabase.commitPortableImport();
        } catch (rollbackError) {
          try { ragDatabase.rollbackPortableImport(); } catch (nestedError) { rollbackFailures.push(nestedError); }
          rollbackFailures.push(rollbackError);
        }
      }
      const cleanup = await Promise.allSettled(copiedPaths.map(path => this.files.remove(path)));
      cleanup.forEach(result => { if (result.status === 'rejected') rollbackFailures.push(result.reason); });
      try { await persistWorkspaceStores(); } catch (persistError) { rollbackFailures.push(persistError); }
      if (rollbackFailures.length === 0) await clearImportJournal();
      if (rollbackFailures.length > 0) throw new AggregateError([error, ...rollbackFailures], 'Workspace import and rollback failed');
      throw error;
    }
  }

  private assertKeepExisting(policy: CollisionPolicy): void {
    if (policy !== 'keep-existing') throw new Error(`Unsupported collision policy: ${policy}`);
  }

  private async prepareDocuments(
    documents: DocumentRecord[],
    staged: Map<string, AtomicImportContext['files'][number]>,
  ): Promise<Map<string, Array<{ content: string; position: number; embedding: number[] }>>> {
    const prepared = new Map<string, Array<{ content: string; position: number; embedding: number[] }>>();
    if (documents.length === 0) return prepared;
    await embeddingService.load();
    for (const document of documents) {
      const stagedPath = document.archiveKey ? staged.get(document.archiveKey)?.stagedPath : undefined;
      const text = document.textContent ?? (stagedPath
        ? await documentService.readPortableTextFromPath(stagedPath, document.name)
        : '');
      const chunks = chunkDocument(text);
      if (chunks.length === 0) throw new Error(`Portable document ${document.id} has no indexable content`);
      const embeddings = await embeddingService.embedBatch(chunks.map(chunk => chunk.content));
      prepared.set(document.id, chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] })));
    }
    return prepared;
  }

  private async copyImportFiles(
    archiveKeys: Set<string>,
    staged: Map<string, AtomicImportContext['files'][number]>,
    documents: DocumentRecord[],
  ): Promise<{ paths: string[]; textDocumentPaths: Map<string, string> }> {
    const paths: string[] = [];
    const textDocumentPaths = new Map<string, string>();
    for (const key of archiveKeys) {
      const file = staged.get(key);
      if (!file) throw new Error(`Missing staged workspace file: ${key}`);
      await this.files.copy(file.stagedPath, file.destinationPath);
      paths.push(file.destinationPath);
    }
    for (const document of documents.filter(item => !item.archiveKey)) {
      const path = this.files.textDestination(document.id);
      await this.files.materializeText(path, document.textContent ?? '');
      textDocumentPaths.set(document.id, path);
      paths.push(path);
    }
    return { paths, textDocumentPaths };
  }

  private toMediaAttachment(
    attachment: WorkspaceSnapshot['attachments'][number],
    files: Map<string, AtomicImportContext['files'][number]>,
  ): MediaAttachment {
    const type = attachment.kind === 'image' ? 'image' : attachment.kind === 'audio' ? 'audio' : 'document';
    return {
      id: attachment.id,
      type,
      uri: attachment.archiveKey ? files.get(attachment.archiveKey)?.destinationPath ?? '' : '',
      mimeType: attachment.mimeType,
      width: attachment.width,
      height: attachment.height,
      fileName: attachment.name,
      textContent: attachment.textContent,
      fileSize: attachment.size,
      audioDurationSeconds: attachment.durationSeconds,
    };
  }
}
