import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  FlatList,
  Platform,
} from 'react-native';
import { LIST_CLIPPING_PROPS } from '../constants/listClipping';
import { LoadingDots } from '../components/LoadingDots';
import Icon from 'react-native-vector-icons/Feather';
import {
  pick,
  isErrorWithCode,
  errorCodes,
} from '@react-native-documents/picker';

import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';
import { Button } from '../components/Button';
import { showAlert, AlertState } from '../components/CustomAlert';
import { PasteNoteSheet } from '../components/knowledge/PasteNoteSheet';
import {
  KnowledgeDocumentInfo,
  KnowledgeTransferInfo,
} from '../components/knowledge/KnowledgeDocumentInfo';
import { useKnowledgeDocumentTransfers } from '../hooks/useKnowledgeDocumentTransfers';
import {
  arrivingKnowledgeDocumentTransfers,
  knowledgeDocumentTransferKey,
  rowKnowledgeDocumentTransfer,
} from '../services/sync/knowledgeDocumentTransfer';
import { knowledgeBase } from '../services/rag';
import type { KnowledgeDocument } from '../services/rag';
import { isPickerStuck } from '../utils/pickerErrorUtils';

export interface KBSectionProps {
  projectId: string;
  colors: any;
  styles: any;
  setAlertState: (state: AlertState) => void;
  onNavigateToKb: () => void;
  /** Opens the file's pages; only called for a file the document index knows. */
  onDocumentPress: (doc: KnowledgeDocument & { document_id: string }) => void;
}

