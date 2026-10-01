import { videoModelDisplayName } from '../../utils/modelHelpers';
import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, ScrollView, Text, TextInput, View } from 'react-native';
import {
  CATALOG,
  searchHuggingFace,
  getModelFiles,
  resolveHuggingFaceModel,
  formatFileSize,
  determineCredibility,
  videoVaeFilename,
} from '@offgrid/models';
import type { HFSearchResult, ModelFileVariant } from '@offgrid/models';
import { useFocusEffect } from '@react-navigation/native';
import { Card, ModelCard } from '../../components';
import { ScreenHeader } from '../../components/ScreenHeader';
import { LoadingDots } from '../../components/LoadingDots';
import { useAppStore } from '../../stores';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useDownloadStore } from '../../stores/downloadStore';
import { hardwareService } from '../../services/hardware';
import { modelDownloadService } from '../../services/modelDownloadService';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';

export const VideoModelsTab: React.FC<{
  selected: HFSearchResult | null;
  setSelected: React.Dispatch<React.SetStateAction<HFSearchResult | null>>;
}> = ({ selected, setSelected }) => {
  const styles = useThemedStyles(createStyles),
    { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HFSearchResult[]>([]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!selected) return false;
      setSelected(null);
      return true;
    });
    return () => subscription.remove();
  }, [selected, setSelected]));
  const [files, setFiles] = useState<ModelFileVariant[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const loading = selected ? filesLoading : searchLoading;
  const [error, setError] = useState<string | null>(null);
  const models = useAppStore(s => s.downloadedVideoModels);
  const active = useAppStore(s => s.activeVideoModelId);
  const downloads = useDownloadStore(s => s.downloads);
  const pendingModels = useAppStore(s => s.videoDownloads);
  const ramGB = hardwareService.getTotalMemoryGB();
  useEffect(() => {
    let current = true;
    if (!query.trim()) {
      setResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      searchHuggingFace(query.trim(), { kind: 'video' })
        .then(rows => {
          if (current) setResults(rows);
        })
        .catch(e => {
          if (current) setError(String(e.message));
        })
        .finally(() => {
          if (current) setSearchLoading(false);
        });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);
  useEffect(() => {
    if (!selected) return;
    let current = true;
    setFiles([]);
    setFilesLoading(true);
    setError(null);
    getModelFiles(selected.id, { kind: 'video' })
      .then(rows => {
        if (current) setFiles(rows);
      })
      .catch(e => {
        if (current) setError(String(e.message));
      })
      .finally(() => {
        if (current) setFilesLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selected]);
  const act = (work: () => Promise<unknown>) => {
    void work().catch(e => setError(String(e.message)));
  };
  const download = (fileName: string) =>
    act(async () => {
      if (!selected) return;
      const model = await resolveHuggingFaceModel(selected.id, {
        kind: 'video',
        fileName,
      });
      if (!model) throw new Error('This file is no longer available.');
      await modelDownloadService.start({ modelType: 'video', model });
    });
  const defaults = CATALOG.filter(m => m.kind === 'video');
  const rows = query.trim()
    ? results
    : defaults.map(m => ({
        id: m.id,
        name: m.name,
        org: m.org ?? '',
        credibility: determineCredibility(m.org ?? ''),
      }));

  // Both browsing and version selection use Text's existing card and download states.
  const renderCard = (row: HFSearchResult, file?: ModelFileVariant) => {
    const catalogEntry = defaults.find(model => model.id === row.id);
    const template = file
      ? defaults.find(model =>
          model.files.some(f => f.name === videoVaeFilename(file.fileName)),
        )
      : catalogEntry;
    const modelKey = `video:${row.id}`;
    const installed = models.find(model => model.id === row.id);
    const matchesFile = (model: typeof installed) =>
      !!model &&
      (!file ||
        model.files.some(
          f => f.role === 'primary' && f.name === file.fileName,
        ));
    const isDownloaded = matchesFile(installed);
    const pending = pendingModels[row.id];
    const transfer =
      !file ||
      pending?.files.some(f => f.role === 'primary' && f.name === file.fileName)
        ? downloads[modelKey]
        : undefined;
    const unavailable = catalogEntry?.availability === 'coming_soon';
    const totalBytes = file
      ? file.sizeBytes +
        (template?.files
          .filter(f => f.role !== 'primary')
          .reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0) ?? 0)
      : (installed ?? pending ?? catalogEntry)?.files.reduce(
          (sum, f) => sum + (f.sizeBytes ?? 0),
          0,
        );
    const defaultVersion =
      file &&
      template?.files.some(
        f => f.role === 'primary' && f.name === file.fileName,
      );
    const precision =
      file?.quant && file.quant !== 'Unknown' ? file.quant : undefined;
    const versionName = defaultVersion
      ? 'Standard'
      : /bf16/i.test(file?.fileName ?? '')
      ? 'Alternative precision'
      : precision
      ? `Compact ${precision}`
      : 'Alternative version';
    const memory = template?.minRamGb;
    const facts = [
      unavailable ? 'Not available in this app yet' : undefined,
      totalBytes ? `${formatFileSize(totalBytes)}${file ? '' : ' total download'}` : undefined,
      !file && memory ? `${memory} GB memory suggested` : undefined,
      defaultVersion ? 'Default version' : undefined,
    ].filter((fact): fact is string => !!fact);
    const open = () => {
      setError(null);
      setSelected(row);
    };
    const startDownload = () => {
      if (file) download(file.fileName);
      else if (catalogEntry?.files.length)
        act(() =>
          modelDownloadService.start({
            modelType: 'video',
            model: catalogEntry,
          }),
        );
      else open();
    };
    return (
      <ModelCard
        key={file?.fileName ?? row.id}
        compact
        model={{
          id: row.id,
          name: file ? `${videoModelDisplayName(row.id, row.name).replace(/\s*\([^)]*\)$/, '')} - ${versionName}` : videoModelDisplayName(row.id, row.name),
          author: row.org,
          credibility: {
            source:
              row.credibility === 'offgrid' ? 'community' : row.credibility,
            isOfficial: row.credibility === 'official',
            isVerifiedQuantizer: row.credibility === 'verified-quantizer',
          },
          description: file ? undefined : unavailable
            ? catalogEntry?.availabilityNote
            : 'Create short, silent videos from a description.',
        }}
        facts={facts}
        footer={
          transfer?.status === 'processing' ? (
            <Text style={styles.modelDescription}>
              Checking downloaded files...
            </Text>
          ) : undefined
        }
        isDownloaded={isDownloaded}
        isActive={isDownloaded && active === row.id}
        isDownloading={
          transfer?.status === 'running' || transfer?.status === 'processing'
        }
        isPaused={transfer?.status === 'paused'}
        isQueued={transfer?.status === 'pending'}
        downloadProgress={transfer?.progress}
        downloadBytes={
          transfer
            ? {
                downloaded: transfer.bytesDownloaded,
                total: transfer.combinedTotalBytes || transfer.totalBytes,
                bytesPerSecond: transfer.bytesPerSecond,
              }
            : undefined
        }
        onPress={!file && !unavailable ? open : undefined}
        onDownload={
          !unavailable && !installed && !downloads[modelKey]
            ? startDownload
            : undefined
        }
        onSelect={
          isDownloaded
            ? () => {
                useAppStore.getState().setActiveVideoModelId(row.id);
                useRemoteServerStore
                  .getState()
                  .setActiveRemoteMediaServerId('video', null);
              }
            : undefined
        }
        onDelete={
          isDownloaded
            ? () => act(() => modelDownloadService.remove(modelKey))
            : undefined
        }
        onPause={
          transfer?.status === 'running'
            ? () => act(() => modelDownloadService.pause(modelKey))
            : undefined
        }
        onResume={
          transfer?.status === 'paused'
            ? () => act(() => modelDownloadService.resume(modelKey))
            : undefined
        }
        onCancel={
          transfer
            ? () => act(() => modelDownloadService.cancel(modelKey))
            : undefined
        }
        failedState={
          transfer?.status === 'failed'
            ? {
                errorMessage: transfer.errorMessage ?? 'Download failed.',
                bytesDownloaded: transfer.bytesDownloaded,
                totalBytes: transfer.combinedTotalBytes || transfer.totalBytes,
                onRetry: () => act(() => modelDownloadService.retry(modelKey)),
                onRemove: () =>
                  act(() => modelDownloadService.remove(modelKey)),
              }
            : undefined
        }
      />
    );
  };

  const selectedCatalog = defaults.find(model => model.id === selected?.id);
  const selectedMemory = selectedCatalog?.minRamGb;
  return (
    <View style={styles.flex1}>
      {selected ? (
        <>
          <ScreenHeader title={videoModelDisplayName(selected.id, selected.name)} onBack={() => setSelected(null)} />
          <Card style={styles.modelInfoCard}>
            <Text style={styles.modelAuthor}>{selected.org}</Text>
            <Text style={styles.modelDescription}>
              Create short, silent videos from a description.
            </Text>
            {selectedMemory ? <Text style={styles.statText}>
              {selectedMemory} GB memory suggested{ramGB > 0 ? ` · This phone: ${Math.round(ramGB)} GB` : ''}
            </Text> : null}
            {selectedMemory && ramGB > 0 && ramGB < selectedMemory ?
              <Text style={styles.statText}>Local generation may exceed available memory.</Text> : null}
            {models.some(model => model.id === selected.id) ?
              <Text style={styles.statText}>Remove the installed version to change versions.</Text> : null}
          </Card>
          <Text style={styles.sectionTitle}>Available versions</Text>
          <Text style={styles.sectionSubtitle}>
            Download one version. The total includes all required files.
          </Text>
        </>
      ) : (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            accessibilityLabel="Search video models on Hugging Face"
            placeholder="Search Hugging Face"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
      )}
      <ScrollView
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {selected ? (
          <>
            {[...files]
              .sort((a, b) => {
                const primary = defaults
                  .find(m => m.id === selected.id)
                  ?.files.find(f => f.role === 'primary')?.name;
                return (
                  Number(b.fileName === primary) -
                    Number(a.fileName === primary) || a.sizeBytes - b.sizeBytes
                );
              })
              .map(file => renderCard(selected, file))}
            {!loading && files.length === 0 && (
              <Text style={styles.emptyText}>
                No supported versions found. Choose another video model.
              </Text>
            )}
          </>
        ) : (
          <>
            {rows.map(row => renderCard(row))}
            {!loading && query.trim() && rows.length === 0 && (
              <Text style={styles.emptyText}>
                No video models found. Try a different search.
              </Text>
            )}
          </>
        )}
        {loading && (
          <View style={styles.loadingContainer}>
            <LoadingDots />
          </View>
        )}
        {error && (
          <Text
            accessibilityRole="alert"
            style={[styles.loadingText, { color: colors.error }]}
          >
            {error}
          </Text>
        )}
      </ScrollView>
    </View>
  );
};
