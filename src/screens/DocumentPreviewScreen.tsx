import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { LIST_CLIPPING_PROPS } from '../constants/listClipping';
import type { DocumentPage } from '@offgrid/rag/documents';
import { LoadingDots } from '../components/LoadingDots';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import RNFS from 'react-native-fs';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { documentStore } from '../services/documents/store';
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

/** How long the screen waits for a document that is still being read before showing what is ready. */
const READ_WAIT_MS = 10_000;
const READ_POLL_MS = 500;

/**
 * A document's stored pages, and whether its reading had finished, waiting briefly while it is still
 * being read. Null when it could not be read.
 */
async function waitForPages(
  documentId: string,
): Promise<{ pages: DocumentPage[]; settled: boolean } | null> {
  const deadline = Date.now() + READ_WAIT_MS;
  for (;;) {
    const stored = await documentStore.getDocument(documentId);
    if (stored?.state === 'failed') return null;
    const settled = stored && stored.state !== 'reading';
    if (settled || Date.now() >= deadline) {
      const pages = (await documentStore.readPages(documentId)).filter((p) => p.text.trim());
      return { pages, settled: !!settled };
    }
    await new Promise((resolve) => setTimeout(resolve, READ_POLL_MS));
  }
}

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
  pageLabel: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    marginBottom: SPACING.xs,
  },
  page: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pageCited: {
    backgroundColor: colors.surface,
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
  const { filePath, fileName, fileSize, documentId, page } = route.params;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [pages, setPages] = useState<DocumentPage[] | null>(null);
  const pageListRef = useRef<FlatList<DocumentPage>>(null);
  const jumpedToPage = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContent = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const showPages = async (id: string): Promise<void> => {
        const read = await waitForPages(id);
        if (!read) setError('Could not read this document.');
        else if (read.pages.length) setPages(read.pages);
        // Read to the end with no text (an empty file, a scanned PDF): nothing to show, not "still reading".
        else if (!read.settled) setError('This document is still being read. Try again in a moment.');
      };

      if (documentId) {
        // A document the index knows: its pages are stored (or being read) by the document engine.
        await showPages(documentId);
        return;
      }

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
        logger.error('[DocumentPreview] File not found in any location');
        setError('File not found. The document may have been stored in a previous app installation. Please re-upload the document.');
        return;
      }

      logger.log('[DocumentPreview] Found file at:', foundPath);
      // A file the index has not seen: read it with the document engine, like any attached document.
      const id = await RNFS.hash(foundPath, 'sha256');
      const { startDocumentIngest } = await import('../services/documents');
      startDocumentIngest({
        id,
        name: fileName,
        kind: fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text',
        path: foundPath,
      });
      await showPages(id);
    } catch (err: any) {
      logger.error('[DocumentPreview] ===== Error loading document =====');
      logger.error('[DocumentPreview] Error message:', err?.message);
      logger.error('[DocumentPreview] Error stack:', err?.stack);
      setError(err?.message || 'Failed to load document');
    } finally {
      setIsLoading(false);
    }
  }, [filePath, fileName, documentId]);

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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} testID="document-preview-back">
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
          <LoadingDots color={colors.primary} size={8} />
          <Text style={styles.emptyText}>Loading document...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Icon name="alert-circle" size={40} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : pages ? (
        <FlatList
          {...LIST_CLIPPING_PROPS}
          ref={pageListRef}
          data={pages}
          keyExtractor={(item) => String(item.page)}
          initialNumToRender={4}
          windowSize={5}
          onLayout={() => {
            if (jumpedToPage.current) return;
            jumpedToPage.current = true;
            const index = page ? pages.findIndex((p) => p.page >= page) : -1;
            if (index > 0) pageListRef.current?.scrollToIndex({ index, animated: false });
          }}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            pageListRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
            setTimeout(() => pageListRef.current?.scrollToIndex({ index, animated: false }), 100);
          }}
          renderItem={({ item }) => (
            <View style={[styles.page, item.page === page && styles.pageCited]} testID={`document-preview-page-${item.page}`}>
              <Text style={styles.pageLabel}>{item.label ?? `Page ${item.page}`}</Text>
              <Text style={styles.contentText} selectable>{item.text}</Text>
            </View>
          )}
        />
      ) : (
        <View style={styles.centered}>
          <Icon name="file-text" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No content available</Text>
        </View>
      )}
    </SafeAreaView>
  );
};