import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedPressable } from '../AnimatedPressable';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { modelsFailureMessage, remoteServerModelOptions } from '@offgrid/application';
import { applicationFacade } from '../../services/applicationFacade';
import { useModelsProjection } from '../../hooks/useApplicationProjection';
import { useActiveMobileModel } from '../../hooks/useActiveMobileModel';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import type { RemoteModelCategory } from '../../types';

interface Props {
  category: Exclude<RemoteModelCategory, 'text'>;
  onSelect?: () => void;
}

/** Shared remote rows for image, transcription, and voice model pickers. */
/**
 * You should read what happened and what still works, not a transport error. The device name is
 * the one you gave it; local models keep working while it is away.
 */
export function remoteSelectionFailureText(serverName: string, reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  if (
    /network request failed|failed to fetch|unreachable|not connected|econn|enotfound|timed? ?out|offline|socket/i.test(
      message,
    )
  ) {
    return `${serverName} can't be reached right now. Models on this phone keep working.`;
  }
  return message || `${serverName} could not take this model right now.`;
}

export const RemoteModelOptionsSection: React.FC<Props> = ({
  category,
  onSelect,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const servers = useModelsProjection().servers;
  const activeRoute = useActiveMobileModel(category).model;
  const activeServerId = activeRoute?.source === 'remote'
    ? activeRoute.serverId ?? null
    : null;
  const activeModelId = activeRoute?.source === 'remote'
    ? activeRoute.id
    : null;
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(
    () => remoteServerModelOptions(servers, category),
    [servers, category],
  );
  if (options.length === 0) return null;

  return (
    <View style={styles.section} testID={`remote-${category}-models`}>
      <Text style={styles.sectionLabel}>Remote models</Text>
      {options.map(option => {
        const active =
          option.serverId === activeServerId && option.id === activeModelId;
        const key = `${option.serverId}:${option.id}`;
        return (
          <AnimatedPressable
            key={key}
            testID={`remote-${category}-model-${key}`}
            style={[styles.row, active && styles.rowActive]}
            hapticType="selection"
            disabled={selecting !== null}
            onPress={async () => {
              setSelecting(key);
              setError(null);
              try {
                const routeId = applicationFacade().models.remoteModelRoute(
                  option.serverId,
                  option.id,
                  category,
                );
                if (!routeId) {
                  throw new Error('The selected server model is unavailable.');
                }
                const selected = await applicationFacade().models.select({
                  modality: category,
                  modelId: routeId,
                });
                if (!selected.ok) {
                  throw new Error(modelsFailureMessage(selected.failure));
                }
                onSelect?.();
              } catch (reason) {
                setError(remoteSelectionFailureText(option.serverName, reason));
              } finally {
                setSelecting(null);
              }
            }}
          >
            <Icon
              name="cloud"
              size={14}
              color={active ? colors.primary : colors.textMuted}
            />
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={1}>
                {option.name}
              </Text>
              <Text style={styles.serverName} numberOfLines={1}>
                {option.serverName}
              </Text>
            </View>
            {active ? (
              <Icon name="check" size={16} color={colors.primary} />
            ) : null}
          </AnimatedPressable>
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  section: { gap: SPACING.sm as number },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowActive: { borderColor: colors.primary },
  info: { flex: 1, gap: 2 as number },
  name: { ...TYPOGRAPHY.body, color: colors.text },
  serverName: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  error: { ...TYPOGRAPHY.bodySmall, color: colors.error },
});
