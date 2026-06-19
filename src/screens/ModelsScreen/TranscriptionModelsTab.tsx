/**
 * TranscriptionModelsTab
 *
 * The "Transcription Models" tab on the Models screen: on-device speech-to-text
 * (Whisper) models. Shows the built-in ggml catalogue (English + multilingual)
 * and a HuggingFace search so users can find other-language / community
 * fine-tuned ggml whisper models. Renders with the shared ModelCard so it
 * matches the Text, Image, and Voice tabs.
 *
 * Whisper is a core feature, so this tab is always available (no pro gating).
 * The whisper store tracks a single active model; downloading another switches
 * the active one.
 */
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { ModelCard } from '../../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { useWhisperStore } from '../../stores';
import { WHISPER_MODELS } from '../../services';
import { huggingFaceService } from '../../services/huggingface';
import logger from '../../utils/logger';

interface HFRepo { id: string; author: string; downloads: number }
interface HFFile { name: string; downloadUrl: string; sizeMb: number }

const ENGLISH_MODELS = WHISPER_MODELS.filter(m => m.lang === 'en');
const MULTI_MODELS = WHISPER_MODELS.filter(m => m.lang === 'multi');

const formatSize = (mb: number): string => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`);

interface WhisperCardProps {
  model: typeof WHISPER_MODELS[number];
  index: number;
  downloadedModelId: string | null;
  downloadingId: string | null;
  downloadProgress: number;
  onDownload: (id: string) => void;
  onDelete: () => void;
}

const WhisperCard: React.FC<WhisperCardProps> = ({
  model, index, downloadedModelId, downloadingId, downloadProgress, onDownload, onDelete,
}) => {
  const downloaded = downloadedModelId === model.id;
  const downloading = downloadingId === model.id;
  return (
    <ModelCard
      compact
      model={{ id: model.id, name: model.name, author: formatSize(model.size), description: model.description }}
      isDownloaded={downloaded && !downloading}
      isDownloading={downloading}
      downloadProgress={downloadProgress}
      testID={`transcription-model-card-${index}`}
      onPress={!downloaded && !downloading ? () => onDownload(model.id) : undefined}
      onDownload={!downloaded && !downloading ? () => onDownload(model.id) : undefined}
      onDelete={downloaded ? onDelete : undefined}
    />
  );
};

export const TranscriptionModelsTab: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [searchQuery, setSearchQuery] = useState('');
  const [hfRepos, setHfRepos] = useState<HFRepo[]>([]);
  const [hfFiles, setHfFiles] = useState<Record<string, HFFile[]>>({});
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    downloadedModelId, downloadProgress, downloadModel, downloadFromUrl, deleteModel,
    error: whisperError, clearError,
  } = useWhisperStore();

  const handleDownload = useCallback((id: string) => {
    setDownloadingId(id);
    downloadModel(id).catch(err => logger.error('[Transcription] download failed:', err)).finally(() => setDownloadingId(null));
  }, [downloadModel]);

  const handleDelete = useCallback(() => {
    setAlertState(showAlert('Remove Transcription Model', 'This deletes the model and disables voice input until you download one again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { setAlertState(hideAlert()); deleteModel(); } },
    ]));
  }, [deleteModel]);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setHfRepos([]); return; }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        setHfRepos(await huggingFaceService.searchWhisperRepos(q));
      } catch (err) {
        logger.error('[Transcription] HF search error:', err);
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
      logger.error('[Transcription] repo files error:', err);
    } finally {
      setLoadingFiles(null);
    }
  }, [expandedRepo, hfFiles]);

  const handleDownloadHfFile = useCallback((file: HFFile, repoId: string) => {
    const modelId = `hf-${repoId.replace('/', '-')}-${file.name.replace('.bin', '')}`;
    setAlertState(showAlert('Download Model', `Download "${file.name}" (${formatSize(file.sizeMb)}) from ${repoId}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Download',
        onPress: () => {
          setAlertState(hideAlert());
          setDownloadingId(modelId);
          downloadFromUrl(file.downloadUrl, modelId)
            .catch(err => logger.error('[Transcription] custom download failed:', err))
            .finally(() => setDownloadingId(null));
        },
      },
    ]));
  }, [downloadFromUrl]);

  const renderWhisperCard = (model: typeof WHISPER_MODELS[number], index: number) => (
    <WhisperCard
      key={model.id}
      model={model}
      index={index}
      downloadedModelId={downloadedModelId}
      downloadingId={downloadingId}
      downloadProgress={downloadProgress}
      onDownload={handleDownload}
      onDelete={handleDelete}
    />
  );

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.deviceBanner}>
        <Icon name="shield" size={11} color={colors.trending} />
        <Text style={styles.deviceBannerText}>Transcription runs on your phone, audio is never sent anywhere</Text>
      </View>

      <View style={styles.searchBar}>
        <Icon name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={handleSearch}
          placeholder="Search HuggingFace for other languages..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          testID="transcription-search"
        />
        {isSearching && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {whisperError && (
        <TouchableOpacity onPress={clearError}>
          <Text style={styles.error}>{whisperError} (tap to dismiss)</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionLabel}>English only</Text>
      {ENGLISH_MODELS.map((m, i) => renderWhisperCard(m, i))}

      <Text style={styles.sectionLabel}>Multilingual - 99 languages</Text>
      {MULTI_MODELS.map((m, i) => renderWhisperCard(m, ENGLISH_MODELS.length + i))}

      {hfRepos.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>HuggingFace results</Text>
          {hfRepos.map(repo => (
            <View key={repo.id} style={styles.repoBlock}>
              <TouchableOpacity style={styles.repoRow} onPress={() => handleExpandRepo(repo.id)} testID={`transcription-repo-${repo.id}`}>
                <View style={styles.repoInfo}>
                  <Text style={styles.repoName} numberOfLines={1}>{repo.id}</Text>
                  <Text style={styles.repoMeta}>{Math.round(repo.downloads / 1000)}k downloads</Text>
                </View>
                {loadingFiles === repo.id
                  ? <ActivityIndicator size="small" color={colors.textMuted} />
                  : <Icon name={expandedRepo === repo.id ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />}
              </TouchableOpacity>
              {expandedRepo === repo.id && hfFiles[repo.id]?.length === 0 && (
                <Text style={styles.noFiles}>No ggml .bin files in this repo.</Text>
              )}
              {expandedRepo === repo.id && hfFiles[repo.id]?.map(file => (
                <ModelCard
                  key={file.name}
                  compact
                  model={{ id: file.name, name: file.name, author: formatSize(file.sizeMb), description: repo.id }}
                  isDownloading={downloadingId === `hf-${repo.id.replace('/', '-')}-${file.name.replace('.bin', '')}`}
                  downloadProgress={downloadProgress}
                  testID={`transcription-hf-${file.name}`}
                  onPress={() => handleDownloadHfFile(file, repo.id)}
                  onDownload={() => handleDownloadHfFile(file, repo.id)}
                />
              ))}
            </View>
          ))}
        </>
      )}

      <CustomAlert visible={alertState.visible} title={alertState.title}
        message={alertState.message} buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())} />
    </ScrollView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) =>
  ({
    flex: { flex: 1 },
    content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xs, paddingBottom: SPACING.xxl },
    deviceBanner: {
      backgroundColor: `${colors.trending}15`,
      borderRadius: 8,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      marginBottom: SPACING.md,
      borderWidth: 1,
      borderColor: `${colors.trending}40`,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.xs,
    },
    deviceBannerText: { ...TYPOGRAPHY.meta, color: colors.trending, flex: 1 },
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
      marginBottom: SPACING.md,
      ...shadows.small,
    },
    searchInput: { ...TYPOGRAPHY.body, flex: 1, color: colors.text, padding: 0 },
    sectionLabel: {
      ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted,
      letterSpacing: 0.3, marginBottom: SPACING.sm, marginTop: SPACING.xs,
    },
    error: { ...TYPOGRAPHY.bodySmall, color: colors.error, textAlign: 'center' as const, marginBottom: SPACING.md },
    repoBlock: { marginBottom: SPACING.sm },
    repoRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: SPACING.sm, gap: SPACING.md },
    repoInfo: { flex: 1 },
    repoName: { ...TYPOGRAPHY.body, color: colors.text },
    repoMeta: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: 2 },
    noFiles: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, paddingBottom: SPACING.sm },
  });
