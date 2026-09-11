import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { LoadingDots } from '../components/LoadingDots';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { pick, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';
import logger from '../utils/logger';
import { useTheme, useThemedStyles } from '../theme';
import { createStyles } from './KnowledgeBaseScreen.styles';
import type { RagDocument } from '@offgrid/application';
import { applicationFacade } from '../services/applicationFacade';
import { requireRagSuccess } from '../services/ragOutcome';
import { useProjectRagDocuments } from '../hooks/useProjectRagDocuments';
import { useWorkspaceContentProjection } from '../hooks/useApplicationProjection';
import { RootStackParamList } from '../navigation/types';
import { isPickerStuck } from '../utils/pickerErrorUtils';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'KnowledgeBase'>;


const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const KnowledgeBaseScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const {
    documents: kbDocs,
    error: documentsError,
    retry: retryDocuments,
  } = useProjectRagDocuments(projectId);
  const [indexingFile, setIndexingFile] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [indexError, setIndexError] = useState<{ fileName: string; message: string } | null>(null);
  const isPickingRef = useRef(false);

  const workspaceContent = useWorkspaceContentProjection();
  const project = workspaceContent.projects.find(item => item.id === projectId);
  const isProjectLoading =
    workspaceContent.status === 'created' || workspaceContent.status === 'loading';
  const isProjectUnavailable = workspaceContent.status === 'stopped';
  const isProjectNotFound = workspaceContent.status === 'ready' && !project;
  const canUseProject = workspaceContent.status === 'ready' && !!project;

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
      const pickedFiles = files.map(f => [f.name, ' (', f.size, 'b)'].join('')).join(', ');
      logger.log(`[KnowledgeBase] picker returned ${files.length} file(s): ${pickedFiles}`);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name || 'document';
        setIndexingFile(files.length > 1 ? `${fileName} (${i + 1}/${files.length})` : fileName);

        const pathForDb = await resolvePickedFileUri(file.uri, fileName);
        logger.log(`[KnowledgeBase] indexing file ${i + 1}/${files.length} — name: ${fileName}, path: ${pathForDb?.substring(0, 80)}`);

        try {
          requireRagSuccess(
            await applicationFacade().rag.addDocument({
              projectId,
              path: pathForDb,
              fileName,
              size: file.size || 0,
            }),
          );
          logger.log(`[KnowledgeBase] indexed successfully: ${fileName}`);
        } catch (indexErr: any) {
          // The index aborted mid-way and rolled back (RAG indexing is atomic — no
          // half-indexed doc is left behind). Surface it as a persistent, retriable error card on
          // the screen rather than a fire-and-forget alert, so the user sees the failure and can retry.
          logger.error(`[KnowledgeBase] index failed for "${fileName}" — ${indexErr?.message}`);
          setIndexError({ fileName, message: indexErr?.message || 'Unknown error' });
        }
      }
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
      setIndexingFile(null);
      logger.log('[KnowledgeBase] picker settled, lock released');
    }
  };

  const handleToggleDocument = async (docId: number, enabled: boolean) => {
    try {
      requireRagSuccess(
        await applicationFacade().rag.setDocumentEnabled(docId, enabled),
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update document');
    }
  };

  const handleDeleteDocument = (doc: RagDocument) => {
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
              requireRagSuccess(
                await applicationFacade().rag.removeDocument(doc.id),
              );
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
  const renderDoc = ({ item }: { item: RagDocument }) => (
    <View style={styles.docRow}>
      <TouchableOpacity
        style={styles.docInfo}
        onPress={() => navigation.navigate('DocumentPreview', { filePath: item.path, fileName: item.name, fileSize: item.size })}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Knowledge document ${item.name}`}
        testID={`knowledge-document-row-${item.syncId}`}
      >
        <Text style={styles.docName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.docSize}>{formatFileSize(item.size)}</Text>
      </TouchableOpacity>
      <Switch
        value={item.enabled}
        onValueChange={(val) => handleToggleDocument(item.id, val)}
        accessibilityLabel={`Use ${item.name}, ${item.enabled ? 'ON' : 'OFF'}`}
        testID={`knowledge-document-toggle-${item.syncId}`}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
      <TouchableOpacity
        style={styles.docDelete}
        onPress={() => handleDeleteDocument(item)}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.name}`}
        testID={`knowledge-document-remove-${item.syncId}`}
      >
        <Icon name="trash-2" size={16} color={colors.error} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="knowledge-base-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="knowledge-base-back"
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project?.name || 'Knowledge Base'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleAddDocument}
          style={styles.addButton}
          disabled={!canUseProject || isPicking || !!indexingFile}
        >
          {indexingFile ? (
            <LoadingDots color={colors.primary} />
          ) : (
            <Icon name="plus" size={20} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      {isProjectLoading ? (
        <View style={styles.centered}>
          <LoadingDots color={colors.primary} />
          <Text style={styles.emptyText}>Loading project...</Text>
        </View>
      ) : isProjectUnavailable ? (
        <View style={styles.errorCard}>
          <Icon name="alert-triangle" size={16} color={colors.error} />
          <View style={styles.errorTextWrap}>
            <Text style={styles.errorTitle}>Project unavailable</Text>
            <Text style={styles.errorMessage}>Your project data is not available.</Text>
          </View>
        </View>
      ) : isProjectNotFound ? (
        <View style={styles.centered}>
          <Icon name="folder" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Project not found</Text>
        </View>
      ) : (
        <>
      {Boolean(indexingFile) && (
        <View style={styles.indexingBanner}>
          <LoadingDots color={colors.primary} />
          <Text style={styles.indexingText}>Indexing {indexingFile}...</Text>
        </View>
      )}

      {Boolean(documentsError) && !indexingFile && (
        <View style={styles.errorCard} testID="kb-load-error-card">
          <Icon name="alert-triangle" size={16} color={colors.error} />
          <View style={styles.errorTextWrap}>
            <Text style={styles.errorTitle}>Couldn't load documents</Text>
            <Text style={styles.errorMessage} numberOfLines={3}>
              {documentsError}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.errorRetry}
            testID="kb-load-retry"
            onPress={retryDocuments}
          >
            <Text style={styles.errorRetryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {indexError && !indexingFile && (
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

      {!documentsError && kbDocs.length === 0 ? (
        <View style={styles.centered}>
          <Icon name="file-text" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No documents yet</Text>
          <Text style={styles.emptySubtext}>Add files to build your knowledge base</Text>
          <TouchableOpacity style={styles.addFirstButton} onPress={handleAddDocument} disabled={isPicking}>
            <Text style={styles.addFirstButtonText}>Add Document</Text>
          </TouchableOpacity>
        </View>
      ) : !documentsError ? (
        <FlatList
          data={kbDocs}
          renderItem={renderDoc}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : null}
        </>
      )}
    </SafeAreaView>
  );
};
