import React, { useRef, useState } from 'react';
import { Clipboard, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { useAppStore } from '../stores/appStore';
import { Button } from './Button';
import { runModelSweep } from '../services/gpuDiagnostics';
import type { LlamaDownloadedModel } from '../types';

/**
 * "Test GPU on this model" (Settings > About). The service does the work; this shows what it reports. The test loads the
 * selected model several times, so it says so first, and it can be stopped between steps.
 */
export const ModelGpuTest: React.FC = () => {
  const { colors } = useTheme();
  // Any downloaded GGUF model can be tested, loaded or not: a model whose GPU load is refused could not otherwise be selected.
  const downloaded = useAppStore((s) => s.downloadedModels);
  const models = React.useMemo(() => downloaded.filter((m) => m.engine === 'llama') as LlamaDownloadedModel[], [downloaded]);
  const activeId = useAppStore((s) => s.activeModelId);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const model = models.find((m) => m.id === pickedId) ?? models.find((m) => m.id === activeId) ?? models.find((m) => /gemma-?4/i.test(m.fileName)) ?? models[0];
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const stop = useRef(false);
  if (Platform.OS !== 'android') return null;

  const start = async () => {
    if (!model) return;
    stop.current = false; setRunning(true); setLines([]); setReport(null); setCopied(false);
    try {
      const result = await runModelSweep(model, { onProgress: (line) => setLines((l) => [...l, line]), shouldStop: () => stop.current });
      setReport(result.report);
    } catch (e: any) {
      setReport(`The test could not finish: ${String(e?.message || e)}`);
    }
    setRunning(false);
  };

  return (
    <View style={[styles.box, { borderColor: colors.border }]} testID="model-gpu-test">
      <Text style={[styles.title, { color: colors.text }]}>Test GPU on this model</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {model
          ? `Loads ${model.fileName} on the CPU and on the GPU with 24, 16 and 8 layers (flash attention on and off), 2,048 tokens of context, f16 cache, and checks that it writes real words each time. Then it checks pictures with the model's picture file. It takes several minutes and uses a lot of memory; the model is unloaded when it ends.`
          : 'Download a GGUF model first.'}
      </Text>
      {models.length > 1 && !running && models.map((m) => (
        <TouchableOpacity key={m.id} onPress={() => setPickedId(m.id)} testID={`model-gpu-test-pick-${m.id}`}
          style={[styles.pick, { borderColor: m.id === model?.id ? colors.primary : colors.border }]}>
          <Text style={[styles.body, { color: m.id === model?.id ? colors.primary : colors.textSecondary }]}>{m.fileName}</Text>
        </TouchableOpacity>
      ))}
      {!running
        ? <Button title="Run the test" onPress={start} disabled={!model} testID="model-gpu-test-run" />
        : <Button title="Stop after this step" variant="outline" onPress={() => { stop.current = true; }} testID="model-gpu-test-stop" />}
      {lines.map((l, i) => <Text key={`${i}-${l}`} style={[styles.line, { color: colors.textMuted }]}>{l}</Text>)}
      {report && (
        <>
          <Text style={[styles.report, { color: colors.text }]} selectable testID="model-gpu-test-report">{report}</Text>
          <Button title={copied ? 'Copied' : 'Copy the report'} variant="outline" testID="model-gpu-test-copy"
            onPress={() => { Clipboard.setString(report); setCopied(true); }} />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  box: { borderWidth: 1, padding: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.md, gap: SPACING.sm },
  title: { ...TYPOGRAPHY.body },
  body: { ...TYPOGRAPHY.meta },
  line: { ...TYPOGRAPHY.meta },
  report: { ...TYPOGRAPHY.meta },
  pick: { borderWidth: 1, padding: SPACING.sm },
});