export const KnowledgeBaseSection: React.FC<KBSectionProps> = ({
  projectId,
  colors,
  styles,
  setAlertState,
  onNavigateToKb,
  onDocumentPress,
}) => {
  const [kbDocs, setKbDocs] = useState<KnowledgeDocument[]>([]);
  const [addingFile, setAddingFile] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [pasting, setPasting] = useState(false);
  const isPickingRef = useRef(false);

  const loadKbDocs = useCallback(async () => {
    try {
      setKbDocs(await knowledgeBase.getDocumentsByProject(projectId));
    } catch (err: any) {
      setAlertState(
        showAlert('Error', err?.message || 'Failed to load documents'),
      );
    }
  }, [projectId, setAlertState]);

  useEffect(() => {
    loadKbDocs();
  }, [loadKbDocs]);

  // Files moving to or from paired devices. A received file reloads the list so its own row shows.
  const { transfers, dismiss: dismissTransfer } = useKnowledgeDocumentTransfers(
    projectId,
    loadKbDocs,
  );
  const arriving = arrivingKnowledgeDocumentTransfers(
    transfers,
    new Set(kbDocs.map(doc => doc.sync_id)),
  );

  const handleAddDocument = async () => {
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    setIsPicking(true);
    try {
      // iOS: 'import' → Apple copies the file before handing it to us, original untouched.
      // Android: 'open' → returns a content:// URI; keepLocalCopy() copies it to a real path.
      const files =
        Platform.OS === 'android'
          ? await pick({ mode: 'open', allowMultiSelection: true })
          : await pick({ mode: 'import', allowMultiSelection: true });
      if (!files?.length) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name || 'document';
        setAddingFile(
          files.length > 1
            ? `${fileName} (${i + 1}/${files.length})`
            : fileName,
        );

        const pathForDb = await resolvePickedFileUri(file.uri, fileName);

        // Adding keeps the file and starts reading it in the background; its row shows the progress.
        await knowledgeBase.addFile({
          projectId,
          filePath: pathForDb,
          fileName,
          fileSize: file.size || 0,
        });
        await loadKbDocs();
      }
    } catch (err: any) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED)
        return;
      if (isPickerStuck(err)) {
        setAlertState(
          showAlert(
            'File Picker Unavailable',
            "The file picker isn't responding. Please close and reopen the app, then try again.",
          ),
        );
        return;
      }
      setAlertState(
        showAlert('Error', err.message || 'Failed to add document'),
      );
    } finally {
      isPickingRef.current = false;
      setIsPicking(false);
      setAddingFile(null);
    }
  };

  const handleSavePastedNote = async (
    title: string,
    text: string,
  ): Promise<void> => {
    setAddingFile(title.trim() || 'pasted text');
    try {
      await knowledgeBase.addPastedText({ projectId, title, text });
      await loadKbDocs();
    } finally {
      setAddingFile(null);
    }
  };

  const handleToggleDocument = async (docId: number, enabled: boolean) => {
    try {
      await knowledgeBase.toggleDocument(docId, enabled);
      await loadKbDocs();
    } catch (err: any) {
      setAlertState(
        showAlert('Error', err?.message || 'Failed to update document'),
      );
    }
  };

  const handleDeleteDocument = (doc: KnowledgeDocument) => {
    setAlertState(
      showAlert(
        'Remove Document',
        `Remove "${doc.name}" from the knowledge base?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              knowledgeBase
                .deleteDocument(doc.id)
                .then(() => loadKbDocs())
                .catch((err: any) =>
                  setAlertState(
                    showAlert(
                      'Error',
                      err?.message || 'Failed to remove document',
                    ),
                  ),
                );
            },
          },
        ],
      ),
    );
  };

  return (
    <View style={styles.sectionContent} testID="project-knowledge-base-section">
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={onNavigateToKb}
        activeOpacity={0.7}
        testID="project-knowledge-base-open"
      >
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Knowledge Base</Text>
          {kbDocs.length > 0 && (
            <Text
              style={styles.sectionCount}
              accessibilityLabel={`Knowledge Base has ${kbDocs.length} documents`}
              testID="project-knowledge-base-count"
            >
              {kbDocs.length}
            </Text>
          )}
        </View>
        <View style={styles.sectionActions}>
          {/* Text you paste and files you import are the same kind of thing once saved, so they sit
              side by side here rather than one being buried behind the other. */}
          <Button
            title="Text"
            variant="outline"
            size="small"
            onPress={() => setPasting(true)}
            testID="kb-paste-text"
            disabled={isPicking || !!addingFile}
            icon={<Icon name="type" size={16} color={colors.textSecondary} />}
          />
          <Button
            title="Add"
            variant="primary"
            size="small"
            onPress={handleAddDocument}
            testID="kb-add-document"
            disabled={isPicking || !!addingFile}
            icon={<Icon name="plus" size={16} color={colors.primary} />}
          />
          <Icon
            name="chevron-right"
            size={16}
            color={colors.textMuted}
            style={styles.navIcon}
          />
        </View>
      </TouchableOpacity>

      {addingFile && (
        <View style={styles.kbIndexing}>
          <LoadingDots color={colors.primary} />
          <Text style={styles.kbIndexingText} numberOfLines={1}>
            Adding {addingFile}...
          </Text>
        </View>
      )}

      {arriving.map(transfer => (
        <View
          key={knowledgeDocumentTransferKey(transfer)}
          style={styles.kbDocRow}
          testID={`kb-document-arriving-${transfer.syncId}`}
        >
          <Icon
            name={transfer.status === 'failed' ? 'alert-circle' : 'download'}
            size={14}
            color={transfer.status === 'failed' ? colors.error : colors.textMuted}
            style={styles.kbTransferIcon}
          />
          <View style={styles.kbDocInfo}>
            <KnowledgeTransferInfo transfer={transfer} />
          </View>
          {transfer.status === 'failed' && (
            <TouchableOpacity
              style={styles.kbDocDelete}
              onPress={() => dismissTransfer(transfer)}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss ${transfer.fileName}`}
            >
              <Icon name="x" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      ))}

      {kbDocs.length === 0 && !addingFile ? (
        arriving.length > 0 ? null : (
          <View style={styles.emptyState}>
            <Icon name="file-text" size={24} color={colors.textMuted} />
            <Text style={styles.emptyStateText}>No documents added</Text>
          </View>
        )
      ) : (
        <FlatList
          style={styles.sectionList}
          data={kbDocs}
          keyExtractor={doc => String(doc.id)}
          {...LIST_CLIPPING_PROPS}
          renderItem={({ item: doc }) => (
            <TouchableOpacity
              style={styles.kbDocRow}
              onPress={() => {
                const documentId = doc.document_id;
                if (documentId) onDocumentPress({ ...doc, document_id: documentId });
              }}
              disabled={!doc.document_id}
              activeOpacity={0.7}
              accessibilityLabel={`Knowledge document ${doc.name}`}
              testID={`kb-document-row-${doc.sync_id}`}
            >
              <View style={styles.kbDocInfo}>
                <KnowledgeDocumentInfo
                  name={doc.name}
                  size={doc.size}
                  documentId={doc.document_id}
                  transfer={rowKnowledgeDocumentTransfer(transfers, doc.sync_id)}
                />
              </View>
              <Switch
                value={doc.enabled === 1}
                onValueChange={val => handleToggleDocument(doc.id, val)}
                testID={`kb-document-toggle-${doc.sync_id}`}
                accessibilityLabel={`Use ${doc.name}, ${doc.enabled === 1 ? 'ON' : 'OFF'}`}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
              <TouchableOpacity
                style={styles.kbDocDelete}
                onPress={() => handleDeleteDocument(doc)}
                testID={`kb-document-remove-${doc.sync_id}`}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${doc.name}`}
              >
                <Icon name="trash-2" size={14} color={colors.error} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}

      <PasteNoteSheet
        visible={pasting}
        onClose={() => setPasting(false)}
        onSave={handleSavePastedNote}
      />
    </View>
  );
};
