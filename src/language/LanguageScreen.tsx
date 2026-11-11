import React from 'react';
import { SPACING } from '../constants';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { LEVELS, type LevelId } from './teaching';
import { LANGUAGES, MISTAKES, MY_WORDS, REVIEW, languageService } from './languageService';
import { boardFor, spaceOpen, type Space } from './board';
import { scenarioFor } from './phoneCall';
import { startTutorChat } from './tutorChat';
import { useActiveTextModel } from '../hooks/useActiveTextModel';
import { useAppStore } from '../stores';
import { LANGUAGE_PROJECT_ID } from './tutor';
import { unitsForLevel } from './curriculum';
import { useLanguage, usePrepareLive } from './store';
import { Board } from './Board';
import { createStyles } from './LanguageScreen.styles';
import { pieceById } from './library';
import { speakVaried } from './voices';
import { ForceLoadModel } from '../components/ForceLoadModel';

/**
 * Learn a language: four levels (Basic, Intermediate, Advanced, Fluent), each a board game.
 * Every square is one sitting of about five minutes: a lesson, or a story, podcast, speed
 * round or word search the pawn lands on. Finish a square to move on. Progress is saved.
 */
export const LanguageScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const code = useLanguage((s) => s.language);
  useLanguage((s) => s.progress[s.language]); // re-render when progress changes
  const xp = useLanguage((s) => s.xp);
  const streak = useLanguage((s) => s.streak.count);
  const level = useLanguage((s) => s.level);
  const sounds = useLanguage((s) => s.sounds);
  const speaking = useLanguage((s) => s.speaking);
  const slowVoice = useLanguage((s) => !!s.slowVoice);
  const goal = useLanguage((s) => s.goal);
  useLanguage((s) => s.today);
  const todayXp = languageService.todayXp();
  const due = languageService.dueCount(code);
  const scroll = React.useRef<ScrollView>(null);
  const { modelId: textModelId } = useActiveTextModel();
  const activeModelId = useAppStore((st) => st.activeModelId);
  const downloaded = useAppStore((st) => st.downloadedModels);
  const spaces = boardFor(level);
  const isDone = (key: string) => languageService.isDone(key, code);
  const isOpen = (i: number) => spaceOpen(spaces, i, isDone);
  const firstOpen = spaces.findIndex((s, i) => !isDone(s.key) && isOpen(i));
  const current = firstOpen >= 0 ? firstOpen : spaces.length - 1;
  const doneCount = spaces.filter((s) => isDone(s.key)).length;

  const play = (s: Space, i: number) => {
    if (s.kind === 'lesson') navigation.navigate('Lesson', { unitId: s.unitId, part: s.part, parts: s.parts, key: s.key });
    else if (s.kind === 'story' || s.kind === 'podcast') navigation.navigate('Listening', { kind: s.kind, space: s.key, level, index: i });
    else {
      // Speed rounds, word searches, reviews, calls and the checkpoint use the lessons before them on the board.
      const before = spaces.slice(0, i).filter((x) => x.kind === 'lesson').map((x) => x.unitId!);
      const unitId = before[before.length - 1] ?? unitsForLevel(level)[0].id;
      if (s.kind === 'call') navigation.navigate('Call', { key: s.key, scenarioId: scenarioFor(unitId, i).id });
      else if (s.kind === 'crossword') navigation.navigate('Crossword', { unitId, key: s.key });
      else if (s.kind === 'wordsearch') navigation.navigate('WordSearch', { unitId, key: s.key });
      else navigation.navigate('Lesson', { unitId, mode: s.kind, key: s.key, level });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Back">
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>Learn a language</Text>
        <View style={styles.stat} accessibilityLabel={`${streak} day streak`}>
          <Icon name="zap" size={16} color={colors.primary} /><Text style={styles.statText}>{streak}</Text>
        </View>
        <View style={styles.stat} accessibilityLabel={`${xp} XP`}>
          <Icon name="award" size={16} color={colors.primary} /><Text style={styles.statText}>{xp} XP</Text>
        </View>
      </View>
      <ScrollView ref={scroll} contentContainerStyle={styles.scroll}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.langRow}>
          {LANGUAGES.map((l) => (
            <TouchableOpacity key={l.code} onPress={() => languageService.setLanguage(l.code)} style={[styles.chip, l.code === code && styles.chipOn]}>
              <Text style={l.code === code ? styles.chipTextOn : styles.chipText}>{l.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={styles.levels}>
          {LEVELS.map((l) => (
            <TouchableOpacity key={l.id} onPress={() => languageService.setLevel(l.id as LevelId)} accessibilityLabel={`${l.cefr}, ${l.name}`}
              style={[styles.level, l.id === level && styles.levelOn]}>
              <Text style={l.id === level ? styles.levelTextOn : styles.levelText}>{l.cefr}</Text>
              <Text style={l.id === level ? styles.levelSubOn : styles.levelSub} numberOfLines={2}>{l.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <PrepareLevel level={level} />
        <TouchableOpacity style={styles.goal} onPress={() => languageService.cycleGoal()} testID="language-goal"
          accessibilityLabel={`Daily goal: ${todayXp} of ${goal} XP. Tap to change the goal.`}>
          <Icon name={todayXp >= goal ? 'check-circle' : 'target'} size={16} color={colors.primary} />
          <View style={styles.goalBar}><View style={[styles.goalFill, { width: `${Math.min(1, todayXp / goal) * 100}%` }]} /></View>
          <Text style={styles.progressText}>{todayXp >= goal ? 'Goal met' : `${todayXp} / ${goal} XP today`}</Text>
        </TouchableOpacity>
        <View style={styles.extras}>
          <TouchableOpacity onPress={() => { const r = startTutorChat(textModelId || activeModelId || downloaded[0]?.id); if ('error' in r) Alert.alert('Chat with your tutor', r.error); else navigation.navigate('Chat', { conversationId: r.conversationId, projectId: LANGUAGE_PROJECT_ID }); }} testID="language-tutor" accessibilityLabel="Chat with your tutor">
            <Text style={styles.extraOn}>Chat with your tutor</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('ProjectChats', { projectId: LANGUAGE_PROJECT_ID })} testID="language-chats" accessibilityLabel="Past tutor chats">
            <Text style={styles.extraOn}>Past chats</Text>
          </TouchableOpacity>
        </View>
        <ForceLoadModel testID="language-force-load" />
        <WordOfTheDay />
        <WeekProgress onWordBook={() => navigation.navigate('WordBook')} />
        <View style={styles.extras}>
          <Text style={styles.progressText}>Square {Math.min(current + 1, spaces.length)} of {spaces.length} · {doneCount} done</Text>
          <TouchableOpacity disabled={!languageService.unlocked(REVIEW, code)} onPress={() => navigation.navigate('Lesson', { unitId: REVIEW })} testID="language-review">
            <Text style={languageService.unlocked(REVIEW, code) ? styles.extraOn : styles.extraOff}>Review ({due})</Text>
          </TouchableOpacity>
          {languageService.unlocked(MISTAKES, code) && (
            <TouchableOpacity onPress={() => navigation.navigate('Lesson', { unitId: MISTAKES })} testID="language-mistakes" accessibilityLabel="Practise the words you miss">
              <Text style={styles.extraOn}>My mistakes</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => navigation.navigate('Call', {})} testID="language-call" accessibilityLabel="Practice call">
            <Text style={styles.extraOn}>Practice call</Text>
          </TouchableOpacity>
          {languageService.unlocked(MY_WORDS, code) && (
            <TouchableOpacity onPress={() => navigation.navigate('Lesson', { unitId: MY_WORDS })} testID="language-mywords">
              <Text style={styles.extraOn}>My words</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => languageService.setSounds(!sounds)} testID="language-sounds"
            accessibilityLabel={sounds ? 'Sounds on' : 'Sounds off'}>
            <Icon name={sounds ? 'volume-2' : 'volume-x'} size={18} color={sounds ? colors.primary : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => languageService.setSlowVoice(!slowVoice)} testID="language-slow-voice"
            accessibilityLabel={slowVoice ? 'Slower voice on' : 'Slower voice off'}>
            <Icon name={slowVoice ? 'volume-1' : 'volume-2'} size={18} color={slowVoice ? colors.primary : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => languageService.setSpeaking(!speaking)} testID="language-speaking"
            accessibilityLabel={speaking ? 'Speaking exercises on' : 'Speaking exercises off'}>
            <Icon name={speaking ? 'mic' : 'mic-off'} size={18} color={speaking ? colors.primary : colors.textMuted} />
          </TouchableOpacity>
        </View>
        <Board spaces={spaces} isDone={isDone} isOpen={isOpen} current={current} onPress={play}
          onFocus={(y) => scroll.current?.scrollTo({ y: Math.max(0, y - SPACING.xl), animated: false })} />
        <Text style={styles.note}>
          Already know some? Pick a higher level: the first square of every level is open. Lessons are written once
          by the AI on your phone, following the course method, so wording may be imperfect. Everything works
          offline after that, and your progress is saved (and included in Atlas backups).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Prepare this level": the AI writes every lesson and story of the level now, so it works offline without waiting. */
function PrepareLevel({ level }: { level: LevelId }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const live = usePrepareLive();
  useLanguage((s) => s.content);
  const cefr = LEVELS.find((l) => l.id === level)?.cefr;
  const running = live.level === level;
  const { units, pieces } = languageService.levelToPrepare(level);
  const left = units.length + pieces.length;
  const next = languageService.nextToPrepare(level);
  const nextTitle = next.units[0]?.title ?? (next.pieces[0] ? pieceById(next.pieces[0])?.title : undefined);
  return (
    <View style={styles.prepare} testID="language-prepare">
      {running ? (
        <>
          <View style={styles.goalBar}><View style={[styles.goalFill, { width: `${(live.done / Math.max(1, live.total)) * 100}%` }]} /></View>
          <Text style={styles.progressText}>Preparing {cefr}: {live.done} of {live.total}. {live.step}</Text>
          <TouchableOpacity onPress={() => languageService.stopPreparing()} testID="language-prepare-stop"><Text style={styles.extraOn}>Stop</Text></TouchableOpacity>
        </>
      ) : left ? (
        <>
          <Text style={styles.progressText}>{plural(units.length, 'lesson')} and {plural(pieces.length, 'story', 'stories')} in {cefr} are written by the AI when first opened.</Text>
          {!!nextTitle && (
            <TouchableOpacity onPress={() => { languageService.prepareLevel(level, 'next'); }} disabled={live.level !== null} testID="language-prepare-next"
              style={styles.prepareButton}>
              <Icon name="download" size={14} color={colors.primary} />
              <Text style={styles.extraOn}>Prepare only the next lesson: {nextTitle}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => { languageService.prepareLevel(level); }} disabled={live.level !== null} testID="language-prepare-start"
            style={styles.prepareButton}>
            <Icon name="download" size={14} color={colors.primary} />
            <Text style={styles.extraOn}>Prepare the whole level now</Text>
          </TouchableOpacity>
        </>
      ) : <Text style={styles.progressText}>{cefr} is ready: every lesson and story works offline.</Text>}
      {!!live.error && !running && <Text style={styles.progressText}>{live.error}</Text>}
    </View>
  );
}

/** The word of the day: tap to hear it, and save it to My words. */
function WordOfTheDay() {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const code = useLanguage((s) => s.language);
  useLanguage((s) => s.myWords);
  const word = languageService.wordOfTheDay();
  if (!word) return null;
  const saved = (useLanguage.getState().myWords[code] ?? []).some((w) => w.t === word.t);
  return (
    <View style={styles.wordDay} testID="language-word-of-day">
      <TouchableOpacity onPress={() => speakVaried(word.t, code, 'lesson')} accessibilityLabel={`Play ${word.t}`} style={styles.wordDayMain}>
        <Icon name="volume-2" size={18} color={colors.primary} />
        <View style={styles.wordDayText}>
          <Text style={styles.progressText}>Word of the day</Text>
          <Text style={styles.wordDayWord}>{word.t}{word.r ? ` (${word.r})` : ''}</Text>
          <Text style={styles.progressText}>{word.en}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity disabled={saved} onPress={() => languageService.saveWords([{ t: word.t, en: word.en }])} testID="language-word-of-day-save">
        <Text style={saved ? styles.extraOff : styles.extraOn}>{saved ? 'Saved' : 'Save'}</Text>
      </TouchableOpacity>
    </View>
  );
}

/** This week at a glance: XP per day as bars, lessons and words learned, and the word book. */
function WeekProgress({ onWordBook }: { onWordBook: () => void }) {
  const styles = useThemedStyles(createStyles);
  useLanguage((s) => s.history);
  const week = languageService.week();
  const max = Math.max(1, ...week.map((d) => d.xp));
  const xp = week.reduce((t, d) => t + d.xp, 0);
  const lessons = week.reduce((t, d) => t + d.lessons, 0);
  const words = languageService.wordBook().length;
  return (
    <View style={styles.week} testID="language-week">
      <View style={styles.weekBars}>
        {week.map((d) => (
          <View key={d.day} style={styles.weekDay} accessibilityLabel={`${d.label}: ${d.xp} XP`}>
            <View style={styles.weekTrack}><View style={[styles.weekFill, d.today && styles.weekToday, { height: `${(d.xp / max) * 100}%` }]} /></View>
            <Text style={styles.progressText}>{d.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.weekText}>
        <Text style={styles.progressText} testID="language-week-total">This week: {xp} XP, {plural(lessons, 'lesson')}</Text>
        <TouchableOpacity onPress={onWordBook} testID="language-wordbook"><Text style={styles.extraOn}>Word book ({words})</Text></TouchableOpacity>
      </View>
    </View>
  );
}
