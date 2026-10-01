import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Button, ModelCard } from '../../components';
import { CustomAlert, initialAlertState, showAlert, hideAlert } from '../../components/CustomAlert';
import { searchEmbeddingModels, RECOMMENDED_EMBEDDING_MODELS } from '../../services/huggingFaceModelBrowser';
import { ragService } from '../../services/rag';
import { ragDatabase, type EmbeddingModelSelection } from '../../services/rag/database';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { createStyles } from './styles';

type Candidate = Awaited<ReturnType<typeof searchEmbeddingModels>>[number];

const createEmbeddingStyles = (colors: ThemeColors) => ({
  sectionLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  searchInput: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    backgroundColor: colors.surfaceLight,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.sm,
  },
  rowAction: {
    minWidth: SPACING.xl,
    minHeight: SPACING.xl,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  status: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: SPACING.sm,
  },
  error: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.error,
    marginBottom: SPACING.sm,
  },
});

export const EmbeddingModelsTab: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const embeddingStyles = useThemedStyles(createEmbeddingStyles);
  const { colors } = useTheme();
  const status = useSyncExternalStore(ragService.subscribeEmbeddingChange, ragService.getEmbeddingChange);
  const [active, setActive] = useState<EmbeddingModelSelection | null>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [alert, setAlert] = useState(initialAlertState);

  useEffect(() => {
    let current = true;
    ragDatabase.ensureReady().then(() => {
      if (current) { setActive(ragDatabase.getEmbeddingModel()); setReady(true); }
    }).catch(e => { if (current) setError(String(e.message)); });
    return () => { current = false; };
  }, [status.busy]);

  useEffect(() => {
    const controller = new AbortController();
    setResults([]);
    setError('');
    if (!query.trim()) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      searchEmbeddingModels(query, controller.signal)
        .then(rows => { if (!controller.signal.aborted) setResults(rows); })
        .catch(e => { if (!controller.signal.aborted) setError(String(e.message)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  const select = (candidate: Candidate | null) => {
    const description = candidate && 'description' in candidate ? candidate.description : '';
    const message = [
      description,
      `Use ${candidate?.name ?? 'MiniLM (built-in)'} and rebuild search? Keep the app open. Your documents stay in place. If the change fails, the current model and index stay active.`,
    ].filter(Boolean).join('\n\n');
    setAlert(showAlert('Switch search model?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Switch and rebuild', onPress: () => {
        setError('');
        ragService.installEmbeddingModel(candidate).catch(e => setError(String(e.message)));
      } },
    ]));
  };
  const candidates = query.trim() ? results : RECOMMENDED_EMBEDDING_MODELS;
  const activeInCandidates = active && candidates.some(candidate => candidate.id === active.id);

  return (
    <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" testID="embedding-models-tab">
      <TextInput
        style={embeddingStyles.searchInput} value={query} onChangeText={setQuery}
        placeholder="Search embedding models" placeholderTextColor={colors.textMuted}
        accessibilityLabel="Search Hugging Face embedding models" autoCapitalize="none" autoCorrect={false}
        testID="embedding-search-input"
      />
      {!!status.message && <Text style={embeddingStyles.status} accessibilityLiveRegion="polite" testID="embedding-index-progress">{status.message}</Text>}
      {!!(status.error || error) && <Text style={embeddingStyles.error} accessibilityRole="alert">{status.error || error}</Text>}
      {status.busy && <Button title="Cancel model change" onPress={ragService.cancelEmbeddingChange} />}
      {loading && <Text style={embeddingStyles.status}>Searching...</Text>}
      {!loading && query.trim() !== '' && !error && results.length === 0 && <Text style={embeddingStyles.status}>No models found. Try another name.</Text>}
      <Text style={embeddingStyles.sectionLabel}>{query.trim() ? 'MODELS' : 'RECOMMENDED MODELS'}</Text>
      <ModelCard compact
        model={{ id: 'bundled', name: 'MiniLM (built-in)', author: '' }}
        facts={['Offline']}
        isDownloaded isActive={!active}
        disabled={status.busy || !ready || !active}
        onPress={() => select(null)}
        trailing={active ? <View style={embeddingStyles.rowAction}><Icon name="arrow-right" size={18} color={colors.primary} /></View> : undefined}
      />
      {active && !activeInCandidates && <ModelCard compact
        model={{ id: active.id, name: active.name, author: '' }}
        facts={[`${Math.round(active.size / 1024 / 1024)} MB`]}
        isDownloaded isActive
      />}
      {candidates.map(candidate => (
        <ModelCard key={candidate.id} compact
          model={{ id: candidate.id, name: candidate.name, author: '' }}
          facts={[
            candidate.name.toLowerCase().includes('multilingual') ? 'Multilingual' :
              'description' in candidate && candidate.description?.includes('English') ? 'English' : undefined,
            `${Math.round(candidate.size / 1024 / 1024)} MB download`,
          ].filter((fact): fact is string => !!fact)}
          isActive={active?.id === candidate.id}
          disabled={status.busy || !ready || active?.id === candidate.id}
          onPress={() => select(candidate)}
          trailing={active?.id === candidate.id ? undefined : <View style={embeddingStyles.rowAction}><Icon name="arrow-right" size={18} color={colors.primary} /></View>}
        />
      ))}
      <CustomAlert {...alert} onClose={() => setAlert(hideAlert())} />
    </ScrollView>
  );
};
