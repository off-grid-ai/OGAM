/**
 * Ambient recorder — a capture + transcription probe for the 24/7 recorder's first device test.
 *
 * Deliberately minimal: start continuous capture, talk, and watch each detected speech segment appear
 * live. On stop it runs one on-device transcription pass over the just-finished recording and fills in
 * the text per segment — the whole phone-leg pipeline (mic → VAD → slice → whisper) end to end on real
 * hardware, before the shipping timeline UX is built. Not the shipping surface; a probe.
 */

import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { createAmbientRecorder } from '../services/ambient/ambientRecorderFactory';
import {
  createDefaultPhoneSttExecutor,
  ensureAmbientSliceDir
} from '../services/ambient/phoneSttExecutorFactory';
import {
  probeTranscribeSegments,
  type ProbeSegmentResult
} from '../services/ambient/ambientCaptureSession';
import { segmentId } from '../services/ambient/ambientStore';
import { mobileSpeechInputPorts } from '../services/adapters/speech/mobileSpeechInputPorts';
import type { AmbientRecorder } from '../services/ambient/ambientRecorder';
import type { SpeechSegment } from '../services/ambient/vadSegmenter';

type Phase = 'idle' | 'recording' | 'transcribing';

export function AmbientScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation();
  const recorderRef = useRef<AmbientRecorder | null>(null);
  const segmentsRef = useRef<SpeechSegment[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [segments, setSegments] = useState<SpeechSegment[]>([]);
  const [records, setRecords] = useState<Record<string, ProbeSegmentResult>>({});
  const [capture, setCapture] = useState<{ path: string; durationSeconds: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setSegments([]);
    setRecords({});
    setCapture(null);
    segmentsRef.current = [];
    const recorder = createAmbientRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start(segment => {
        segmentsRef.current = [...segmentsRef.current, segment];
        setSegments(prev => [...prev, segment]);
      });
      setPhase('recording');
    } catch (e) {
      recorderRef.current = null;
      setError(e instanceof Error ? e.message : 'Could not start recording.');
    }
  }, []);

  const stop = useCallback(async () => {
    let result: { path: string; durationSeconds: number } | null = null;
    try {
      result = (await recorderRef.current?.stop()) ?? null;
    } finally {
      recorderRef.current = null;
    }
    const captured = segmentsRef.current;
    if (!result || captured.length === 0) {
      setPhase('idle');
      return;
    }
    // Transcription runs through the shared speech port (on-device or remote). If nothing is set up,
    // say so instead of leaving every segment untranscribed.
    if (!mobileSpeechInputPorts.transcriber.ready()) {
      setError('Set up a transcription model in Models, then record again.');
      setPhase('idle');
      return;
    }
    setPhase('transcribing');
    try {
      await ensureAmbientSliceDir();
      setCapture(result);
      const probed = await probeTranscribeSegments(
        captured,
        result.path,
        createDefaultPhoneSttExecutor()
      );
      const byId: Record<string, ProbeSegmentResult> = {};
      for (const record of probed) byId[record.id] = record;
      setRecords(byId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed.');
    } finally {
      setPhase('idle');
    }
  }, []);

  const recording = phase === 'recording';
  const transcribing = phase === 'transcribing';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Ambient recorder" onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        <Text style={styles.hint}>
          Start capture and talk. Each detected speech segment appears below; on stop it is transcribed
          on-device. This is the phone-leg pipeline - mic, voice-activity, slice, whisper - before the
          timeline UX.
        </Text>
        <Button
          title={recording ? 'Stop' : transcribing ? 'Transcribing…' : 'Start recording'}
          variant={recording ? 'danger' : 'primary'}
          onPress={recording ? stop : start}
          disabled={transcribing}
          testID="ambient-toggle"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.count} testID="ambient-count">
          {segments.length} segment{segments.length === 1 ? '' : 's'}
          {recording ? ' · listening' : transcribing ? ' · transcribing' : ''}
        </Text>
        {capture ? (
          <Text style={styles.diag} testID="ambient-capture-info">
            Capture: {formatSeconds(capture.durationSeconds * 1000)} · …{capture.path.slice(-28)}
          </Text>
        ) : null}
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {segments.map((segment, index) => {
            const record = records[segmentId(segment)];
            return (
              <View key={`${segment.startMs}-${index}`} style={styles.row} testID="ambient-segment">
                <Text style={styles.rowTitle}>Segment {index + 1}</Text>
                <Text style={styles.rowMeta}>
                  {formatSeconds(segment.startMs)} → {formatSeconds(segment.endMs)} ·{' '}
                  {formatSeconds(segment.endMs - segment.startMs)} long
                </Text>
                {record?.transcript ? (
                  <Text style={styles.rowText} testID="ambient-transcript">
                    {record.transcript}
                  </Text>
                ) : record?.error ? (
                  <Text style={styles.rowError} testID="ambient-segment-error">
                    {record.error}
                  </Text>
                ) : transcribing ? (
                  <Text style={styles.rowPending}>transcribing…</Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function createStyles(colors: {
  background: string;
  text: string;
  textMuted: string;
  surface: string;
  border: string;
  error: string;
  primary: string;
}) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    body: { flex: 1, paddingHorizontal: 16, gap: 12 },
    hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
    error: { color: colors.error, fontSize: 13 },
    count: { color: colors.text, fontSize: 13, fontWeight: '600' },
    list: { flex: 1 },
    listContent: { gap: 8, paddingBottom: 24 },
    row: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      gap: 4
    },
    rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
    rowMeta: { color: colors.textMuted, fontSize: 12 },
    rowText: { color: colors.text, fontSize: 13, lineHeight: 18, marginTop: 4 },
    rowError: { color: colors.error, fontSize: 12, lineHeight: 16, marginTop: 4 },
    rowPending: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic', marginTop: 4 },
    diag: { color: colors.textMuted, fontSize: 11 }
  });
}
