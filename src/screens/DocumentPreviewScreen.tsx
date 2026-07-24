import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import RNFS from 'react-native-fs';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { documentService } from '../services';
import { ragService } from '../services/rag';
import { RootStackParamList } from '../navigation/types';
import logger from '../utils/logger';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'DocumentPreview'>;

// Decode URL-encoded file paths (e.g., %20 -> space)
const decodeFilePath = (path: string): string => {
  logger.log('[decodeFilePath] Input:', path);
  try {
    // First decode URL encoding
    let decoded = decodeURIComponent(path);
    logger.log('[decodeFilePath] After decodeURIComponent:', decoded);
    // Then strip file:// prefix if present (RNFS needs a plain path)
    decoded = decoded.replace(/^file:\/\//, '');
    logger.log('[decodeFilePath] After stripping file://:', decoded);
    return decoded;
  } catch {
    logger.log('[decodeFilePath] Decode failed, returning original:', path);
    return path;
  }
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  backButton: {
    padding: SPACING.xs,
    marginRight: SPACING.md,
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '500' as const,
  },
  headerSubtitle: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: SPACING.lg,
  },
  contentText: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    fontFamily: 'Menlo',
    fontSize: 13,
    lineHeight: 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: SPACING.xxl,
  },
  errorText: {
    ...TYPOGRAPHY.body,
    color: colors.error,
    textAlign: 'center' as const,
    marginTop: SPACING.md,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
});

export const DocumentPreviewScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { filePath, fileName, fileSize } = route.params;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContent = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      logger.log('[DocumentPreview] ===== Loading document =====');
      logger.log('[DocumentPreview] Original filePath param:', filePath);
      logger.log('[DocumentPreview] fileName:', fileName);
      logger.log('[DocumentPreview] RNFS.DocumentDirectoryPath:', RNFS.DocumentDirectoryPath);

      // Decode URL-encoded path (e.g., %20 -> space)
      const decodedPath = decodeFilePath(filePath);
      logger.log('[DocumentPreview] Decoded path:', decodedPath);

      // Build potential paths to try
      const pathsToTry: string[] = [decodedPath];

      // Try the filename in current Documents directory as fallback
      // (in case the app was reinstalled and the path changed)
      const documentsPath = RNFS.DocumentDirectoryPath;
      const filenameInDocs = `${documentsPath}/${fileName}`;
      pathsToTry.push(filenameInDocs);

      // Also try with the UUID prefix stripped from filename (keepLocalCopy format)
      // Format: UUID-filename.ext -> filename.ext
      const uuidMatch = fileName.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i);
      if (uuidMatch) {
        const strippedName = uuidMatch[1];
        pathsToTry.push(`${documentsPath}/${strippedName}`);
      }

      logger.log('[DocumentPreview] Paths to try:', pathsToTry);

      let foundPath: string | null = null;
      for (const tryPath of pathsToTry) {
        try {
          const exists = await RNFS.exists(tryPath);
          logger.log(`[DocumentPreview] Checking ${tryPath}: ${exists}`);
          if (exists) {
            foundPath = tryPath;
            break;
          }
        } catch (e) {
          logger.log(`[DocumentPreview] Error checking path ${tryPath}:`, e);
        }
      }

      if (!foundPath) {
        // No backing file. It may be a TEXT-indexed doc (e.g. a recorder transcript added
        // to a knowledge base via ragService.indexText, whose `path` is a synthetic id, not
        // a file). Render its indexed text instead of erroring.
        const indexed = await ragService.getIndexedText(filePath).catch(() => null);
        if (indexed) {
          logger.log('[DocumentPreview] No file; rendering indexed text', indexed.length);
          setContent(indexed);
          return;
        }
        logger.error('[DocumentPreview] File not found in any location');
        setError('File not found. The document may have been stored in a previous app installation. Please re-upload the document.');
        return;
      }

      logger.log('[DocumentPreview] Found file at:', foundPath);
      const attachment = await documentService.processDocumentFromPath(foundPath, fileName);
      logger.log('[DocumentPreview] Attachment result:', attachment ? 'success' : 'null');

      if (attachment?.textContent) {
        logger.log('[DocumentPreview] Text content length:', attachment.textContent.length);
        setContent(attachment.textContent);
      } else {
        logger.log('[DocumentPreview] No text content in attachment');
        setError('Could not extract text from this document');
      }
    } catch (err: any) {
      logger.error('[DocumentPreview] ===== Error loading document =====');
      logger.error('[DocumentPreview] Error message:', err?.message);
      logger.error('[DocumentPreview] Error stack:', err?.stack);
      setError(err?.message || 'Failed to load document');
    } finally {
      setIsLoading(false);
    }
  }, [filePath, fileName]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {fileName || 'Document'}
          </Text>
          {fileSize > 0 && (
            <Text style={styles.headerSubtitle}>{formatFileSize(fileSize)}</Text>
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.emptyText}>Loading document...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Icon name="alert-circle" size={40} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : content ? (
        <ScrollView style={styles.content} showsVerticalScrollIndicator>
          <Text style={styles.contentText}>{content}</Text>
        </ScrollView>
      ) : (
        <View style={styles.centered}>
          <Icon name="file-text" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No content available</Text>
        </View>
      )}
    </SafeAreaView>
  );
};