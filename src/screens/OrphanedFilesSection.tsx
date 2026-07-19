import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../components';
import {
  CustomAlert,
  showAlert,
  hideAlert,
  AlertState,
  initialAlertState,
} from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { hardwareService, modelManager } from '../services';

interface OrphanedFile {
  name: string;
  path: string;
  size: number;
}

interface Props {
  onStorageChange: () => void;
}

export const OrphanedFilesSection: React.FC<Props> = ({ onStorageChange }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [orphanedFiles, setOrphanedFiles] = useState<OrphanedFile[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const scanForOrphanedFiles = useCallback(async () => {
    setIsScanning(true);
    try {
      const orphaned = await modelManager.getOrphanedFiles();
      setOrphanedFiles(orphaned);
    } catch (_error) {
      // Silently fail — non-critical background scan
    } finally {
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    scanForOrphanedFiles();
  }, [scanForOrphanedFiles]);

  const performDelete = useCallback(
    async (file: OrphanedFile) => {
      setIsDeleting(file.path);
      try {
        await modelManager.deleteOrphanedFile(file.path);
        setOrphanedFiles(prev => prev.filter(f => f.path !== file.path));
        onStorageChange();
      } catch (_err) {
        setAlertState(showAlert('Error', 'Failed to delete file'));
      } finally {
        setIsDeleting(null);
      }
    },
    [onStorageChange],
  );

  const handleDeleteFile = useCallback(
    (file: OrphanedFile) => {
      setAlertState(
        showAlert(
          'Delete Orphaned File',
          `Delete "${
            file.name
          }"?\n\nThis will free up ${hardwareService.formatBytes(file.size)}.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                setAlertState(hideAlert());
                performDelete(file).catch(() => {});
              },
            },
          ],
        ),
      );
    },
    [performDelete],
  );

  const handleDeleteAll = useCallback(() => {
    if (orphanedFiles.length === 0) return;
    const totalSize = orphanedFiles.reduce((sum, f) => sum + f.size, 0);
    setAlertState(
      showAlert(
        'Delete All Orphaned Files',
        `Delete ${
          orphanedFiles.length
        } orphaned file(s)?\n\nThis will free up ${hardwareService.formatBytes(
          totalSize,
        )}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete All',
            style: 'destructive',
            onPress: () => {
              const doDeleteAll = async () => {
                setAlertState(hideAlert());
                setIsScanning(true);
                for (const file of orphanedFiles) {
                  try {
                    await modelManager.deleteOrphanedFile(file.path);
                  } catch (_err) {
                    // continue with remaining files
                  }
                }
                setOrphanedFiles([]);
                onStorageChange();
                setIsScanning(false);
              };
              doDeleteAll();
            },
          },
        ],
      ),
    );
  }, [orphanedFiles, onStorageChange]);

  return (
    <>
      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Orphaned Files</Text>
          <TouchableOpacity
            style={styles.scanButton}
            onPress={scanForOrphanedFiles}
            disabled={isScanning}
          >
            {isScanning ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="refresh-cw" size={16} color={colors.primary} />
            )}
          </TouchableOpacity>
        </View>

        {orphanedFiles.length === 0 ? (
          <Text style={styles.emptyText}>
            {isScanning ? 'Scanning...' : 'No orphaned files found'}
          </Text>
        ) : (
          <>
            <Text style={styles.warningText}>
              These files/folders exist on disk but aren't tracked as models.
              They may be from failed or cancelled downloads.
            </Text>
            {orphanedFiles.map(file => (
              <View
                key={file.path}
                testID={`orphaned-file-${file.name}`}
                style={styles.orphanedRow}
              >
                <View style={styles.orphanedInfo}>
                  <Text style={styles.orphanedName} numberOfLines={1}>
                    {file.name}
                  </Text>
                  <Text style={styles.orphanedMeta}>
                    {hardwareService.formatBytes(file.size)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeleteFile(file)}
                  disabled={isDeleting === file.path}
                >
                  {isDeleting === file.path ? (
                    <ActivityIndicator size="small" color={colors.error} />
                  ) : (
                    <Icon name="trash-2" size={18} color={colors.error} />
                  )}
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={styles.deleteAllButton}
              onPress={handleDeleteAll}
            >
              <Icon name="trash-2" size={16} color={colors.error} />
              <Text style={styles.deleteAllText}>
                Delete All Orphaned Files
              </Text>
            </TouchableOpacity>
          </>
        )}
      </Card>
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    letterSpacing: 0.3,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.md,
  },
  scanButton: {
    padding: SPACING.sm,
  },
  warningText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    textAlign: 'center' as const,
    paddingVertical: SPACING.lg,
  },
  orphanedRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  orphanedInfo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  orphanedName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  orphanedMeta: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  deleteButton: {
    padding: SPACING.sm,
  },
  deleteAllButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    marginTop: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 8,
  },
  deleteAllText: {
    ...TYPOGRAPHY.body,
    color: colors.error,
  },
});
