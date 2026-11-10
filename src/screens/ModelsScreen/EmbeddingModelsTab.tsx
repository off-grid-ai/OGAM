import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Button, ModelCard } from '../../components';
import { CustomAlert, initialAlertState, showAlert, hideAlert } from '../../components/CustomAlert';
import { searchEmbeddingModels, RECOMMENDED_EMBEDDING_MODELS } from '../../services/huggingFaceModelBrowser';
import { embeddingModelChanger } from '../../services/documents/embeddingModel';
import { embeddingService } from '../../services/rag/embedding';
import { activeEmbeddingModel, type EmbeddingModelSelection } from '../../services/documents/store';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { createStyles } from './styles';
import { cardSurface } from '../../theme/surface';
import { SearchField } from '../../components/SearchField';
import { GROUPED_CARD_ROW, ListGroup } from '../../components/ListGroup';

type Candidate = Awaited<ReturnType<typeof searchEmbeddingModels>>[number];

const createEmbeddingStyles = (colors: ThemeColors) => ({
  // On the glass, not on the dots: a paragraph outside a card read through the lattice (Mac, 2026-11-08).
  introCard: {
    ...cardSurface(colors),
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  intro: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  // The same section label as the Text tab ("FOR THIS PHONE"): Mono, upper case, grey.
  sectionLabel: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
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

/** Which language a search model is for, when its name or description says. */
function languageFact(candidate: Candidate): string | undefined {
  if (candidate.name.toLowerCase().includes('multilingual')) return 'Multilingual';
  const description = 'description' in candidate && typeof candidate.description === 'string' ? candidate.description : '';
  if (description.includes('English')) return 'English';
  return undefined;
}

export const EmbeddingModelsTab: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const embeddingStyles = useThemedStyles(createEmbeddingStyles);
  const { colors } = useTheme();
  const status = useSyncExternalStore(embeddingModelChanger.subscribe, embeddingModelChanger.getChange);
  const [active, setActive] = useState<EmbeddingModelSelection | null>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [alert, setAlert] = useState(initialAlertState);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  // The failed row whose file is being removed: it shows that it is working, and offers neither Retry
  // (an install could start while the file is deleted) nor a second Remove until it is done.
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(new Set());
  const removing = (id: string, on: boolean) => setRemovingIds(previous => {
    const next = new Set(previous);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  useEffect(() => {
    try {
      setActive(activeEmbeddingModel());
      setReady(true);
    } catch (e) {
      setError(String((e as Error).message));
    }
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
      `Use ${candidate?.name ?? 'MiniLM (built-in)'} for search? Your documents stay in place and update as you use them. If the change fails, the current model stays active.`,
    ].filter(Boolean).join('\n\n');
    setAlert(showAlert('Switch search model?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Switch', onPress: () => {
        setError('');
        // A failed change reports on its row (status.error); nothing more to show here.
        embeddingModelChanger.install(candidate).catch(() => undefined);
      } },
    ]));
  };
  const candidates = query.trim() ? results : RECOMMENDED_EMBEDDING_MODELS;
  // Which of these are already on the phone, so they can be deleted when not in use.
  useEffect(() => {
    let current = true;
    Promise.all(candidates.map(async candidate => ((await embeddingService.hasModelFile(candidate)) ? candidate.id : null)))
      .then(ids => { if (current) setDownloaded(new Set(ids.filter((id): id is string => !!id))); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [candidates, status.busy]);
  const remove = (candidate: Candidate) => {
    setAlert(showAlert('Delete search model?', `Delete ${candidate.name} from this phone?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        embeddingService.deleteModelFile(candidate)
          .then(() => setDownloaded(previous => { const next = new Set(previous); next.delete(candidate.id); return next; }))
          .catch(e => setError(String(e.message)));
      } },
    ]));
  };
  const removeFailed = (candidate: Candidate) => {
    const forget = () => setDownloaded(previous => { const next = new Set(previous); next.delete(candidate.id); return next; });
    // Removes the final file and any partial one whatever their size: hasModelFile says no to a file
    // of the wrong size, which is the one a failed check leaves.
    const deleteIfThere = async () => {
      if (active?.id === candidate.id) return;
      await embeddingService.deleteModelFile(candidate);
      forget();
    };
    // The failure clears only once the file is gone; a delete that fails keeps it, with the reason.
    removing(candidate.id, true);
    deleteIfThere()
      // Only this model's failure: another change may have started and failed while the disk was slow.
      .then(() => { if (embeddingModelChanger.getChange().candidateId === candidate.id) embeddingModelChanger.dismiss(); })
      .catch(e => setError(String(e.message)))
      .finally(() => removing(candidate.id, false));
  };
  const activeInCandidates = active && candidates.some(candidate => candidate.id === active.id);
  // A change in progress shows once: on the row of the model being fetched, with its own cancel, as in
  // every model list. The line under the search field is only for a change with no row on screen
  // (Mac, 2026-11-08: a second loader sat under the search bar, out of line with the list).
  const changeRow = status.busy ? candidates.find(candidate => candidate.id === status.candidateId) : undefined;
  const failedRow = !status.busy && status.error ? candidates.find(candidate => candidate.id === status.candidateId) : undefined;
  // The row's right-hand mark: working while its file is removed; nothing where the row shows its own
  // state (in use, downloading, failed); else what a tap does (a circle picks it, a mark downloads it).
  const trailingFor = (candidate: Candidate) => {
    if (removingIds.has(candidate.id)) {
      return <View style={embeddingStyles.rowAction}><ActivityIndicator size="small" color={colors.textMuted} accessibilityLabel="Removing" /></View>;
    }
    if (active?.id === candidate.id || changeRow === candidate || failedRow === candidate) return undefined;
    return <View style={embeddingStyles.rowAction}><Icon name={downloaded.has(candidate.id) ? 'circle' : 'download'} size={16} color={colors.textMuted} /></View>;
  };

  return (
    <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" testID="embedding-models-tab">
      {/* What this is for, before any model name: the reader gets the outcome first. */}
      <View style={embeddingStyles.introCard}>
        <Text style={embeddingStyles.intro}>
          When you add documents to a project, chat finds the passages that answer you. This model does
          the finding, on this phone. The built-in one needs no download.
        </Text>
      </View>
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Search models"
        clearLabel="Clear model search"
        testID="embedding-search-input"
      />
      {!!status.message && !changeRow && <Text style={embeddingStyles.status} accessibilityLiveRegion="polite" testID="embedding-index-progress">{status.message}</Text>}
      {!!error && <Text style={embeddingStyles.error} accessibilityRole="alert">{error}</Text>}
      {/* A failed change whose row a search has hidden shows here, with its own Dismiss. */}
      {!failedRow && !status.busy && !!status.error && (
        <>
          <Text style={embeddingStyles.error} accessibilityRole="alert">{status.error}</Text>
          <Button title="Dismiss" onPress={embeddingModelChanger.dismiss} testID="embedding-error-dismiss" />
        </>
      )}
      {status.busy && !changeRow && <Button title="Cancel model change" onPress={embeddingModelChanger.cancel} />}
      {loading && <Text style={embeddingStyles.status} aria-busy>Searching...</Text>}
      {!loading && query.trim() !== '' && !error && results.length === 0 && <Text style={embeddingStyles.status}>No models found. Try another name.</Text>}
      <Text style={embeddingStyles.sectionLabel}>{query.trim() ? 'Models' : 'Recommended'}</Text>
      {/* One surface with hairlines, as every model list. */}
      <ListGroup>
      <ModelCard compact style={GROUPED_CARD_ROW}
        model={{ id: 'bundled', name: 'MiniLM (built-in)', author: '' }}
        facts={['Offline']}
        isDownloaded isActive={!active}
        disabled={status.busy || !ready || !active}
        onPress={() => select(null)}
        // An empty circle picks it, as on the Text tab; a bare arrow did not say what it would do.
        trailing={active ? <View style={embeddingStyles.rowAction}><Icon name="circle" size={16} color={colors.textMuted} /></View> : undefined}
      />
      {active && !activeInCandidates && <ModelCard compact style={GROUPED_CARD_ROW}
        model={{ id: active.id, name: active.name, author: '' }}
        facts={[`${Math.round(active.size / 1024 / 1024)} MB`]}
        isDownloaded isActive
      />}
      {candidates.map(candidate => (
        <ModelCard key={candidate.id} compact style={GROUPED_CARD_ROW}
          model={{ id: candidate.id, name: candidate.name, author: '' }}
          facts={[
            languageFact(candidate),
            // A model already here has a size, not a download.
            `${Math.round(candidate.size / 1024 / 1024)} MB${downloaded.has(candidate.id) ? '' : ' download'}`,
          ].filter((fact): fact is string => !!fact)}
          isActive={active?.id === candidate.id}
          isDownloaded={downloaded.has(candidate.id)}
          isDownloading={changeRow === candidate}
          downloadProgress={changeRow === candidate ? status.fraction : undefined}
          onCancel={changeRow === candidate ? embeddingModelChanger.cancel : undefined}
          failedState={failedRow === candidate && !removingIds.has(candidate.id) ? {
            errorMessage: status.error, bytesDownloaded: 0, totalBytes: 0,
            onRetry: () => { embeddingModelChanger.retry().catch(() => undefined); },
            // "Remove download" also deletes a file that arrived but failed its check, asked of the disk
            // when pressed (the downloaded list may not have caught up). The failure stays until it is done.
            onRemove: () => { removeFailed(candidate); },
          } : undefined}
          onDelete={downloaded.has(candidate.id) && active?.id !== candidate.id && !status.busy ? () => remove(candidate) : undefined}
          // Not while its file is removed: a switch then could start an install the delete would remove.
          disabled={status.busy || !ready || active?.id === candidate.id || removingIds.has(candidate.id)}
          onPress={() => select(candidate)}
          trailing={trailingFor(candidate)}
        />
      ))}
      </ListGroup>
      <CustomAlert {...alert} onClose={() => setAlert(hideAlert())} />
    </ScrollView>
  );
};
