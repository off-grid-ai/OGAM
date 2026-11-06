import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Alert,
  Platform,
} from 'react-native';
import { TouchableOpacity } from '../components/Touchable';
import { LIST_CLIPPING_PROPS } from '../constants/listClipping';
import { LoadingDots } from '../components/LoadingDots';
import { AliveScreen } from '../components/AliveScreen';
import { Button } from '../components/Button';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { pick, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';
import logger from '../utils/logger';
import { useTheme, useThemedStyles } from '../theme';
import { createStyles } from './KnowledgeBaseScreen.styles';
import { useProjectStore } from '../stores';
import { knowledgeBase } from '../services/rag';
import type { KnowledgeDocument } from '../services/rag';
import { RootStackParamList } from '../navigation/types';
import { KnowledgeDocumentRow } from '../components/knowledge/KnowledgeDocumentRow';
import { KnowledgeTransferInfo } from '../components/knowledge/KnowledgeDocumentInfo';
import { useKnowledgeDocumentTransfers } from '../hooks/useKnowledgeDocumentTransfers';
import {
  arrivingKnowledgeDocumentTransfers,
  knowledgeDocumentTransferKey,
  rowKnowledgeDocumentTransfer,
  type KnowledgeDocumentTransfer,
} from '../services/sync/knowledgeDocumentTransfer';
import { openDocumentPage } from '../components/ChatDocumentsSheet';
import { isPickerStuck } from '../utils/pickerErrorUtils';
import { SCROLL_DEPTH_PROPS } from '../constants/scrollDepth';
import { ScreenHeader } from '../components/ScreenHeader';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'KnowledgeBase'>;

export const KnowledgeBaseScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [kbDocs, setKbDocs] = useState<KnowledgeDocument[]>([]);
  const [addingFile, setAddingFile] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPicking, setIsPicking] = useState(false);
  const [indexError, setIndexError] = useState<{ fileName: string; message: string } | null>(null);
  const isPickingRef = useRef(false);

  const project = useProjectStore((s) => s.getProject(projectId));

  const loadKbDocs = useCallback(async () => {
    try {
      setIsLoading(true);
      setKbDocs(await knowledgeBase.getDocumentsByProject(projectId));
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadKbDocs();
  }, [loadKbDocs]);

  // Files moving to or from paired devices. A received file reloads the list so its own row shows.
  const reloadQuietly = useCallback(() => {
    knowledgeBase
      .getDocumentsByProject(projectId)
      .then(setKbDocs)
      .catch(() => undefined);
  }, [projectId]);
  const { transfers, dismiss: dismissTransfer } = useKnowledgeDocumentTransfers(projectId, reloadQuietly);
  const arriving = arrivingKnowledgeDocumentTransfers(
    transfers,
    new Set(kbDocs.map((doc) => doc.sync_id)),
  );

  const handleAddDocument = async () => {
    if (isPickingRef.current) {
      logger.log('[KnowledgeBase] blocked — picker already in flight');
      return;
    }
    isPickingRef.current = true;
    setIsPicking(true);
    setIndexError(null);
    logger.log(`[KnowledgeBase] picker opening — platform: ${Platform.OS}, projectId: ${projectId}`);
    try {
      // iOS: 'import' → Apple copies the file before handing it to us, original untouched.
      // Android: 'open' → returns a content:// URI; keepLocalCopy() copies it to a real path.
      const files = Platform.OS === 'android'
        ? await pick({ mode: 'open', allowMultiSelection: true })
        : await pick({ mode: 'import', allowMultiSelection: true });
      if (!files?.length) {
        logger.log('[KnowledgeBase] picker returned empty result');
        return;
      }
      const describe = (f: (typeof files)[number]) => `${f.name} (${f.size}b)`;
      const picked = files.map(describe).join(', ');
      logger.log(`[KnowledgeBase] picker returned ${files.length} file(s): ${picked}`);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name || 'document';
        setAddingFile(files.length > 1 ? `${fileName} (${i + 1}/${files.length})` : fileName);

        const pathForDb = await resolvePickedFileUri(file.uri, fileName);
        logger.log(`[KnowledgeBase] adding file ${i + 1}/${files.length} — name: ${fileName}, path: ${pathForDb?.substring(0, 80)}`);

        try {
          // Adding keeps the file and starts reading it in the background; its row shows the progress.
          await knowledgeBase.addFile({ projectId, filePath: pathForDb, fileName, fileSize: file.size || 0 });
          logger.log(`[KnowledgeBase] added: ${fileName}`);
        } catch (indexErr: any) {
          // The file was not added (unsupported, unreadable, or already here). Surface it as a
          // persistent, retriable error card rather than a fire-and-forget alert.
          logger.error(`[KnowledgeBase] add failed for "${fileName}" — ${indexErr?.message}`);
          setIndexError({ fileName, message: indexErr?.message || 'Unknown error' });
        }
      }
      await loadKbDocs();
    } catch (err: any) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        logger.log('[KnowledgeBase] picker cancelled by user');
        return;
      }
      if (isPickerStuck(err)) {
        logger.warn(`[KnowledgeBase] picker stuck — code: ${err?.code}, message: ${err?.message}`);
        Alert.alert('File Picker Unavailable', "The file picker isn't responding. Please close and reopen the app, then try again.");
        return;
      }
      logger.error(`[KnowledgeBase] picker error — code: ${err?.code}, message: ${err?.message}`);
      Alert.alert('Error', err?.message || 'Failed to index documents');
    } finally {
      isPickingRef.current = false;
      setIsPicking(false);
      setAddingFile(null);
      logger.log('[KnowledgeBase] picker settled, lock released');
    }
  };

  const handleToggleDocument = async (docId: number, enabled: boolean) => {
    try {
      await knowledgeBase.toggleDocument(docId, enabled);
      await loadKbDocs();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update document');
    }
  };

  const handleDeleteDocument = (doc: KnowledgeDocument) => {
    Alert.alert(
      'Remove Document',
      `Remove "${doc.name}" from the knowledge base?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await knowledgeBase.deleteDocument(doc.id);
              await loadKbDocs();
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to remove document');
            }
          },
        },
      ]
    );
  };

  // Three controls, not one.
  //
  // The row used to be a single accessible TouchableOpacity wrapping the switch and the delete
  // button, so iOS merged all of it into one element named "Knowledge document <name>". The
  // switch's own label - "Use <name>, ON" - was never exposed, which means VoiceOver could not tell
  // whether a document was in use, and could not toggle it: the whole row read as one button that
  // opens a preview. Opening, toggling and deleting are three different actions and each needs to
  // be reachable on its own.
  const renderDoc = ({ item }: { item: KnowledgeDocument }) => (
    <KnowledgeDocumentRow
      doc={item}
      transfer={rowKnowledgeDocumentTransfer(transfers, item.sync_id)}
      onOpen={doc => openDocumentPage(navigation, { documentId: doc.document_id, name: doc.name })}
      onToggle={(doc, enabled) => handleToggleDocument(doc.id, enabled)}
      onRemove={handleDeleteDocument}
      testIDPrefix="knowledge-document"
    />
  );

  const renderArriving = (transfer: KnowledgeDocumentTransfer) => (
    <View
      key={knowledgeDocumentTransferKey(transfer)}
      style={styles.docRow}
      testID={`knowledge-document-arriving-${transfer.syncId}`}
    >
      <Icon
        name={transfer.status === 'failed' ? 'alert-circle' : 'download'}
        size={16}
        color={transfer.status === 'failed' ? colors.error : colors.textMuted}
        style={styles.transferIcon}
      />
      <View style={styles.docInfo}>
        <KnowledgeTransferInfo transfer={transfer} />
      </View>
      {transfer.status === 'failed' && (
        <TouchableOpacity
          style={styles.docDelete}
          onPress={() => dismissTransfer(transfer)}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${transfer.fileName}`}
        >
          <Icon name="x" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <AliveScreen style={styles.container} testID="knowledge-base-screen">
      <ScreenHeader
        title={project?.name || 'Knowledge base'}
        onBack={() => navigation.goBack()}
        backTestID="knowledge-base-back"
        right={
          <TouchableOpacity
            onPress={handleAddDocument}
            style={styles.addButton}
            disabled={isPicking || !!addingFile}
            accessibilityRole="button"
            accessibilityLabel="Add documents"
          >
            {addingFile ? <LoadingDots color={colors.textMuted} /> : <Icon name="plus" size={20} color={colors.text} />}
          </TouchableOpacity>
        }
      />

      {indexError && !addingFile && (
        <View style={styles.errorCard} testID="kb-index-error-card">
          <Icon name="alert-triangle" size={16} color={colors.error} />
          <View style={styles.errorTextWrap}>
            <Text style={styles.errorTitle} numberOfLines={2}>
              Couldn't add "{indexError.fileName}"
            </Text>
            <Text style={styles.errorMessage} numberOfLines={3}>{indexError.message}</Text>
          </View>
          <TouchableOpacity
            style={styles.errorRetry}
            testID="kb-index-retry"
            onPress={handleAddDocument}
            disabled={isPicking}
          >
            <Text style={styles.errorRetryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centered} aria-busy>
          <LoadingDots color={colors.primary} size={8} />
        </View>
      ) : kbDocs.length === 0 && arriving.length === 0 ? (
        <View style={styles.centered}>
          <Icon name="file-text" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No documents yet</Text>
          <Text style={styles.emptySubtext}>Add a PDF or notes, and every chat in this project can answer from them.</Text>
          <Button
            title="Add a document"
            variant="hero"
            size="small"
            icon={<Icon name="plus" size={16} color={colors.onHero} />}
            onPress={handleAddDocument}
            disabled={isPicking}
            testID="kb-add-first"
          />
        </View>
      ) : (
        <FlatList
          {...SCROLL_DEPTH_PROPS}
          {...LIST_CLIPPING_PROPS}
          data={kbDocs}
          renderItem={renderDoc}
          keyExtractor={(item) => String(item.id)}
          ListHeaderComponent={arriving.length > 0 ? <>{arriving.map(renderArriving)}</> : null}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </AliveScreen>
  );
};
