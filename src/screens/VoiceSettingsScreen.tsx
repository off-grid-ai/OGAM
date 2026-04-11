import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { Card, Button } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useWhisperStore } from '../stores';
import { WHISPER_MODELS } from '../services';
import { huggingFaceService } from '../services/huggingface';
import logger from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HFRepo {
  id: string;
  author: string;
  downloads: number;
}

interface HFFile {
  name: string;
  downloadUrl: string;
  sizeMb: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ENGLISH_MODELS = WHISPER_MODELS.filter(m => m.lang === 'en');
const MULTI_MODELS = WHISPER_MODELS.filter(m => m.lang === 'multi');

function formatSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb} MB`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ModelRowProps {
  id: string;
  name: string;
  sizeMb: number;
  description: string;
  isDownloaded: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  onDownload: () => void;
}

const ModelRow: React.FC<ModelRowProps> = ({ id, name, sizeMb, description, isDownloaded, isDownloading, downloadProgress, onDownload }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  if (isDownloaded) {
    return (
      <View style={styles.modelRow} testID={`model-row-${id}`}>
        <View style={styles.modelRowInfo}>
          <Text style={styles.modelRowName}>{name}</Text>
          <Text style={styles.modelRowDesc}>{description}</Text>
        </View>
        <View style={[styles.badge, styles.badgeDownloaded]}>
          <Icon name="check" size={11} color={colors.primary} />
          <Text style={[styles.badgeText, { color: colors.primary }]}>Active</Text>
        </View>
      </View>
    );
  }
  if (isDownloading) {
    return (
      <View style={styles.modelRow}>
        <View style={styles.modelRowInfo}>
          <Text style={styles.modelRowName}>{name}</Text>
          <Text style={styles.modelRowDesc}>{Math.round(downloadProgress * 100)}%</Text>
        </View>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }
  return (
    <TouchableOpacity style={styles.modelRow} onPress={onDownload} testID={`model-download-${id}`}>
      <View style={styles.modelRowInfo}>
        <Text style={styles.modelRowName}>{name}</Text>
        <Text style={styles.modelRowDesc}>{description}</Text>
      </View>
      <View style={styles.modelRowRight}>
        <Text style={styles.modelRowSize}>{formatSize(sizeMb)}</Text>
        <Icon name="download" size={14} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

export const VoiceSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [searchQuery, setSearchQuery] = useState('');
  const [hfRepos, setHfRepos] = useState<HFRepo[]>([]);
  const [hfFiles, setHfFiles] = useState<Record<string, HFFile[]>>({});
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    downloadedModelId,
    isDownloading,
    downloadProgress,
    downloadModel,
    downloadFromUrl,
    deleteModel,
    error: whisperError,
    clearError,
  } = useWhisperStore();

  const currentModel = WHISPER_MODELS.find(m => m.id === downloadedModelId);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setHfRepos([]); return; }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await huggingFaceService.searchWhisperRepos(q);
        setHfRepos(results);
      } catch (err) {
        logger.error('[VoiceSettings] HF search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 500);
  }, []);

  const handleExpandRepo = useCallback(async (repoId: string) => {
    if (expandedRepo === repoId) { setExpandedRepo(null); return; }
    setExpandedRepo(repoId);
    if (hfFiles[repoId]) return;
    setLoadingFiles(repoId);
    try {
      const files = await huggingFaceService.getWhisperFiles(repoId);
      setHfFiles(prev => ({ ...prev, [repoId]: files }));
    } catch (err) {
      logger.error('[VoiceSettings] Failed to fetch repo files:', err);
    } finally {
      setLoadingFiles(null);
    }
  }, [expandedRepo, hfFiles]);

  const handleDownloadHfFile = useCallback((file: HFFile, repoId: string) => {
    const modelId = `hf-${repoId.replace('/', '-')}-${file.name.replace('.bin', '')}`;
    setAlertState(showAlert(
      'Download Model',
      `Download "${file.name}" (${formatSize(file.sizeMb)}) from ${repoId}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => {
            setAlertState(hideAlert());
            downloadFromUrl(file.downloadUrl, modelId).catch((err) => {
              logger.error('[VoiceSettings] Custom download failed:', err);
            });
          },
        },
      ],
    ));
  }, [downloadFromUrl]);

  const confirmDelete = () => {
    setAlertState(showAlert(
      'Remove Voice Model',
      'This will disable voice input until you download a model again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => { setAlertState(hideAlert()); deleteModel(); },
        },
      ],
    ));
  };

  const filteredEnglish = searchQuery
    ? ENGLISH_MODELS.filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : ENGLISH_MODELS;

  const filteredMulti = searchQuery
    ? MULTI_MODELS.filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 'multilingual'.includes(searchQuery.toLowerCase()))
    : MULTI_MODELS;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Voice Transcription</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Current model ── */}
        {downloadedModelId && (
          <Card style={styles.section}>
            <Text style={styles.sectionLabel}>ACTIVE MODEL</Text>
            <View style={styles.currentModelRow}>
              <View style={styles.modelRowInfo}>
                <Text style={styles.modelRowName}>
                  {currentModel ? `${currentModel.name} — ${currentModel.lang === 'en' ? 'English' : 'Multilingual'}` : downloadedModelId}
                </Text>
                {currentModel && <Text style={styles.modelRowDesc}>{currentModel.description}</Text>}
              </View>
              <Button
                title="Remove"
                variant="outline"
                size="small"
                onPress={confirmDelete}
                style={styles.removeButton}
              />
            </View>
            {isDownloading && (
              <View style={styles.progressWrap}>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${downloadProgress * 100}%` }]} />
                </View>
                <Text style={styles.progressText}>{Math.round(downloadProgress * 100)}%</Text>
              </View>
            )}
          </Card>
        )}

        {/* ── Download progress when no model yet ── */}
        {!downloadedModelId && isDownloading && (
          <Card style={styles.section}>
            <View style={styles.downloadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.downloadingText}>Downloading... {Math.round(downloadProgress * 100)}%</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${downloadProgress * 100}%` }]} />
            </View>
          </Card>
        )}

        {/* ── Error ── */}
        {whisperError && (
          <TouchableOpacity onPress={clearError}>
            <Text style={styles.error}>{whisperError} (tap to dismiss)</Text>
          </TouchableOpacity>
        )}

        {/* ── Search bar ── */}
        <View style={styles.searchBar}>
          <Icon name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={handleSearch}
            placeholder="Search models or HuggingFace..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {isSearching && <ActivityIndicator size="small" color={colors.primary} />}
        </View>

        {/* ── Curated: English ── */}
        {filteredEnglish.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionLabel}>ENGLISH ONLY</Text>
            {filteredEnglish.map((model, idx) => (
              <React.Fragment key={model.id}>
                {idx > 0 && <View style={styles.divider} />}
                <ModelRow
                  id={model.id}
                  name={model.name}
                  sizeMb={model.size}
                  description={model.description}
                  isDownloaded={downloadedModelId === model.id}
                  isDownloading={isDownloading && downloadedModelId === model.id}
                  downloadProgress={downloadProgress}
                  onDownload={() => downloadModel(model.id)}
                />
              </React.Fragment>
            ))}
          </Card>
        )}

        {/* ── Curated: Multilingual ── */}
        {filteredMulti.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionLabel}>MULTILINGUAL — 99 LANGUAGES</Text>
            {filteredMulti.map((model, idx) => (
              <React.Fragment key={model.id}>
                {idx > 0 && <View style={styles.divider} />}
                <ModelRow
                  id={model.id}
                  name={model.name}
                  sizeMb={model.size}
                  description={model.description}
                  isDownloaded={downloadedModelId === model.id}
                  isDownloading={isDownloading && downloadedModelId === model.id}
                  downloadProgress={downloadProgress}
                  onDownload={() => downloadModel(model.id)}
                />
              </React.Fragment>
            ))}
          </Card>
        )}

        {/* ── HuggingFace search results ── */}
        {hfRepos.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionLabel}>HUGGINGFACE RESULTS</Text>
            {hfRepos.map((repo, idx) => (
              <React.Fragment key={repo.id}>
                {idx > 0 && <View style={styles.divider} />}
                <TouchableOpacity style={styles.repoRow} onPress={() => handleExpandRepo(repo.id)}>
                  <View style={styles.modelRowInfo}>
                    <Text style={styles.modelRowName} numberOfLines={1}>{repo.id}</Text>
                    <Text style={styles.modelRowDesc}>{(repo.downloads / 1000).toFixed(0)}k downloads</Text>
                  </View>
                  {loadingFiles === repo.id
                    ? <ActivityIndicator size="small" color={colors.textMuted} />
                    : <Icon name={expandedRepo === repo.id ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                  }
                </TouchableOpacity>
                {expandedRepo === repo.id && (
                  <View style={styles.repoFiles}>
                    {hfFiles[repo.id]?.length === 0 && (
                      <Text style={styles.noFilesText}>No ggml .bin files found in this repo.</Text>
                    )}
                    {hfFiles[repo.id]?.map((file) => (
                      <TouchableOpacity
                        key={file.name}
                        style={styles.fileRow}
                        onPress={() => handleDownloadHfFile(file, repo.id)}
                      >
                        <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                        <View style={styles.modelRowRight}>
                          <Text style={styles.modelRowSize}>{formatSize(file.sizeMb)}</Text>
                          <Icon name="download" size={13} color={colors.textMuted} />
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </React.Fragment>
            ))}
          </Card>
        )}

        {/* ── Privacy note ── */}
        <View style={styles.privacyNote}>
          <Icon name="lock" size={13} color={colors.textMuted} />
          <Text style={styles.privacyText}>All transcription runs on-device. Audio is never sent to any server.</Text>
        </View>
      </ScrollView>

      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
    gap: SPACING.md,
  },
  backButton: { padding: SPACING.xs },
  title: { ...TYPOGRAPHY.h2, flex: 1, color: colors.text },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.md },
  section: { gap: SPACING.xs },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  currentModelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md },
  modelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: SPACING.sm, gap: SPACING.md },
  modelRowInfo: { flex: 1, gap: 2 },
  modelRowName: { ...TYPOGRAPHY.body, color: colors.text },
  modelRowDesc: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, lineHeight: 16 },
  modelRowRight: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.xs },
  modelRowSize: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  badge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeDownloaded: { backgroundColor: `${colors.primary}18` },
  badgeText: { ...TYPOGRAPHY.meta },
  removeButton: { borderColor: colors.error, flexShrink: 1 },
  progressWrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm, marginTop: SPACING.sm },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  progressFill: { height: '100%' as const, backgroundColor: colors.primary, borderRadius: 2 },
  progressText: { ...TYPOGRAPHY.meta, color: colors.textMuted, minWidth: 36 },
  downloadingRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm, marginBottom: SPACING.sm },
  downloadingText: { ...TYPOGRAPHY.body, color: colors.textSecondary },
  error: { ...TYPOGRAPHY.bodySmall, color: colors.error, textAlign: 'center' as const, paddingHorizontal: SPACING.sm },
  searchBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    ...shadows.small,
  },
  searchInput: { ...TYPOGRAPHY.body, flex: 1, color: colors.text, padding: 0 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },
  repoRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: SPACING.sm, gap: SPACING.md },
  repoFiles: { paddingLeft: SPACING.md, paddingBottom: SPACING.xs, gap: 4 },
  fileRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.xs,
    gap: SPACING.md,
  },
  fileName: { ...TYPOGRAPHY.bodySmall, flex: 1, color: colors.textSecondary },
  noFilesText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, paddingVertical: SPACING.xs },
  privacyNote: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
    justifyContent: 'center' as const,
    paddingTop: SPACING.sm,
  },
  privacyText: { ...TYPOGRAPHY.meta, color: colors.textMuted },
});
