/**
 * Replay — hear a conversation again, transcript alongside.
 *
 * OGAD replays captured screen frames; on the phone we replay the audio. The conversation's span is
 * carved out of the day's capture (prepareReplayClip) and played through the shared audio engine. The
 * player is native and device-verified separately; this screen prepares the clip and drives it.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore';
import { replaySourceForSession } from '../services/ambient/replayClip';
import { prepareReplayClipForSource, ensureReplayDir } from '../services/ambient/replayClipFactory';
import { useAudioClipPlayer } from '../hooks/useAudioClipPlayer';
import type { RootStackParamList } from '../navigation/types';

function clock(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AmbientReplayScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'AmbientReplay'>>();
  const sessionId = route.params?.sessionId;
  const session = useAmbientTimelineStore(s => s.sessions.find(item => item.id === sessionId));

  const [clipPath, setClipPath] = useState<string | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const source = session ? replaySourceForSession(session) : null;

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    ensureReplayDir()
      .then(() => prepareReplayClipForSource(source))
      .then(path => {
        if (cancelled) return;
        if (path) setClipPath(path);
        else setPrepError('The audio for this conversation is no longer available.');
      })
      .catch(() => !cancelled && setPrepError('Could not prepare the audio.'));
    return () => {
      cancelled = true;
    };
  }, [source?.recordingPath, source?.startMs]);

  const player = useAudioClipPlayer(clipPath);
  const flagged = new Set(session?.flaggedSegmentIds ?? []);
  const spoken = (session?.segments ?? []).filter(s => s.transcript);
  const error = prepError ?? player.error;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={session ? session.summary.title : 'Replay'}
        onBack={() => navigation.goBack()}
      />
      {!session ? (
        <View style={styles.missing}>
          <Text style={styles.missingText}>This conversation is no longer available.</Text>
        </View>
      ) : !source ? (
        <View style={styles.missing}>
          <Text style={styles.missingText}>No audio was kept for this conversation.</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <Text style={styles.sub}>{clock(session.startMs)}</Text>
          <View style={styles.playRow}>
            <TouchableOpacity
              style={[styles.playBtn, !player.ready && styles.playBtnDisabled]}
              onPress={player.toggle}
              disabled={!player.ready}
              testID="ambient-replay-play"
            >
              <Icon name={player.playing ? 'pause' : 'play'} size={26} color={colors.background} />
            </TouchableOpacity>
            <Text style={styles.playState}>
              {error ? error : !player.ready ? 'Loading audio…' : player.playing ? 'Playing' : 'Play the conversation'}
            </Text>
          </View>

          <Text style={styles.eyebrow}>Transcript</Text>
          {spoken.length === 0 ? (
            <Text style={styles.muted}>No transcript for this conversation.</Text>
          ) : (
            spoken.map(segment =>
              flagged.has(segment.id) ? (
                <View key={segment.id} style={styles.flaggedLine} testID="ambient-replay-line">
                  <Text style={styles.flaggedMark}>▎</Text>
                  <Text style={styles.flaggedText}>{segment.transcript}</Text>
                </View>
              ) : (
                <Text key={segment.id} style={styles.line} testID="ambient-replay-line">
                  {segment.transcript}
                </Text>
              )
            )
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: {
  background: string;
  text: string;
  textMuted: string;
  textSecondary: string;
  surface: string;
  border: string;
  primary: string;
}) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    body: { flex: 1 },
    bodyContent: { padding: 18 },
    sub: { color: colors.textMuted, fontSize: 12, marginBottom: 20 },
    playRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 28 },
    playBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    playBtnDisabled: { opacity: 0.4 },
    playState: { color: colors.textSecondary, fontSize: 13, flex: 1 },
    eyebrow: { color: colors.textMuted, fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: '700', marginBottom: 12 },
    muted: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
    line: { color: colors.textSecondary, fontSize: 13, lineHeight: 21, marginBottom: 6 },
    flaggedLine: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 6 },
    flaggedMark: { color: colors.primary, fontSize: 15, lineHeight: 21 },
    flaggedText: { color: colors.text, fontSize: 13, lineHeight: 21, flex: 1, fontWeight: '500' },
    missing: { padding: 24 },
    missingText: { color: colors.textMuted, fontSize: 14 }
  });
}
