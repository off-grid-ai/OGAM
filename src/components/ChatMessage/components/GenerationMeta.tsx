import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { Message } from '../../../types';
import { useAccordionExpanded } from '../../../stores';
import { useTheme } from '../../../theme';

interface GenerationMetaProps {
  messageId: string;
  generationMeta: NonNullable<Message['generationMeta']>;
  styles: any;
  colors: ReturnType<typeof useTheme>['colors'];
}

type MetaItem = { key: string; label: string; maxLines?: number };

function formatOptionalMeta(meta: NonNullable<Message['generationMeta']>, tps: number | null | undefined): MetaItem[] {
  const m = meta;
  const contextLabel = m.contextPromptTokens
    ? m.contextWindowTokens
      ? `Context: ${m.contextEstimate ? '~' : ''}${Math.round((m.contextPromptTokens / m.contextWindowTokens) * 100)}% used`
      : `Context: ${m.contextEstimate ? '~' : ''}${m.contextPromptTokens} tokens used (limit unknown)`
    : undefined;
  const entries: Array<[string, string | undefined, number?]> = [
    ['context', contextLabel],
    ['model', m.modelName, 1],
    ['load', m.modelLoadTimeSeconds != null && m.modelLoadTimeSeconds > 0 ? `load ${m.modelLoadTimeSeconds.toFixed(1)}s` : undefined],
    ['prefill', m.prefillTokensPerSecond != null && m.prefillTokensPerSecond > 0 ? `prefill ${m.prefillTokensPerSecond.toFixed(0)} tok/s` : undefined],
    ['tps', tps != null && tps > 0 ? `${tps.toFixed(1)} tok/s` : undefined],
    ['ttft', m.timeToFirstToken != null && m.timeToFirstToken > 0 ? `TTFT ${m.timeToFirstToken.toFixed(2)}s` : undefined],
    ['tokens', m.tokenCount != null && m.tokenCount > 0 ? `${m.tokenCount} tokens` : undefined],
    ['steps', m.steps == null ? undefined : `${m.steps} steps`],
    ['cfg', m.guidanceScale == null ? undefined : `cfg ${m.guidanceScale}`],
    ['res', m.resolution],
    ['cache', m.cacheType ? `KV ${m.cacheType}` : undefined],
  ];
  return entries
    .filter((e): e is [string, string, number?] => e[1] != null)
    .map(([key, label, maxLines]) => ({ key, label, maxLines }));
}

function buildMetaItems(
  meta: NonNullable<Message['generationMeta']>,
  tps: number | null | undefined,
): MetaItem[] {
  const layers = meta.gpuLayers != null && meta.gpuLayers > 0 ? ` (${meta.gpuLayers}L)` : '';
  const backend = meta.gpuBackend || (meta.gpu ? 'GPU' : 'CPU');
  return [
    { key: 'backend', label: `${backend}${layers}` },
    ...formatOptionalMeta(meta, tps),
  ];
}

export function GenerationMeta({ messageId, generationMeta, styles, colors }: Readonly<GenerationMetaProps>) {
  const [expanded, toggle] = useAccordionExpanded(`generation-meta:${messageId}`);
  const rawTps = generationMeta.decodeTokensPerSecond ?? generationMeta.tokensPerSecond;
  const tps = rawTps && rawTps > 0 ? rawTps : undefined;
  const items = buildMetaItems(generationMeta, tps);

  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.generationMetaContainer}>
      <View style={[styles.toolRow, styles.messageFooterRow]}>
        <TouchableOpacity
          testID="generation-details-toggle"
          accessibilityRole="button"
          accessibilityLabel="Generation details"
          accessibilityState={{ expanded }}
          style={[styles.toolStatusRow, styles.messageFooterHeader]}
          onPress={toggle}
          activeOpacity={0.6}
        >
          <Icon name="activity" size={13} color={colors.textMuted} />
          <Text style={[styles.toolStatusText, { flex: 0, flexShrink: 1 }]}>Generation details</Text>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} />
        </TouchableOpacity>
        {expanded && (
          <View style={styles.toolDetailContainer}>
            <View testID="generation-meta" style={styles.generationMetaRow}>
              {items.map((item, index) => (
                <React.Fragment key={item.key}>
                  {index > 0 && <Text style={styles.generationMetaSep}>·</Text>}
                  <Text style={styles.generationMetaText} numberOfLines={item.maxLines}>
                    {item.label}
                  </Text>
                </React.Fragment>
              ))}
            </View>
          </View>
        )}
      </View>
    </Animated.View>
  );
}
