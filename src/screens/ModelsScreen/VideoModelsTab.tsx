import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import {
  CATALOG,
  searchHuggingFace,
  getModelFiles,
  resolveHuggingFaceModel,
  formatFileSize,
  determineCredibility,
} from '@offgrid/models';
import type { HFSearchResult, ModelFileVariant } from '@offgrid/models';
import { Button, ModelCard } from '../../components';
import { LoadingDots } from '../../components/LoadingDots';
import { useAppStore } from '../../stores';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useDownloadStore } from '../../stores/downloadStore';
import { modelDownloadService } from '../../services/modelDownloadService';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';

export const VideoModelsTab: React.FC = () => {
  const styles = useThemedStyles(createStyles),
    { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HFSearchResult[]>([]);
  const [selected, setSelected] = useState<HFSearchResult | null>(null);
  const [files, setFiles] = useState<ModelFileVariant[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const loading = selected ? filesLoading : searchLoading;
  const [error, setError] = useState<string | null>(null);
  const models = useAppStore(s => s.downloadedVideoModels);
  const active = useAppStore(s => s.activeVideoModelId);
  const downloads = useDownloadStore(s => s.downloads);
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
    : defaults.map(m => ({ id: m.id, name: m.name, org: m.org ?? '' }));
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      {selected ? (
        <>
          <Button
            title="Back to video models"
            variant="ghost"
            onPress={() => setSelected(null)}
          />
          <Text style={{ color: colors.text }}>{selected.name}</Text>
          <Text style={{ color: colors.textSecondary }}>
            Each download includes the required text encoder and VAE.
          </Text>
          {!loading && files.length === 0 && (
            <Text style={{ color: colors.textMuted }}>
              No files in this repository are supported by this build. Local
              generation currently requires Wan 2.1 T2V 1.3B.
            </Text>
          )}
          {files.map(file => (
            <Button
              key={file.fileName}
              title={`${file.fileName} · ${formatFileSize(file.sizeBytes)}`}
              variant="outline"
              disabled={
                !!downloads[`video:${selected.id}`] ||
                models.some(model => model.id === selected.id)
              }
              onPress={() => download(file.fileName)}
            />
          ))}
        </>
      ) : (
        <>
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              accessibilityLabel="Search video models on Hugging Face"
              placeholder="Search Hugging Face"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
            />
          </View>
          {rows.map(row => {
            const catalogEntry = defaults.find(model => model.id === row.id);
            const installed = models.some(m => m.id === row.id),
              transfer = downloads[`video:${row.id}`];
            return (
              <ModelCard
                key={row.id}
                model={{ id: row.id, name: row.name, author: row.org }}
                facts={
                  catalogEntry?.availabilityNote
                    ? [catalogEntry.availabilityNote]
                    : undefined
                }
                isDownloaded={installed}
                isActive={active === row.id}
                isDownloading={transfer?.status === 'running'}
                isPaused={transfer?.status === 'paused'}
                isQueued={transfer?.status === 'pending'}
                downloadProgress={transfer?.progress}
                onPress={() =>
                  setSelected({
                    ...row,
                    credibility: determineCredibility(row.org),
                  })
                }
                onDownload={
                  catalogEntry?.availability === 'coming_soon'
                    ? undefined
                    : () =>
                        setSelected({
                          ...row,
                          credibility: determineCredibility(row.org),
                        })
                }
                onSelect={
                  installed
                    ? () => {
                        useAppStore.getState().setActiveVideoModelId(row.id);
                        useRemoteServerStore
                          .getState()
                          .setActiveRemoteMediaServerId('video', null);
                      }
                    : undefined
                }
                onDelete={
                  installed
                    ? () =>
                        act(() =>
                          modelDownloadService.remove(`video:${row.id}`),
                        )
                    : undefined
                }
                onPause={
                  transfer?.status === 'running'
                    ? () =>
                        act(() => modelDownloadService.pause(`video:${row.id}`))
                    : undefined
                }
                onResume={
                  transfer?.status === 'paused'
                    ? () =>
                        act(() =>
                          modelDownloadService.resume(`video:${row.id}`),
                        )
                    : undefined
                }
                onCancel={
                  transfer
                    ? () =>
                        act(() =>
                          modelDownloadService.cancel(`video:${row.id}`),
                        )
                    : undefined
                }
                failedState={
                  transfer?.status === 'failed'
                    ? {
                        errorMessage:
                          transfer.errorMessage ?? 'Download failed.',
                        bytesDownloaded: transfer.bytesDownloaded,
                        totalBytes: transfer.totalBytes,
                        onRetry: () =>
                          act(() =>
                            modelDownloadService.retry(`video:${row.id}`),
                          ),
                        onRemove: () =>
                          act(() =>
                            modelDownloadService.remove(`video:${row.id}`),
                          ),
                      }
                    : undefined
                }
              />
            );
          })}
          {!loading && query.trim() && rows.length === 0 && (
            <Text style={{ color: colors.textMuted }}>
              No compatible video repositories found.
            </Text>
          )}
        </>
      )}
      {loading && <LoadingDots />}
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
    </ScrollView>
  );
};
