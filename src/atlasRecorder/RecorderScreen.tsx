import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useWideLayout } from '../hooks/useWideLayout';
import { useRecordings, useRecorderLive } from './store';
import { recorderService } from './recorderService';
import { clock } from './transcript';
import { createStyles } from './RecorderScreen.styles';

/** Seconds since the recording started, updated every second while recording. */
function useElapsed(startedAt: number, running: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return running ? Math.max(0, (now - startedAt) / 1000) : 0;
}

const fail = (title: string) => (e: any) => Alert.alert(title, String(e?.message || e));

/**
 * Recorder: records a conversation with a visible indicator, then writes a transcript on
 * the phone with each speaker labelled. Nothing leaves the phone.
 */
export const RecorderScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const wide = useWideLayout();
  const consent = useRecordings((s) => s.consent);
  const recordings = useRecordings((s) => s.recordings);
  const { phase, startedAt, processingId, step, progress, speakerDownload } = useRecorderLive();
  const elapsed = useElapsed(startedAt, phase === 'recording');
  const [labelsReady, setLabelsReady] = useState<boolean | null>(null);
  useEffect(() => { recorderService.speakerModelsReady().then(setLabelsReady).catch(() => setLabelsReady(false)); }, [speakerDownload]);

  const stop = () => recorderService.stop()
    .then((id) => navigation.navigate('RecordingDetail', { id }))
    .catch(fail('Could not save the recording'));
  // The recording indicator lives on this screen, so leaving it means stopping first.
  const back = () => {
    if (phase !== 'recording') { navigation.goBack(); return; }
    Alert.alert('Stop recording?', 'Atlas only records while this screen is open.', [
      { text: 'Keep recording', style: 'cancel' },
      { text: 'Stop and save', onPress: () => { recorderService.stop().catch(fail('Could not save the recording')).finally(() => navigation.goBack()); } },
    ]);
  };
  // System Back (or the back gesture) while recording asks first, like the header arrow: leaving the
  // screen without it would keep the microphone on with nothing on screen to show it.
  useFocusEffect(React.useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase !== 'recording') return false;
      back();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]));
  const getLabels = () => recorderService.downloadSpeakerModels()
    .catch((e) => { if (!/cancel/i.test(String(e?.message))) fail('Download failed')(e); });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={back} style={styles.backButton} accessibilityLabel="Back">
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Recorder</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, wide.column]}>
        {!consent ? (
          <Card title="Before you record" testID="recorder-consent">
            <Text style={styles.body}>
              Tell everyone in the conversation that you are recording, and stop if anyone says no. Recording people
              without their agreement is against the law in many places.
            </Text>
            <Text style={styles.desc}>
              Recordings and transcripts are made and kept on this phone only. They are not sent anywhere and are not
              part of Atlas backups. Delete them here when you no longer need them.
            </Text>
            <View style={styles.actions}>
              <Button title="I will tell everyone" onPress={() => recorderService.acceptConsent()} testID="recorder-consent-accept" />
            </View>
          </Card>
        ) : (
          <Card title={phase === 'recording' ? undefined : 'Record a conversation'}>
            <View style={styles.recordRow}>
              {phase === 'recording' ? (
                <>
                  <View style={styles.indicator} testID="recording-indicator" accessibilityLiveRegion="polite">
                    <View style={styles.dot} />
                    <Text style={styles.indicatorText}>Recording {clock(elapsed)}</Text>
                  </View>
                  <TouchableOpacity style={styles.recordButton} onPress={stop} accessibilityLabel="Stop recording">
                    <Icon name="square" size={32} color={colors.background} />
                  </TouchableOpacity>
                  <Button title="Discard" variant="ghost" size="small" onPress={() => recorderService.discard()} />
                  <Text style={styles.meta}>Keep Atlas open while recording.</Text>
                </>
              ) : (
                <>
                  <TouchableOpacity style={styles.recordButton} disabled={phase !== 'idle'}
                    onPress={() => { recorderService.start().catch(fail('Could not start recording')); }} accessibilityLabel="Start recording">
                    <Icon name="mic" size={34} color={colors.background} />
                  </TouchableOpacity>
                  <Text style={styles.meta}>Tap to start. A transcript is written when you stop.</Text>
                  {recorderService.canImportFiles() && (
                    <Button title="Transcribe an audio or video file" variant="outline" size="small" disabled={phase !== 'idle'} testID="recorder-import"
                      onPress={() => { recorderService.importFile().then((id) => { if (id) navigation.navigate('RecordingDetail', { id }); }).catch(fail('Could not transcribe the file')); }} />
                  )}
                </>
              )}
            </View>
          </Card>
        )}

        {phase === 'processing' && (
          <Card title="Making the transcript" testID="recorder-processing">
            <View style={styles.progressRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.progressText}>{step}{progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}</Text>
            </View>
            <View style={styles.actions}>
              {processingId && <Button title="Open" size="small" variant="outline" onPress={() => navigation.navigate('RecordingDetail', { id: processingId })} />}
              <Button title="Stop" size="small" variant="ghost" onPress={() => { recorderService.cancelProcessing(); }} />
            </View>
          </Card>
        )}

        {recorderService.speakerLabelsAvailable() && labelsReady === false && (
          <Card title="Speaker labels" subtitle="One-time download, about 45 MB">
            <Text style={styles.desc}>
              Lets Atlas tell voices apart and label who said what. Without it you still get a transcript, with no names.
            </Text>
            <View style={styles.actions}>
              {speakerDownload !== null
                ? <Text style={styles.meta}>Downloading {Math.max(0, Math.round(speakerDownload * 100))}%</Text>
                : <Button title="Download speaker labels" variant="outline" onPress={getLabels} testID="recorder-get-labels" />}
            </View>
          </Card>
        )}

        {recordings.length > 0 && (
          <Card title="Recordings">
            {recordings.map((r) => (
              <TouchableOpacity key={r.id} style={styles.row} onPress={() => navigation.navigate('RecordingDetail', { id: r.id })}>
                <Icon name={r.status === 'failed' ? 'alert-circle' : 'file-text'} size={18} color={r.status === 'failed' ? colors.error : colors.primary} />
                <View style={styles.rowText}>
                  <Text style={styles.body}>{r.title}</Text>
                  <Text style={styles.meta}>
                    {clock(r.durationSec)}{r.status === 'processing' ? ' · making transcript' : r.status === 'failed' ? ' · transcript not finished' : ''}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};
