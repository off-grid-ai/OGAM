import React from 'react';
import { View, Text } from 'react-native';
import { TouchableOpacity } from '../../Touchable';
import Animated, { FadeIn } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { Message } from '../../../types';
import { useAccordionExpanded } from '../../../stores';
import { useTheme } from '../../../theme';
import { toolDisplayName } from '../../../services/tools/toolDisplayName';

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
      ? `${m.contextEstimate ? '~' : ''}${Math.round((m.contextPromptTokens / m.contextWindowTokens) * 100)}% of its memory used`
      : `${m.contextEstimate ? '~' : ''}${m.contextPromptTokens} tokens of memory used`
    : undefined;
  const entries: Array<[string, string | undefined, number?]> = [
    ['context', contextLabel],
    ['model', m.modelName, 1],
    ['load', m.modelLoadTimeSeconds != null && m.modelLoadTimeSeconds > 0 ? `loaded in ${m.modelLoadTimeSeconds.toFixed(1)}s` : undefined],
    ['prefill', m.prefillTokensPerSecond != null && m.prefillTokensPerSecond > 0 ? `read your message at ${m.prefillTokensPerSecond.toFixed(0)} tok/s` : undefined],
    ['tps', tps != null && tps > 0 ? `wrote at ${tps.toFixed(1)} tok/s` : undefined],
    ['ttft', m.timeToFirstToken != null && m.timeToFirstToken > 0 ? `first word in ${m.timeToFirstToken.toFixed(2)}s` : undefined],
    ['tokens', m.tokenCount != null && m.tokenCount > 0 ? `${m.tokenCount} tokens` : undefined],
    ['steps', m.steps == null ? undefined : `${m.steps} steps`],
    ['cfg', m.guidanceScale == null ? undefined : `cfg ${m.guidanceScale}`],
    ['res', m.resolution],
    ['frames', m.frames == null ? undefined : `${m.frames} frames`],
    ['fps', m.fps == null ? undefined : `${m.fps} fps`],
    ['seed', m.seed == null ? undefined : `seed ${m.seed}`],
    ['cache', m.cacheType ? `memory cache ${m.cacheType}` : undefined],
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
  const backend = meta.gpuBackend || (meta.gpu === undefined ? undefined : meta.gpu ? 'GPU' : 'CPU');
  return [
    ...(backend ? [{ key: 'backend', label: `${backend}${layers}` }] : []),
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
          <Text style={[styles.toolStatusText, styles.toolStatusTextCompact]}>Generation details</Text>
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

const turnDetailsKey = (messageId: string) => `turn-details:${messageId}`;

/**
 * "Details" in the time row. One quiet word instead of two full-width rows under every reply
 * ("Tools it could use", "Generation details"; hand test 64). Its panel is TurnDetails below.
 */
export function TurnDetailsToggle({ messageId, styles, colors }: Readonly<{ messageId: string; styles: any; colors: ReturnType<typeof useTheme>['colors'] }>) {
  const [expanded, toggle] = useAccordionExpanded(turnDetailsKey(messageId));
  return (
    <TouchableOpacity
      testID="generation-details-toggle"
      accessibilityRole="button"
      accessibilityLabel="Details"
      accessibilityState={{ expanded }}
      style={styles.detailsToggle}
      onPress={toggle}
      activeOpacity={0.6}
    >
      <Text style={styles.timestamp}>Details</Text>
      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

/** What the time row's "Details" opens, on a quiet surface: how the reply was made, then the tools it was offered. */
export function TurnDetails({ messageId, generationMeta, toolNames, styles }: Readonly<{
  messageId: string;
  generationMeta?: Message['generationMeta'];
  toolNames?: string[];
  styles: any;
}>) {
  const [expanded] = useAccordionExpanded(turnDetailsKey(messageId));
  if (!expanded) return null;
  const rawTps = generationMeta?.decodeTokensPerSecond ?? generationMeta?.tokensPerSecond;
  const items = generationMeta ? buildMetaItems(generationMeta, rawTps && rawTps > 0 ? rawTps : undefined) : [];
  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.turnDetails}>
      {items.length > 0 && (
        <Text testID="generation-meta" style={styles.generationMetaText}>
          {items.map(item => item.label).join(' · ')}
        </Text>
      )}
      {toolNames?.length ? (
        <Text testID="tools-sent-list" style={styles.generationMetaText}>
          {`Tools it had for this reply: ${toolNames.map(toolDisplayName).join(', ')}`}
        </Text>
      ) : null}
    </Animated.View>
  );
}
