import React, { useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { ModelCard } from '../ModelCard';
import { useTheme } from '../../theme';
import { embeddingModelChanger } from '../../services/documents/embeddingModel';
import { activeEmbeddingModel } from '../../services/documents/store';
import { RECOMMENDED_EMBEDDING_MODELS } from '../../services/huggingFaceModelBrowser';

const BUILT_IN = 'MiniLM (built-in)';

function currentModel() {
  try {
    return activeEmbeddingModel();
  } catch {
    return null;
  }
}

/** The search model for documents: built-in, or one of the recommended downloads. */
export function SearchTab({ onSelect }: { onSelect: () => void }) {
  const { colors } = useTheme();
  const change = useSyncExternalStore(embeddingModelChanger.subscribe, embeddingModelChanger.getChange);
  const active = currentModel();
  const choose = (candidate: (typeof RECOMMENDED_EMBEDDING_MODELS)[number] | null) => {
    embeddingModelChanger.install(candidate).catch(() => undefined);
    onSelect();
  };
  const others = active && !RECOMMENDED_EMBEDDING_MODELS.some(model => model.id === active.id) ? [active] : [];
  return (
    <>
      {change.message || change.error ? (
        <Text style={{ color: change.error ? colors.error : colors.textSecondary }} accessibilityLiveRegion="polite">
          {change.error || change.message}
        </Text>
      ) : null}
      <ModelCard
        compact
        model={{ id: 'bundled', name: BUILT_IN, author: '' }}
        facts={['Offline']}
        isDownloaded
        isActive={!active}
        disabled={change.busy || !active}
        onSelect={() => choose(null)}
      />
      {others.map(model => (
        <ModelCard key={model.id} compact model={{ id: model.id, name: model.name, author: '' }} isDownloaded isActive />
      ))}
      {RECOMMENDED_EMBEDDING_MODELS.map(model => (
        <ModelCard
          key={model.id}
          compact
          model={{ id: model.id, name: model.name, author: '' }}
          facts={[`${Math.round(model.size / 1024 / 1024)} MB`]}
          isActive={active?.id === model.id}
          isDownloading={change.busy && change.candidateId === model.id}
          downloadProgress={change.busy && change.candidateId === model.id ? change.fraction : undefined}
          disabled={change.busy || active?.id === model.id}
          onSelect={() => choose(model)}
        />
      ))}
    </>
  );
}
