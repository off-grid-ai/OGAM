import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useAppStore } from '../stores/appStore';
import { useChatStore } from '../stores/chatStore';
import { shouldSuggestTuning, useSlowHint, useSpeedStats, useTuned } from '../atlasTools/speed';
import { slowCause, type SlowCause } from '../atlasTools/slowCause';
import { hardwareService } from '../services/hardware';
import { vulkanEngine } from '../services/vulkanEngine';
import { localGpuInfo } from '../services/engines';

/**
 * One line above the message box when this model has been slow on a few replies. It says WHY when the settings show it
 * (the GPU is slower than the CPU here, or too many threads) with a one-tap fix, and otherwise offers the settings test.
 * Goes away once the model was tuned, or when dismissed.
 */
export const SlowReplyHint: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const modelId = useAppStore((s) => s.downloadedModels.find((m) => m.id === s.activeModelId && m.engine === 'llama')?.id ?? null);
  const speed = useSpeedStats((s) => (modelId ? s.byModel[modelId] : undefined));
  const tuned = useTuned((s) => !!(modelId && s.at[modelId]));
  const dismissed = useSlowHint((s) => !!(modelId && s.off[modelId]));
  const busy = useChatStore((s) => s.isStreaming || s.isThinking);
  const threads = useAppStore((s) => s.settings.nThreads ?? 0);
  const backend = useAppStore((s) => s.settings.inferenceBackend);
  const [cause, setCause] = useState<SlowCause | null>(null);
  const show = !busy && !!modelId && shouldSuggestTuning({ modelId, speed, tuned, dismissed });

  useEffect(() => {
    if (!show) return;
    let live = true;
    Promise.all([vulkanEngine.isSlowTextGpu(), hardwareService.getRecommendedThreadCount()]).then(([slowGpu, recommendedThreads]) => {
      const gpu = localGpuInfo();
      if (live) setCause(slowCause({ gpuOn: gpu.gpu, gpuBackend: gpu.gpuBackend, slowGpu, threads, recommendedThreads }));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [show, threads, backend]);

  if (!show) return null;
  const fix = cause?.action;
  return (
    <View style={styles.row} testID="slow-reply-hint">
      <Icon name="zap" size={11} color={colors.textMuted} />
      <Text style={[styles.text, { color: colors.textMuted }]}>Replies are slow here ({speed!.decode.toFixed(1)} tok/s){cause ? `: ${cause.text}.` : '.'}</Text>
      {!!fix && (
        <TouchableOpacity onPress={() => { useAppStore.getState().updateSettings(fix.patch); setCause(null); }} accessibilityLabel={fix.label} testID="slow-reply-hint-fix">
          <Text style={[styles.text, { color: colors.primary }]}>{fix.label}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={() => navigation.navigate('ModelTest', { modelId })} accessibilityLabel="Find faster settings for this model">
        <Text style={[styles.text, { color: colors.primary }]}>Find faster settings</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => useSlowHint.getState().dismiss(modelId!)} accessibilityLabel="Hide this tip" testID="slow-reply-hint-dismiss">
        <Icon name="x" size={12} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', paddingVertical: 3, paddingHorizontal: 12, gap: 6 },
  text: { fontSize: 11 },
});
