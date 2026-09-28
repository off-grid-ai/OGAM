import React, { useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { videoGenerationService } from '../services/videoGenerationService';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme';
export function VideoGenerationStatus({
  conversationId,
}: {
  conversationId?: string | null;
}) {
  const state = useSyncExternalStore(
    videoGenerationService.subscribe,
    videoGenerationService.getState,
  );
  const { colors } = useTheme();
  if (conversationId && state.conversationId !== conversationId) return null;
  if (state.phase === 'failed')
    return (
      <Card title="Video generation stopped">
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {state.error}
        </Text>
        <Button
          title="Retry"
          variant="secondary"
          onPress={() => {
            void videoGenerationService.retry().catch(() => {});
          }}
        />
      </Card>
    );
  if (state.phase !== 'running') return null;
  return (
    <Card
      title={
        state.stage === 'encoding'
          ? 'Encoding video'
          : state.stage === 'preparing'
            ? 'Loading video model'
            : 'Generating video'
      }
    >
      {state.progress && (
        <Text style={{ color: colors.text }}>
          {state.progress.step} / {state.progress.total}
        </Text>
      )}
      <Button
        title="Stop"
        variant="secondary"
        onPress={() => {
          void videoGenerationService.cancelGeneration();
        }}
      />
    </Card>
  );
}
