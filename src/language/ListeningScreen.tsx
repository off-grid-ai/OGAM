import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Choice } from '../components/games/kit';
import { LANGUAGES, MY_WORDS, languageService } from './languageService';
import { useLanguage } from './store';
import type { Listening } from './listening';
import { createStyles } from './ListeningScreen.styles';
import { ListeningLibrary } from './ListeningLibrary';
import { pieceForSpace } from './library';
import { Tappable } from './Tappable';
import { useListeningAudio } from './useListeningAudio';
import type { LevelId } from './teaching';

/**
 * Story or podcast mode: easy text in the language, read aloud part by part, with a question
 * after each part and, at the end, the new words to save for practice. Opens on the library of
 * pre-made pieces (or a board square's own piece), with "write your own" below it.
 */
export const ListeningScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const params = useRoute<any>().params as { kind: Listening['kind']; at?: number; space?: string; level?: LevelId; pieceId?: string };
  const { kind, at, space } = params;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const code = useLanguage((s) => s.language);
  const saved = useLanguage((s) => s.listening[s.language]?.find((l) => l.createdAt === at));
  const langName = LANGUAGES.find((l) => l.code === code)?.name ?? code;
  const boardPiece = space ? pieceForSpace(params.level ?? useLanguage.getState().level, space)?.id : params.pieceId;
  const [piece, setPiece] = useState<Listening | null>(saved ?? null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [part, setPart] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [english, setEnglish] = useState(false);

  const load = (job: (onStep: (m: string) => void) => Promise<Listening>) => {
    setError(null); setStep('Starting...');
    job(setStep)
      .then((p) => { setPiece(p); setPart(0); setPicked(null); })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setStep(null));
  };
  const open = (id: string) => load((onStep) => languageService.openPremade(id, onStep));
  useEffect(() => { if (boardPiece && !saved) open(boardPiece); }, [boardPiece]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = !!piece && part >= piece.parts.length;
  // Reaching the end of a board square's piece moves the token on.
  useEffect(() => { if (done && space) languageService.completeSpace(space); }, [done, space]);
  const podcast = kind === 'podcast';
  // A podcast is for listening: each part plays by itself, and the text stays hidden until asked for.
  const [showText, setShowText] = useState(!podcast);
  const { playing, toggle: play, halt } = useListeningAudio({ piece, code, part, done, autoPlay: podcast });

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Back">
        <Icon name="arrow-left" size={20} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{piece?.title ?? (kind === 'story' ? 'Stories' : 'Podcasts')}</Text>
    </View>
  );

  if (!piece && boardPiece) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <PieceWaiting step={step} error={error} onRetry={() => open(boardPiece)}
          onSkip={space ? () => { languageService.completeSpace(space); navigation.goBack(); } : undefined} />
      </SafeAreaView>
    );
  }

  if (!piece) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <ListeningStart kind={kind} langName={langName} step={step} error={error} onClearError={() => setError(null)}
          onMake={(topic) => load((onStep) => languageService.makeListening(kind, topic, onStep))} onOpen={open} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        {!done ? (
          <PartCard piece={piece} part={part} podcast={podcast} state={{ playing, showText, english, picked }}
            on={{ play, toggleText: () => setShowText(!showText), toggleEnglish: () => setEnglish(!english), pick: setPicked,
              next: () => { halt(); setPart(part + 1); setPicked(null); setEnglish(false); } }} />
        ) : (
          <NewWords piece={piece} kind={kind} onBoard={space ? () => navigation.goBack() : undefined} onAnother={() => { setPiece(null); setPart(0); }} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

/** One part of a story or podcast: the lines (hidden for a podcast until asked for), the question and "Next part". */
function PartCard({ piece, part, podcast, state, on }: {
  piece: Listening; part: number; podcast: boolean;
  state: { playing: boolean; showText: boolean; english: boolean; picked: number | null };
  on: { play: () => void; toggleText: () => void; toggleEnglish: () => void; pick: (i: number) => void; next: () => void };
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { playing, showText, english, picked } = state;
  const cur = piece.parts[Math.min(part, piece.parts.length - 1)];
  const answered = !cur.question || picked !== null;
  return (
          <Card title={`Part ${part + 1} of ${piece.parts.length}`} testID="listening-part"
            headerRight={<TouchableOpacity onPress={on.play} accessibilityLabel={playing ? 'Stop' : 'Play'}><Icon name={playing ? 'square' : 'volume-2'} size={22} color={colors.primary} /></TouchableOpacity>}>
            {podcast && !showText && <Text style={styles.body} testID="listening-audio-only">{playing ? 'Listening...' : 'Tap the speaker to hear it again.'}</Text>}
            {showText && cur.lines.map((l, i) => (
              <View key={i} style={styles.line}>
                {!!l.speaker && <Text style={styles.speaker}>{l.speaker}</Text>}
                <Tappable text={l.t} style={styles.target} />
                {english && <Text style={styles.english}>{l.en}</Text>}
              </View>
            ))}
            {podcast && <TouchableOpacity onPress={on.toggleText} testID="listening-show-text"><Text style={styles.link}>{showText ? 'Hide the text' : 'Show the text'}</Text></TouchableOpacity>}
            {showText && <TouchableOpacity onPress={on.toggleEnglish}><Text style={styles.link}>{english ? 'Hide English' : 'Show English'}</Text></TouchableOpacity>}
            {cur.question && (
              <View style={styles.question} testID="listening-question">
                <Text style={styles.body}>{cur.question.q}</Text>
                {cur.question.options.map((o, i) => (
                  <Choice key={o} label={o} disabled={picked !== null} onPress={() => on.pick(i)}
                    state={picked === null ? null : i === cur.question!.answer ? 'right' : i === picked ? 'wrong' : null} />
                ))}
              </View>
            )}
            <Button title={part + 1 < piece.parts.length ? 'Next part' : 'See my new words'} disabled={!answered}
              onPress={on.next} testID="listening-next" />
          </Card>
  );
}

/** The start page: write your own, or pick from the library. */
function ListeningStart({ kind, langName, step, error, onClearError, onMake, onOpen }: {
  kind: Listening['kind']; langName: string; step: string | null; error: string | null;
  onClearError: () => void; onMake: (topic: string) => void; onOpen: (id: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [topic, setTopic] = useState('');
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {step ? <View style={styles.progressRow}><ActivityIndicator color={colors.primary} /><Text style={styles.body}>{step}</Text></View>
        : !!error && <PieceWaiting step={null} error={error} onRetry={onClearError} />}
      <Card title={kind === 'story' ? `Write your own story in ${langName}` : `Make your own podcast in ${langName}`}
        subtitle="Easy words, read aloud, with a question after each part and your new words at the end.">
        <TextInput value={topic} onChangeText={setTopic} placeholder="Topic (optional), e.g. a day at the beach"
          placeholderTextColor={colors.textMuted} style={styles.input} testID="listening-topic" />
        <Button title={kind === 'story' ? 'Write my story' : 'Make my podcast'} onPress={() => onMake(topic)} disabled={!!step} testID="listening-make" />
        <Text style={styles.meta}>Written by the AI on your phone, so wording may be imperfect.</Text>
      </Card>
      <ListeningLibrary kind={kind} onOpen={onOpen} />
    </ScrollView>
  );
}

/** Opening a pre-made piece: progress, or what went wrong with ways forward (retry, load the model, skip the square). */
function PieceWaiting({ step, error, onRetry, onSkip }: { step: string | null; error: string | null; onRetry: () => void; onSkip?: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [loading, setLoading] = useState<string | null>(null);
  const forceLoad = () => {
    setLoading('Loading...');
    languageService.forceLoadModel(setLoading).then(() => { setLoading(null); onRetry(); }).catch((e) => setLoading(String(e?.message || e)));
  };
  return (
    <View style={styles.content}>
      {!error ? <View style={styles.progressRow}><ActivityIndicator color={colors.primary} /><Text style={styles.body}>{step ?? 'Starting...'}</Text></View> : (
        <>
          <Text style={styles.error} testID="listening-error">{error}</Text>
          <Button title="Try again" onPress={onRetry} />
          {loading ? <Text style={styles.meta}>{loading}</Text>
            : <Button title="Load the AI model now" variant="outline" onPress={forceLoad} testID="listening-force-load" />}
          {onSkip && <Button title="Skip this square" variant="ghost" onPress={onSkip} testID="listening-skip" />}
        </>
      )}
    </View>
  );
}

/** The end of a story or podcast: its new words, to tick and save to My words. */
function NewWords({ piece, kind, onAnother, onBoard }: { piece: Listening; kind: Listening['kind']; onAnother: () => void; onBoard?: () => void }) {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [keep, setKeep] = useState<Set<number>>(() => new Set(piece.vocab.map((_, i) => i)));
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const flip = (i: number) => { const n = new Set(keep); if (n.has(i)) n.delete(i); else n.add(i); setKeep(n); };
  return (
          <Card title="New words for you" subtitle="Words from this piece you have not learned yet. Tick the ones to practise." testID="listening-vocab">
            {piece.vocab.map((v, i) => (
              <TouchableOpacity key={v.t} style={styles.word} onPress={() => flip(i)}>
                <Icon name={keep.has(i) ? 'check-square' : 'square'} size={18} color={colors.primary} />
                <Text style={styles.target}>{v.t}</Text>
                <Text style={styles.english}>{v.en}</Text>
              </TouchableOpacity>
            ))}
            {!piece.vocab.length && <Text style={styles.body}>No new words this time: you know them all.</Text>}
            {savedCount === null ? (
              <Button title="Add to My words" disabled={!keep.size} testID="listening-save"
                onPress={() => setSavedCount(languageService.saveWords(piece.vocab.filter((_, i) => keep.has(i))))} />
            ) : (
              <>
                <Text style={styles.body}>{savedCount} new word{savedCount === 1 ? '' : 's'} added to My words.</Text>
                {languageService.unlocked(MY_WORDS) && <Button title="Practise My words" onPress={() => navigation.navigate('Lesson', { unitId: MY_WORDS })} />}
              </>
            )}
            {onBoard
              ? <Button title="Back to the board" variant="outline" onPress={onBoard} testID="listening-board" />
              : <Button title={kind === 'story' ? 'Another story' : 'Another podcast'} variant="outline" onPress={onAnother} />}
          </Card>
  );
}
