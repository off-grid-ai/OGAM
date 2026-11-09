import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { Button, Card } from '../components';
import { useWideLayout } from '../hooks/useWideLayout';
import { useStudyStore, type StudyResult } from '../study/engine';
import { BRIEF_PROJECT, makeBriefing, parseInterests, todayKey, useBriefPrefs } from '../atlasTools/dailyBrief';
import { AVOID_SUGGESTIONS } from '../atlasTools/newsSources';
import { useStoryReview } from './BriefStorySheet';
import { listVoices, keepScreenOn } from '../atlasVoice/tts';
import { createStyles } from './DailyBriefScreen.styles';
import { PodcastVoicePicker } from '../components/PodcastVoicePicker';
import { ForceLoadModel } from '../components/ForceLoadModel';

const EMPTY: never[] = [];
const LENGTHS = [3, 5, 10, 15];
const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Progress while today's briefing is being made: current step, steps done, time so far. */
function useBriefingJob(voices: number, onDone: (r: StudyResult) => void) {
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);
  useEffect(() => {
    if (!step) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [step]);
  const start = async () => {
    if (step) return;
    started.current = Date.now();
    setElapsed(0); setDone([]); setError(null); setStep('Starting...');
    keepScreenOn(true);
    try {
      const r = await makeBriefing((m) => setStep((prev) => {
        // Keep the finished steps visible under the current one.
        if (prev && prev !== 'Starting...' && prev !== m) setDone((d) => [...d, prev].slice(-6));
        return m;
      }), voices);
      onDone(r);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally { setStep(null); keepScreenOn(false); }
  };
  return { step, done, error, elapsed, start };
}

/** A short spoken news show about your interests, made from real headlines of the day. */
export const DailyBriefScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  // On the bottom bar it is a tab page (no back arrow); from the Atlas hub it is a pushed page.
  const asTab = useRoute().name === 'BriefTab';
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const wide = useWideLayout();
  const prefs = useBriefPrefs();
  const list = useStudyStore((s) => s.saved[BRIEF_PROJECT]) || EMPTY;
  const remove = useStudyStore((s) => s.remove);
  const today = list.find((r) => todayKey(new Date(r.createdAt)) === todayKey());
  const review = useStoryReview(today);
  const [say, setSay] = useState('');
  const [avoidText, setAvoidText] = useState('');
  const [voices, setVoices] = useState(0);
  useEffect(() => { listVoices('en').then((v) => setVoices(v.length)).catch(() => undefined); }, []);
  const open = (at: number) => navigation.navigate('Study', { projectId: BRIEF_PROJECT, openAt: at });
  const job = useBriefingJob(voices, (r) => open(r.createdAt));

  const addInterests = () => {
    const found = parseInterests(say);
    if (!found.length) return;
    const have = new Set(prefs.interests.map((x) => x.toLowerCase()));
    prefs.setInterests([...prefs.interests, ...found.filter((f) => !have.has(f.toLowerCase()))].slice(0, 12));
    setSay('');
  };
  const addAvoid = () => {
    const found = parseInterests(avoidText);
    if (!found.length) return;
    const have = new Set(prefs.avoid.map((x) => x.toLowerCase()));
    prefs.set({ avoid: [...prefs.avoid, ...found.filter((f) => !have.has(f.toLowerCase()))].slice(0, 20) });
    setAvoidText('');
  };
  const confirmDelete = (r: StudyResult) => Alert.alert('Delete this briefing?', r.title, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => remove(BRIEF_PROJECT, r.createdAt) },
  ]);
  const chip = (on: boolean) => [styles.chip, on && styles.chipOn];
  const chipText = (on: boolean) => (on ? styles.chipTextOn : styles.chipText);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        {!asTab && (
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityLabel="Back">
            <Icon name="arrow-left" size={20} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={styles.title}>Daily briefing</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, wide.column]} keyboardShouldPersistTaps="handled">
        <Card
          title={today ? today.title : "Today's news, read to you"}
          subtitle={[new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), today?.minutes && `about ${today.minutes} min`].filter(Boolean).join(' · ')}
          testID="brief-today-card"
        >
          {!today && (
            <Text style={styles.desc}>
              Real headlines from the last two days on your interests, one story at a time, with the outlet named.
              Press releases and ads are left out. With no internet you get an offline edition from your library.
            </Text>
          )}
          {job.step ? (
            <View testID="brief-progress">
              <View style={styles.progressRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.progressText}>{job.step}</Text>
                <Text style={styles.meta}>{fmtElapsed(job.elapsed)}</Text>
              </View>
              {job.done.map((d, i) => (
                <View key={`${i}-${d}`} style={styles.doneStep}>
                  <Icon name="check" size={14} color={colors.textMuted} />
                  <Text style={styles.meta} numberOfLines={1}>{d}</Text>
                </View>
              ))}
              <Text style={styles.desc}>This takes a few minutes on a phone. Keep Atlas open.</Text>
            </View>
          ) : (
            <View style={styles.actions}>
              {today && <Button title="Listen to today's briefing" onPress={() => open(today.createdAt)} icon={<Icon name="play" size={16} color={colors.background} />} testID="brief-listen" />}
              <Button
                title={today ? 'Make a fresh one' : "Make today's briefing"}
                variant={today ? 'outline' : 'primary'}
                onPress={job.start}
                testID="brief-make"
              />
            </View>
          )}
          {!!job.error && <Text style={styles.error}>{job.error}</Text>}
        </Card>

        {!!today?.headlines?.length && (
          <Card title="Today's headlines" subtitle="The stories this briefing was made from. Tap one to read it." testID="brief-headlines">
            {today.headlines.map((h, i) => (
              <TouchableOpacity key={`${i}-${h.title}`} style={styles.headline} disabled={!h.url} onPress={() => h.url && Linking.openURL(h.url)}>
                <View style={styles.headlineText}>
                  <Text style={styles.body}>{h.title}</Text>
                  <Text style={styles.meta}>
                    {[h.source, h.interest, h.date && new Date(h.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {!!h.url && <Icon name="external-link" size={16} color={colors.textMuted} />}
                <TouchableOpacity onPress={() => review.open(i)} testID={`brief-notforme-${i}`} accessibilityLabel={`Not for me: ${h.title}`} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="eye-off" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </Card>
        )}

        {review.element}

        <ForceLoadModel testID="brief-force-load" />

        <Card title="Your interests" subtitle="Broad ones (U.S., world, business, tech, science, health, sports) use top-story sections; anything else is searched.">
          <View style={styles.chips}>
            {prefs.interests.map((it) => (
              <TouchableOpacity key={it} onPress={() => prefs.setInterests(prefs.interests.filter((x) => x !== it))} style={chip(false)} accessibilityLabel={`Remove ${it}`}>
                <Text style={styles.chipText}>{it}</Text>
                <Icon name="x" size={13} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
            {!prefs.interests.length && <Text style={styles.meta}>None yet. Add some below.</Text>}
          </View>
          <TextInput value={say} onChangeText={setSay} onSubmitEditing={addInterests} returnKeyType="done"
            placeholder="e.g. United States, international news, the Chicago Bears"
            placeholderTextColor={colors.textMuted} multiline blurOnSubmit style={styles.input} testID="brief-interest-input" />
          <View style={styles.actions}>
            <Button title="Add" size="small" variant="secondary" onPress={addInterests} disabled={!say.trim()} />
          </View>
          <Text style={styles.meta}>Your interests are sent as search words to Google News and Bing News. Everything else stays on the phone.</Text>
        </Card>

        <Card title="Topics to avoid" subtitle="Stories about these are left out, even inside your interests.">
          <View style={styles.chips}>
            {prefs.avoid.map((it) => (
              <TouchableOpacity key={it} onPress={() => prefs.set({ avoid: prefs.avoid.filter((x) => x !== it) })} style={chip(false)} accessibilityLabel={`Stop avoiding ${it}`}>
                <Text style={styles.chipText}>{it}</Text>
                <Icon name="x" size={13} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
            {!prefs.avoid.length && <Text style={styles.meta}>Nothing avoided yet.</Text>}
          </View>
          {AVOID_SUGGESTIONS.some((s) => !prefs.avoid.some((a) => a.toLowerCase() === s.toLowerCase())) && (
            <>
              <Text style={styles.meta}>Tap to leave out a whole kind of story:</Text>
              <View style={styles.chips}>
                {AVOID_SUGGESTIONS.filter((s) => !prefs.avoid.some((a) => a.toLowerCase() === s.toLowerCase())).map((s) => (
                  <TouchableOpacity key={s} onPress={() => prefs.set({ avoid: [...prefs.avoid, s].slice(0, 20) })} style={chip(false)}
                    testID={`brief-avoid-${s.toLowerCase().replace(/\s+/g, '-')}`} accessibilityLabel={`Avoid ${s}`}>
                    <Icon name="plus" size={13} color={colors.textMuted} />
                    <Text style={styles.chipText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          <TextInput value={avoidText} onChangeText={setAvoidText} onSubmitEditing={addAvoid} returnKeyType="done"
            placeholder="e.g. sports, celebrity gossip, crypto"
            placeholderTextColor={colors.textMuted} blurOnSubmit style={styles.input} testID="brief-avoid-input" />
          <View style={styles.actions}>
            <Button title="Avoid" size="small" variant="secondary" onPress={addAvoid} disabled={!avoidText.trim()} testID="brief-avoid-add" />
          </View>
        </Card>

        <Card title="Show options">
          <Text style={styles.sectionLabel}>Length</Text>
          <View style={styles.chips}>
            {LENGTHS.map((m) => (
              <TouchableOpacity key={m} onPress={() => prefs.set({ minutes: m })} style={chip(prefs.minutes === m)}>
                <Text style={chipText(prefs.minutes === m)}>{m} min</Text>
              </TouchableOpacity>
            ))}
          </View>
          {voices >= 2 && (
            <>
              <Text style={styles.sectionLabel}>Hosts</Text>
              <View style={styles.chips}>
                {([1, 2] as const).map((h) => (
                  <TouchableOpacity key={h} onPress={() => prefs.set({ hosts: h })} style={chip(prefs.hosts === h)}>
                    <Text style={chipText(prefs.hosts === h)}>{h === 1 ? 'One narrator' : 'Two hosts'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {voices >= 2 && (
            <>
              <Text style={styles.sectionLabel}>Voices</Text>
              <PodcastVoicePicker hosts={prefs.experts ? 3 : prefs.hosts} />
            </>
          )}
          {voices >= 2 && (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>An expert for each topic (the anchor hands over to them)</Text>
              <Switch value={prefs.experts} onValueChange={(v) => prefs.set({ experts: v })} testID="brief-experts" />
            </View>
          )}
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Short tunes at the start and end of the show</Text>
            <Switch value={prefs.jingles !== false} onValueChange={(v) => prefs.set({ jingles: v })} testID="brief-jingles" />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Fun fact from your offline library</Text>
            <Switch value={prefs.funFacts} onValueChange={(v) => prefs.set({ funFacts: v })} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Read each full article (more detail, slower)</Text>
            <Switch value={prefs.deep} onValueChange={(v) => prefs.set({ deep: v })} />
          </View>
        </Card>

        {list.length > 0 && (
          <Card title="Earlier briefings" subtitle="Press and hold one to delete it.">
            {list.map((r) => (
              <TouchableOpacity key={r.createdAt} onPress={() => open(r.createdAt)} onLongPress={() => confirmDelete(r)}
                style={[styles.headline, styles.earlier]} testID={`brief-${r.createdAt}`}>
                <Icon name="radio" size={18} color={colors.primary} />
                <View style={styles.headlineText}>
                  <Text style={styles.body}>{r.title}</Text>
                  <Text style={styles.meta}>{[new Date(r.createdAt).toLocaleString(), r.minutes && `about ${r.minutes} min`].filter(Boolean).join(' · ')}</Text>
                </View>
                <TouchableOpacity onPress={() => confirmDelete(r)} accessibilityLabel="Delete briefing" style={styles.deleteButton}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Icon name="trash-2" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};
