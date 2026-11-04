import React, { useRef, useState } from 'react';
import { Clipboard, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  const [expected, setExpected] = useState('');
  const model = models.find((m) => m.id === pickedId) ?? models.find((m) => m.id === activeId) ?? models.find((m) => /gemma-?4/i.test(m.fileName)) ?? models[0];
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const stop = useRef(false);
  // The checksum or link last given for this file is remembered, so it is there next time.
  const fileName = model?.fileName;
  React.useEffect(() => {
    if (!fileName) return;
    AsyncStorage.getItem(EXPECTED_KEY).then((raw) => setExpected((JSON.parse(raw ?? '{}') as Record<string, string>)[fileName] ?? '')).catch(() => setExpected(''));
  }, [fileName]);
  const rememberExpected = (value: string) => {
    setExpected(value);
    if (!fileName) return;
    AsyncStorage.getItem(EXPECTED_KEY).then((raw) => AsyncStorage.setItem(EXPECTED_KEY, JSON.stringify({ ...JSON.parse(raw ?? '{}'), [fileName]: value }))).catch(() => undefined);
  };
  if (Platform.OS !== 'android') return null;

  const start = async () => {
    if (!model) return;
    stop.current = false; setRunning(true); setLines([]); setReport(null); setCopied(false);
    try {
      const result = await runModelSweep(model, { expected, onProgress: (line) => setLines((l) => [...l, line]), shouldStop: () => stop.current });
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
          ? `First checks ${model.fileName} against its published checksum (a minute or two). Then loads it on the CPU three ways, on the GPU with 24, 16 and 8 layers, and on the GPU with the prompt fed one token at a time (2,048 tokens of context, f16 cache), asks each a simple sum and checks the answer, tries the MTP file if one is attached, and last checks pictures with the model's picture file. It takes several minutes and uses a lot of memory; the model is unloaded when it ends.`
          : 'Download a GGUF model first.'}
      </Text>
      <TextInput value={expected} onChangeText={rememberExpected} editable={!running} autoCapitalize="none" autoCorrect={false}
        placeholder="Checksum (SHA-256) or download link, optional" placeholderTextColor={colors.textMuted} testID="model-gpu-test-expected"
        style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
      <Text style={[styles.line, { color: colors.textMuted }]}>Paste the SHA-256 from the download page, or the Hugging Face link you downloaded from, and the file is checked against it.</Text>
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

const EXPECTED_KEY = 'atlas-model-expected-checksums';

const styles = StyleSheet.create({
  box: { borderWidth: 1, padding: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.md, gap: SPACING.sm },
  title: { ...TYPOGRAPHY.body },
  body: { ...TYPOGRAPHY.meta },
  line: { ...TYPOGRAPHY.meta },
  report: { ...TYPOGRAPHY.meta },
  input: { borderWidth: 1, padding: SPACING.sm, ...TYPOGRAPHY.meta },
  pick: { borderWidth: 1, padding: SPACING.sm },
});
