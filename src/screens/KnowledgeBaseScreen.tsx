import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { createStyles } from './KnowledgeBaseScreen.styles';
import { useProjectStore } from '../stores';
import { ragService } from '../services/rag';
import type { RagDocument } from '../services/rag';
import { RootStackParamList } from '../navigation/types';
import { pickDocumentWithCoordinator } from '../utils/documentPickerCoordinator';

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

  const [kbDocs, setKbDocs] = useState<RagDocument[]>([]);
  const [indexingFile, setIndexingFile] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const project = useProjectStore((s) => s.getProject(projectId));

  const loadKbDocs = useCallback(async () => {
    try {
      setIsLoading(true);
      setKbDocs(await ragService.getDocumentsByProject(projectId));
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadKbDocs();
  }, [loadKbDocs]);

  const handleAddDocument = async () => {
    try {
      const files = await pickDocumentWithCoordinator('knowledge-base-screen', {
        mode: 'import',
        allowMultiSelection: true,
        ...(Platform.OS === 'ios' ? { presentationStyle: 'fullScreen' as const } : {}),
      });
      if (!files?.length) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name || 'document';
        setIndexingFile(files.length > 1 ? `${fileName} (${i + 1}/${files.length})` : fileName);

        // mode: 'import' means iOS already provided a local copy — original is untouched
        let pathForDb = file.uri;
        try {
          pathForDb = decodeURIComponent(file.uri).replace(/^file:\/\//, '');
        } catch {
          // use uri as-is
        }

        try {
          await ragService.indexDocument({ projectId, filePath: pathForDb, fileName, fileSize: file.size || 0 });
        } catch (indexErr: any) {
          Alert.alert('Error', `Failed to index "${fileName}": ${indexErr?.message || 'Unknown error'}`);
        }
      }
      await loadKbDocs();
    } catch (err: any) {
      if (!err?.message?.includes('cancel')) {
        Alert.alert('Error', err?.message || 'Failed to index documents');
      }
    } finally {
      setIndexingFile(null);
    }
  };

  const handleToggleDocument = async (docId: number, enabled: boolean) => {
    try {
      await ragService.toggleDocument(docId, enabled);
      await loadKbDocs();
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
              await ragService.deleteDocument(doc.id);
              await loadKbDocs();
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to remove document');
            }
          },
        },
      ]
    );
  };

  const renderDoc = ({ item }: { item: RagDocument }) => (
    <TouchableOpacity
      style={styles.docRow}
      onPress={() => navigation.navigate('DocumentPreview', { filePath: item.path, fileName: item.name, fileSize: item.size })}
      activeOpacity={0.7}
    >
      <View style={styles.docInfo}>
        <Text style={styles.docName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.docSize}>{formatFileSize(item.size)}</Text>
      </View>
      <Switch
        value={item.enabled === 1}
        onValueChange={(val) => handleToggleDocument(item.id, val)}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
      <TouchableOpacity style={styles.docDelete} onPress={() => handleDeleteDocument(item)}>
        <Icon name="trash-2" size={16} color={colors.error} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project?.name || 'Knowledge Base'}
          </Text>
        </View>
        <TouchableOpacity onPress={handleAddDocument} style={styles.addButton} disabled={!!indexingFile}>
          {indexingFile ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="plus" size={20} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      {indexingFile && (
        <View style={styles.indexingBanner}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.indexingText}>Indexing {indexingFile}...</Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : kbDocs.length === 0 ? (
        <View style={styles.centered}>
          <Icon name="file-text" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No documents yet</Text>
          <Text style={styles.emptySubtext}>Add files to build your knowledge base</Text>
          <TouchableOpacity style={styles.addFirstButton} onPress={handleAddDocument}>
            <Text style={styles.addFirstButtonText}>Add Document</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={kbDocs}
          renderItem={renderDoc}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};
