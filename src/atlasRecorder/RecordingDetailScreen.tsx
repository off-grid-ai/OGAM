import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useWideLayout } from '../hooks/useWideLayout';
import { useProjectStore } from '../stores/projectStore';
import { useRecordings, useRecorderLive } from './store';
import { recorderService } from './recorderService';
import { clock, speakerName } from './transcript';
import { createStyles } from './RecordingDetailScreen.styles';

const PEOPLE = [0, 2, 3, 4, 5, 6];
const fail = (title: string) => (e: any) => Alert.alert(title, String(e?.message || e));

/** One recording's transcript: who said what, speaker names, corrections, and saving it to a project. */
export const RecordingDetailScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { id } = useRoute<any>().params as { id: string };
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const wide = useWideLayout();
  const rec = useRecordings((s) => s.recordings.find((r) => r.id === id));
  const live = useRecorderLive();
  const projects = useProjectStore((s) => s.projects);
  const [people, setPeople] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  if (!rec) return null;

  const busy = live.processingId === id;
  const speakers = [...new Set((rec.utterances ?? []).map((u) => u.speaker))].sort((a, b) => a - b);
  const nextSpeaker = (cur: number) => {
    const all = speakers.length ? speakers : [0];
    const pool = [...all, Math.max(...all) + 1];
    return pool[(pool.indexOf(cur) + 1) % pool.length];
  };
  const remove = () => Alert.alert('Delete this recording?', 'The audio and transcript are removed from this phone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => { recorderService.remove(id).then(() => navigation.goBack()); } },
  ]);
  const saved = (name: string | null) => { if (name) Alert.alert('Saved', `Saved as ${name}.`); };
  const save = (projectId: string) => recorderService.saveToProject(id, projectId)
    .then(() => { setSaveOpen(false); Alert.alert('Saved', 'Every chat in that project can now read this transcript.'); })
    .catch(fail('Could not save'));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Back">
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>Transcript</Text>
        <TouchableOpacity onPress={remove} style={styles.backButton} accessibilityLabel="Delete recording">
          <Icon name="trash-2" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={[styles.content, wide.column]}>
        <Card>
          <TextInput defaultValue={rec.title} onEndEditing={(e) => recorderService.rename(id, e.nativeEvent.text)}
            style={styles.titleInput} testID="recording-title" />
          <Text style={[styles.meta, styles.actions]}>{new Date(rec.createdAt).toLocaleString()} · {clock(rec.durationSec)}</Text>
          {busy && (
            <View style={styles.progressRow} testID="recording-processing">
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.progressText}>{live.step}{live.progress > 0 ? ` ${Math.round(live.progress * 100)}%` : ''}</Text>
            </View>
          )}
          {rec.status === 'failed' && !busy && (
            <>
              <Text style={styles.error}>{rec.error}</Text>
              <View style={styles.actions}>
                <Button title="Try again" size="small" onPress={() => { recorderService.process(id).catch(fail('Could not make the transcript')); }} />
              </View>
            </>
          )}
          {rec.status === 'done' && !rec.labelled && (
            <Text style={styles.desc}>No speaker labels: download them on the Recorder screen, then tap "Label speakers" below.</Text>
          )}
        </Card>

        {rec.status === 'done' && speakers.length > 0 && rec.labelled && (
          <Card title="Speakers" subtitle="Name each voice. Tap a name in the transcript to fix who said it.">
            {speakers.map((s) => (
              <View key={s} style={styles.speakerRow}>
                <Text style={styles.speakerLabel}>Speaker {s + 1}</Text>
                <TextInput defaultValue={rec.speakerNames?.[s] ?? ''} placeholder="Name" placeholderTextColor={colors.textMuted}
                  onEndEditing={(e) => recorderService.nameSpeaker(id, s, e.nativeEvent.text)} style={styles.nameInput} testID={`speaker-name-${s}`} />
              </View>
            ))}
          </Card>
        )}

        {rec.status === 'done' && rec.segments && (
          <Card title={rec.labelled ? 'Wrong number of people?' : 'Label speakers'} subtitle="Tell Atlas how many people talked, then label again.">
            <View style={styles.chips}>
              {PEOPLE.map((n) => (
                <TouchableOpacity key={n} onPress={() => setPeople(n)} style={[styles.chip, people === n && styles.chipOn]}>
                  <Text style={people === n ? styles.chipTextOn : styles.chipText}>{n === 0 ? 'Let Atlas decide' : `${n} people`}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.actions}>
              <Button title="Label speakers again" size="small" variant="outline" disabled={!!live.processingId}
                onPress={() => { recorderService.process(id, people).catch(fail('Could not label speakers')); }} testID="recording-relabel" />
            </View>
          </Card>
        )}

        {!!rec.utterances?.length && (
          <Card title="Transcript" testID="recording-transcript">
            {rec.utterances.map((u, i) => (
              <View key={`${i}-${u.start}`} style={styles.utterance}>
                <View style={styles.utteranceHead}>
                  <TouchableOpacity disabled={!rec.labelled} onPress={() => recorderService.setSpeaker(id, i, nextSpeaker(u.speaker))}>
                    <Text style={styles.speakerLabel}>{rec.labelled ? speakerName(rec.speakerNames, u.speaker) : 'Transcript'}</Text>
                  </TouchableOpacity>
                  <Text style={styles.meta}>{clock(u.start)}</Text>
                </View>
                <Text style={styles.body}>{u.text}</Text>
              </View>
            ))}
            <View style={styles.actions}>
              <Button title="Share transcript" variant="outline" size="small" testID="recording-share"
                onPress={() => { recorderService.shareTranscript(id).catch(fail('Could not share')); }} />
              <Button title="Download transcript" variant="outline" size="small" testID="recording-download-text"
                onPress={() => { recorderService.saveTranscript(id).then(saved).catch(fail('Could not save')); }} />
              <Button title="Save to a project" variant="outline" size="small" onPress={() => setSaveOpen(!saveOpen)} testID="recording-save" />
              {saveOpen && (
                <View style={styles.chips}>
                  {projects.map((p) => (
                    <TouchableOpacity key={p.id} onPress={() => { save(p.id); }} style={styles.chip}>
                      <Text style={styles.chipText}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {!projects.length && <Text style={styles.meta}>Make a project first.</Text>}
                </View>
              )}
            </View>
          </Card>
        )}
        {rec.status === 'done' && !rec.utterances?.length && <Text style={styles.desc}>No speech was found in this recording.</Text>}
        <Button title="Download the audio" variant="ghost" size="small" testID="recording-download-audio"
          onPress={() => { recorderService.saveAudio(id).then(saved).catch(fail('Could not save the audio')); }} />
        <Text style={styles.meta}>Recordings stay in Atlas's private storage and are not in backups. Download one to keep a copy.</Text>
      </ScrollView>
    </SafeAreaView>
  );
};
