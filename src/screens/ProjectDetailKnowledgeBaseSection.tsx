import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, Switch, ActivityIndicator, ScrollView, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { pick, isErrorWithCode, errorCodes } from '@react-native-documents/picker';

import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';
import { Button } from '../components/Button';
import { showAlert, AlertState } from '../components/CustomAlert';
import { ragService } from '../services/rag';
import type { RagDocument } from '../services/rag';
import { isPickerStuck } from '../utils/pickerErrorUtils';

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export interface KBSectionProps {
  projectId: string;
  colors: any;
  styles: any;
  setAlertState: (state: AlertState) => void;
  onNavigateToKb: () => void;
  onDocumentPress: (doc: RagDocument) => void;
}

export const KnowledgeBaseSection: React.FC<KBSectionProps> = ({ projectId, colors, styles, setAlertState, onNavigateToKb, onDocumentPress }) => {
  const [kbDocs, setKbDocs] = useState<RagDocument[]>([]);
  const [indexingFile, setIndexingFile] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const isPickingRef = useRef(false);

  const loadKbDocs = useCallback(async () => {
    try { setKbDocs(await ragService.getDocumentsByProject(projectId)); }
    catch (err: any) { setAlertState(showAlert('Error', err?.message || 'Failed to load documents')); }
  }, [projectId, setAlertState]);

  useEffect(() => { loadKbDocs(); }, [loadKbDocs]);

  const handleAddDocument = async () => {
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    setIsPicking(true);
    try {
      // iOS: 'import' → Apple copies the file before handing it to us, original untouched.
      // Android: 'open' → returns a content:// URI; keepLocalCopy() copies it to a real path.
      const files = Platform.OS === 'android'
        ? await pick({ mode: 'open', allowMultiSelection: true })
        : await pick({ mode: 'import', allowMultiSelection: true });
      if (!files?.length) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name || 'document';
        setIndexingFile(files.length > 1 ? `${fileName} (${i + 1}/${files.length})` : fileName);

        const pathForDb = await resolvePickedFileUri(file.uri, fileName);

        await ragService.indexDocument({ projectId, filePath: pathForDb, fileName, fileSize: file.size || 0 });
        await loadKbDocs();
      }
    } catch (err: any) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
      if (isPickerStuck(err)) {
        setAlertState(showAlert(
          'File Picker Unavailable',
          "The file picker isn't responding. Please close and reopen the app, then try again.",
        ));
        return;
      }
      setAlertState(showAlert('Error', err.message || 'Failed to index document'));
    } finally {
      isPickingRef.current = false;
      setIsPicking(false);
      setIndexingFile(null);
    }
  };

  const handleToggleDocument = async (docId: number, enabled: boolean) => {
    try { await ragService.toggleDocument(docId, enabled); await loadKbDocs(); }
    catch (err: any) { setAlertState(showAlert('Error', err?.message || 'Failed to update document')); }
  };

  const handleDeleteDocument = (doc: RagDocument) => {
    setAlertState(showAlert(
      'Remove Document',
      `Remove "${doc.name}" from the knowledge base?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            ragService.deleteDocument(doc.id)
              .then(() => loadKbDocs())
              .catch((err: any) => setAlertState(showAlert('Error', err?.message || 'Failed to remove document')));
          },
        },
      ]));
  };

  return (
    <View style={styles.sectionContent}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onNavigateToKb} activeOpacity={0.7}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Knowledge Base</Text>
          {kbDocs.length > 0 && <Text style={styles.sectionCount}>{kbDocs.length}</Text>}
        </View>
        <View style={styles.sectionActions}>
          <Button title="Add" variant="primary" size="small" onPress={handleAddDocument}
            disabled={isPicking || !!indexingFile}
            icon={<Icon name="plus" size={16} color={colors.primary} />} />
          <Icon name="chevron-right" size={16} color={colors.textMuted} style={styles.navIcon} />
        </View>
      </TouchableOpacity>

      {indexingFile && (
        <View style={styles.kbIndexing}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.kbIndexingText} numberOfLines={1}>Indexing {indexingFile}...</Text>
        </View>
      )}

      {kbDocs.length === 0 && !indexingFile ? (
        <View style={styles.emptyState}>
          <Icon name="file-text" size={24} color={colors.textMuted} />
          <Text style={styles.emptyStateText}>No documents added</Text>
        </View>
      ) : (
        <ScrollView style={styles.sectionList} nestedScrollEnabled>
          {kbDocs.map((doc) => (
            <TouchableOpacity key={doc.id} style={styles.kbDocRow} onPress={() => onDocumentPress(doc)} activeOpacity={0.7}>
              <View style={styles.kbDocInfo}>
                <Text style={styles.kbDocName} numberOfLines={1}>{doc.name}</Text>
                <Text style={styles.kbDocSize}>{formatFileSize(doc.size)}</Text>
              </View>
              <Switch value={doc.enabled === 1} onValueChange={(val) => handleToggleDocument(doc.id, val)}
                trackColor={{ false: colors.border, true: colors.primary }} />
              <TouchableOpacity style={styles.kbDocDelete} onPress={() => handleDeleteDocument(doc)}>
                <Icon name="trash-2" size={14} color={colors.error} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
};
