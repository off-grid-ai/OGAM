import React from 'react';
import { StyleSheet, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSwitch } from '../AppSwitch';
import { TouchableOpacity } from '../Touchable';
import { useTheme } from '../../theme';
import { SPACING } from '../../constants';
import type { KnowledgeDocument } from '../../services/rag';
import type { KnowledgeDocumentTransfer } from '../../services/sync/knowledgeDocumentTransfer';
import { KnowledgeDocumentInfo } from './KnowledgeDocumentInfo';

type Props = {
  doc: KnowledgeDocument;
  transfer?: KnowledgeDocumentTransfer;
  onOpen: (doc: KnowledgeDocument & { document_id: string }) => void;
  onToggle: (doc: KnowledgeDocument, enabled: boolean) => void;
  onRemove: (doc: KnowledgeDocument) => void;
  /** Keeps each screen's existing test ids ("knowledge-document" or "kb-document"). */
  /** @deprecated The ids are fixed (`knowledge-document-*`) so analytics can name them; kept for old callers. */
  testIDPrefix?: string;
};

/**
 * One knowledge-base document, the same on the Knowledge base screen and a project's tab.
 *
 * Open, use-in-answers and remove are three actions, so they are three sibling controls. A row that
 * wrapped the switch in its own touchable merged everything into one element, and a screen reader
 * could neither read nor flip the switch (hand test 49 found the project tab still did that).
 */
export const KnowledgeDocumentRow: React.FC<Props> = ({ doc, transfer, onOpen, onToggle, onRemove }) => {
  const { colors } = useTheme();
  const documentId = doc.document_id;
  return (
    <View style={[styles.row, { borderBottomColor: colors.borderLight }]}>
      <TouchableOpacity
        style={styles.info}
        onPress={() => {
          if (documentId) onOpen({ ...doc, document_id: documentId });
        }}
        disabled={!documentId}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`File ${doc.name}`}
        testID={`knowledge-document-row-${doc.sync_id}`}
      >
        <KnowledgeDocumentInfo name={doc.name} size={doc.size} documentId={documentId} transfer={transfer} />
      </TouchableOpacity>
      <AppSwitch
        value={doc.enabled === 1}
        onValueChange={enabled => onToggle(doc, enabled)}
        // A switch reads its own on/off; the label says what it does.
        accessibilityRole="switch"
        accessibilityLabel={`Use in answers: ${doc.name}`}
        testID={`knowledge-document-toggle-${doc.sync_id}`}
      />
      <TouchableOpacity
        style={styles.remove}
        onPress={() => onRemove(doc)}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${doc.name}`}
        testID={`knowledge-document-remove-${doc.sync_id}`}
      >
        <Icon name="trash-2" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  info: { flex: 1, marginRight: SPACING.sm, minHeight: 44, justifyContent: 'center' },
  remove: { width: 44, height: 44, marginLeft: SPACING.xs, alignItems: 'center', justifyContent: 'center' },
});
