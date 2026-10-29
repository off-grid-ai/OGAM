import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { RemoteModelServerGroup } from './RemoteModelServerGroup';
import { TYPOGRAPHY } from '../../constants';
import { ModelSwitchStopped, remoteServerManager } from '../../services/remoteServerManager';
import { remoteServerModelOptions } from '../../services/remoteModelSelection';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
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
  const groups = new Map<string, { serverName: string; options: typeof options }>();
  for (const option of options) {
    const group = groups.get(option.serverId) ?? { serverName: option.serverName, options: [] };
    group.options.push(option);
    groups.set(option.serverId, group);
  }

  const select = async (option: (typeof options)[number]) => {
    const key = `${option.serverId}:${option.id}`;
    setSelecting(key);
    setError(null);
    try {
      await remoteServerManager.setActiveRemoteMediaModel(option.serverId, category, option.id);
      onSelect?.();
    } catch (reason) {
      if (reason instanceof ModelSwitchStopped) return;
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
  };

  return (
    <View testID={`remote-${category}-models`}>
      {[...groups].map(([serverId, group]) => (
        <RemoteModelServerGroup
          key={serverId}
          serverName={group.serverName}
          disabled={selecting !== null}
          rows={group.options.map(option => {
            const key = `${option.serverId}:${option.id}`;
            return {
              id: option.id,
              testID: `remote-${category}-model-${key}`,
              model: {
                id: option.id,
                name: option.name,
                author: '',
                modelType: category === 'image' ? 'vision' : undefined,
              },
              isCurrent: option.serverId === activeServerId && option.id === activeModelId,
              isLoading: selecting === key,
              onPress: () => { select(option).catch(() => undefined); },
            };
          })}
        />
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  error: { ...TYPOGRAPHY.bodySmall, color: colors.error },
});
