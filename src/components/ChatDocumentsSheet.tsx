// "Documents in this chat": every document attached anywhere in the conversation, how far each
// has been read, and a switch to leave one out of the answers. Tapping a row opens its pages.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { StoredDocument } from '@offgrid/rag/documents';
import { AppSheet } from './AppSheet';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useDocumentProgressStore } from '../services/documents/progressStore';
import { documentStore, excludedDocuments, setDocumentExcluded } from '../services/documents/store';
import type { Conversation } from '../types';

export interface ChatDocument {
  documentId: string;
  name: string;
}

interface ChatDocumentsSheetProps {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  documents: ChatDocument[];
  onOpen: (document: ChatDocument) => void;
}

function pagesLabel(count: number): string {
  return `${count.toLocaleString()} page${count === 1 ? '' : 's'}`;
}

const PHASE_LABEL = { reading: 'Reading', ocr: 'Scanning', indexing: 'Indexing' } as const;

const ChatDocumentsSheet: React.FC<ChatDocumentsSheetProps> = ({
  visible,
  onClose,
  conversationId,
  documents,
  onOpen,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const progress = useDocumentProgressStore((state) => state.byId);
  const [stored, setStored] = useState<Record<string, StoredDocument | null>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    let current = true;
    setExcluded(excludedDocuments(conversationId));
    Promise.all(documents.map((d) => documentStore.getDocument(d.documentId)))
      .then((rows) => {
        if (current) setStored(Object.fromEntries(documents.map((d, i) => [d.documentId, rows[i] ?? null])));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [conversationId, documents, visible]);

  const status = (documentId: string): string => {
    const live = progress[documentId];
    if (live && live.phase !== 'ready') {
      if (live.phase === 'failed') return "Couldn't read";
      const percent = live.total ? Math.min(99, Math.round((live.done / live.total) * 100)) : 0;
      return `${PHASE_LABEL[live.phase]} ${percent}%`;
    }
    const row = stored[documentId];
    if (row?.state === 'failed') return "Couldn't read";
    const pages = live?.pageCount ?? row?.pageCount;
    return pages ? pagesLabel(pages) : 'Waiting';
  };

  const toggle = (documentId: string) => {
    const leaveOut = !excluded.has(documentId);
    setDocumentExcluded(conversationId, documentId, leaveOut);
    setExcluded(excludedDocuments(conversationId));
  };

  return (
    <AppSheet visible={visible} onClose={onClose} snapPoints={['45%']} title="Documents in this chat">
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {documents.map((document) => {
          const out = excluded.has(document.documentId);
          return (
            <View key={document.documentId} style={styles.row} testID={`chat-document-${document.documentId}`}>
              <TouchableOpacity
                style={styles.rowMain}
                onPress={() => onOpen(document)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${document.name}`}
              >
                <Icon name="file-text" size={16} color={out ? colors.textMuted : colors.primary} />
                <Text style={[styles.name, out && styles.nameOut]} numberOfLines={1}>
                  {document.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {out ? 'Left out' : status(document.documentId)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.toggle}
                onPress={() => toggle(document.documentId)}
                accessibilityRole="switch"
                accessibilityState={{ checked: !out }}
                accessibilityLabel={out ? `Use ${document.name} in answers` : `Leave ${document.name} out of answers`}
                testID={`chat-document-toggle-${document.documentId}`}
              >
                <Icon name={out ? 'eye-off' : 'eye'} size={16} color={out ? colors.textMuted : colors.textSecondary} />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
  },
  name: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    flexShrink: 1,
  },
  nameOut: {
    color: colors.textMuted,
  },
  meta: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    marginLeft: 'auto' as const,
  },
  toggle: {
    padding: SPACING.sm,
    marginLeft: SPACING.xs,
  },
});

/** What opening a document needs from the navigator (a component does not import the app's routes). */
type RootNavigation = {
  navigate: (
    screen: 'DocumentPreview',
    params: { filePath: string; fileName: string; fileSize: number; documentId?: string; page?: number },
  ) => void;
};

/** Open a document's stored pages, at `page` when given (a tapped citation). */
export function openDocumentPage(
  navigation: RootNavigation,
  document: { documentId: string; name: string; page?: number },
): void {
  navigation.navigate('DocumentPreview', {
    filePath: '',
    fileName: document.name,
    fileSize: 0,
    documentId: document.documentId,
    ...(document.page ? { page: document.page } : {}),
  });
}

/** The chat's Documents button and sheet: every document attached anywhere in the conversation. */
export function useChatDocumentsSheet(conversation: Conversation | null | undefined, navigation: RootNavigation) {
  const [visible, setVisible] = useState(false);
  const messages = conversation?.messages;
  const documents = useMemo(() => {
    const byId = new Map<string, ChatDocument>();
    for (const message of messages ?? []) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.type === 'document' && attachment.documentId && !byId.has(attachment.documentId))
          byId.set(attachment.documentId, { documentId: attachment.documentId, name: attachment.fileName ?? 'Document' });
      }
    }
    return [...byId.values()];
  }, [messages]);
  const sheet = conversation ? (
    <ChatDocumentsSheet
      visible={visible}
      onClose={() => setVisible(false)}
      conversationId={conversation.id}
      documents={documents}
      onOpen={(document) => {
        setVisible(false);
        openDocumentPage(navigation, document);
      }}
    />
  ) : null;
  return { count: documents.length, open: () => setVisible(true), sheet };
}
