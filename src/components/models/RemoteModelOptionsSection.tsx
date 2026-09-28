import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { ModelCard } from '../ModelCard';
import { LoadingDots } from '../LoadingDots';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { remoteServerManager } from '../../services/remoteServerManager';
import { remoteServerModelOptions } from '../../services/remoteModelSelection';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import type { RemoteModelCategory } from '../../types';

interface Props {
  category: Exclude<RemoteModelCategory, 'text'>;
  onSelect?: () => void;
}

function isTransportFailure(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  return reason.name === 'AbortError' ||
    /network request failed|failed to fetch|fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i.test(reason.message);
}

/** Shared remote rows for image, transcription, and voice model pickers. */
export const RemoteModelOptionsSection: React.FC<Props> = ({
  category,
  onSelect,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const servers = useRemoteServerStore(state => state.servers);
  const activeServerId = useRemoteServerStore(
    state => state.activeRemoteMediaServerIds[category] ?? null,
  );
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(
    () => remoteServerModelOptions(servers, category),
    [servers, category],
  );
  if (options.length === 0) return null;

  const activeServer = servers.find(server => server.id === activeServerId);
  const activeModelId = activeServer?.mediaModels?.[category];

  return (
    <View style={styles.section} testID={`remote-${category}-models`}>
      <Text style={styles.sectionLabel}>Remote models</Text>
      {options.map(option => {
        const active =
          option.serverId === activeServerId && option.id === activeModelId;
        const key = `${option.serverId}:${option.id}`;
        return (
          <ModelCard
            key={key}
            compact
            testID={`remote-${category}-model-${key}`}
            model={{
              id: option.id,
              name: option.name,
              author: option.serverName,
              modelType: category === 'image' ? 'vision' : undefined,
            }}
            sourceBadge="Remote"
            facts={[
              category === 'video'
                ? 'Video'
                : category === 'transcription'
                  ? 'Transcription'
                  : category === 'voice'
                    ? 'Voice'
                    : 'Image',
            ]}
            isActive={active}
            trailing={
              selecting === key ? (
                <LoadingDots color={colors.primary} />
              ) : active ? (
                <Icon name="check" size={16} color={colors.primary} />
              ) : null
            }
            disabled={selecting !== null}
            onPress={async () => {
              setSelecting(key);
              setError(null);
              try {
                await remoteServerManager.setActiveRemoteMediaModel(
                  option.serverId,
                  category,
                  option.id,
                );
                onSelect?.();
              } catch (reason) {
                if (option.serverId === activeServerId && option.id === activeModelId) return;
                const serverName = servers.find(server => server.id === option.serverId)?.name ?? 'Remote server';
                setError(
                  isTransportFailure(reason)
                    ? `Could not reach ${serverName}. Models on this phone still work. Check the server address and network.`
                    : reason instanceof Error
                      ? reason.message
                      : 'The remote model could not be selected.',
                );
              } finally {
                setSelecting(null);
              }
            }}
          />
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  section: { gap: SPACING.sm as number },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  row: {
    ...shadows.small,
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
