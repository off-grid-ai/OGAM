import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { FadeInImage } from './ChatMessage/components/MessageAttachments';
import { videoGenerationService } from '../services/videoGenerationService';
import { useTheme } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';

/** Inline status below the pending reply. The composer owns Stop. */
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
  const [now, setNow] = useState(Date.now);
  const running =
    state.phase === 'running' && state.conversationId === conversationId;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, state.startedAt]);
  if (state.phase !== 'running' || state.conversationId !== conversationId)
    return null;
  const samplingFinished =
    state.progress && state.progress.step >= state.progress.total;
  const label =
    state.error
      ? `${state.error} Waiting for the video engine to stop.`
      : state.stage === 'enhancing'
      ? 'Preparing prompt'
      : state.stage === 'preparing'
      ? 'Loading video model'
      : state.stage === 'conditioning'
      ? state.backend === 'npu'
        ? 'Processing prompt (NPU preferred)'
        : state.backend === 'cpu'
        ? 'Processing prompt on CPU'
        : 'Processing prompt'
      : state.stage === 'encoding'
      ? 'Saving video'
      : state.stage === 'decoding' || samplingFinished
      ? 'Decoding video frames'
      : 'Generating video';
  const steps =
    !state.error && state.stage === 'generating' && state.progress && !samplingFinished
      ? ` · Step ${state.progress.step} of ${state.progress.total}`
      : state.stage === 'decoding' && state.progress
      ? ` · Section ${state.progress.step} of ${state.progress.total} complete`
      : '';
  const seconds = Math.max(
    0,
    Math.floor((now - (state.startedAt ?? now)) / 1000),
  );
  const elapsed = `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
  return (
    <View style={{ marginHorizontal: SPACING.lg, marginBottom: SPACING.sm }}>
      {state.preview && (
        <View style={{ marginBottom: SPACING.sm }}>
          <FadeInImage
            key={state.preview.path}
            uri={`file://${state.preview.path}`}
            imageStyle={{
              width: '100%',
              aspectRatio: state.preview.width / state.preview.height,
            }}
            accessibilityLabel="First decoded video frame"
          />
        </View>
      )}
      <Text
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${label}${steps}`}
        style={{
          ...TYPOGRAPHY.bodySmall,
          color: colors.textSecondary,
        }}
      >
        {label}
        {steps}
        {` · ${elapsed}`}
      </Text>
    </View>
  );
}
