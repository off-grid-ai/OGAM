import React, { useMemo, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { Choice } from '../components/games/kit';
import { rng, type Exercise, type Item } from './lessons';
import { createStyles } from './LessonScreen.styles';
import { Tappable } from './Tappable';
import { speakVaried } from './voices';

/** What the learner has picked so far, and whether the answer was checked. */
export interface Attempt { value: string; checked: boolean }

function Say({ item, lang, autoPlay }: { item: Item; lang: string; autoPlay?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  React.useEffect(() => { if (autoPlay) speakVaried(item.t, lang, 'lesson'); }, [item.t]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <TouchableOpacity style={styles.speaker} onPress={() => speakVaried(item.t, lang, 'lesson')} accessibilityLabel="Play the word">
      <Icon name="volume-2" size={26} color={colors.background} />
    </TouchableOpacity>
  );
}

function Options({ ex, attempt, onPick }: { ex: Extract<Exercise, { options: string[] }>; attempt: Attempt; onPick: (v: string) => void }) {
  return (
    <View>
      {ex.options.map((o) => (
        <Choice key={o} label={o} disabled={attempt.checked} onPress={() => onPick(o)}
          state={attempt.checked ? (o === ex.answer ? 'right' : o === attempt.value ? 'wrong' : null) : o === attempt.value ? 'picked' : null} />
      ))}
    </View>
  );
}

/** Tap a word, then its translation. Finished when every pair is matched; `mistakes` counts wrong taps. */
function Match({ pairs, onDone }: { pairs: Item[]; onDone: (mistakes: number) => void }) {
  const styles = useThemedStyles(createStyles);
  const right = useMemo(() => { const r = rng(pairs.length * 7 + 3); return [...pairs].sort(() => r() - 0.5); }, [pairs]);
  const [left, setLeft] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [wrong, setWrong] = useState(0);
  const pick = (t: string) => {
    if (!left) return;
    if (pairs.find((p) => p.en === left)?.t === t) {
      const next = [...done, left];
      setDone(next);
      if (next.length === pairs.length) onDone(wrong);
    } else setWrong(wrong + 1);
    setLeft(null);
  };
  return (
    <View style={styles.columns}>
      <View style={styles.column}>
        {pairs.map((p) => (
          <Choice key={p.en} label={p.en} disabled={done.includes(p.en)} onPress={() => setLeft(p.en)}
            state={done.includes(p.en) ? 'right' : left === p.en ? 'picked' : null} />
        ))}
      </View>
      <View style={styles.column}>
        {right.map((p) => (
          <Choice key={p.t} label={p.t} disabled={done.includes(p.en)} onPress={() => pick(p.t)} state={done.includes(p.en) ? 'right' : null} />
        ))}
      </View>
    </View>
  );
}

function Build({ ex, attempt, onPick, joiner = ' ' }: { ex: Extract<Exercise, { tiles: string[] }>; attempt: Attempt; onPick: (v: string) => void; joiner?: string }) {
  const styles = useThemedStyles(createStyles);
  const [used, setUsed] = useState<number[]>([]);
  const set = (next: number[]) => { setUsed(next); onPick(next.map((i) => ex.tiles[i]).join(joiner)); };
  const tile = (i: number, onPress: () => void) => (
    <TouchableOpacity key={i} style={styles.tile} onPress={onPress} disabled={attempt.checked}><Text style={styles.tileText}>{ex.tiles[i]}</Text></TouchableOpacity>
  );
  return (
    <View>
      <View style={[styles.tiles, styles.answerLine]} testID="build-answer">{used.map((i) => tile(i, () => set(used.filter((u) => u !== i))))}</View>
      <View style={[styles.tiles, styles.pool]}>{ex.tiles.map((_, i) => (used.includes(i) ? null : tile(i, () => set([...used, i]))))}</View>
    </View>
  );
}

/** A box to type the answer in (the keyboard's accents and the language's keyboard both work). */
function Typed({ attempt, onPick, placeholder }: { attempt: Attempt; onPick: (v: string) => void; placeholder: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <TextInput value={attempt.value} onChangeText={onPick} editable={!attempt.checked} placeholder={placeholder}
      placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.typed} testID="lesson-typed" />
  );
}

/** Say it out loud: Atlas's transcription model (Whisper) when a multilingual one is downloaded, else the phone's own speech recognizer, writes what it heard. */
function Speak({ ex, lang, attempt, onPick, onSkip }: { ex: Extract<Exercise, { kind: 'speak' }>; lang: string; attempt: Attempt; onPick: (v: string) => void; onSkip: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [listening, setListening] = useState(false);
  const [writing, setWriting] = useState(false);
  const session = useRef<{ stop: () => void } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // No speech recognizer, or it failed (no microphone permission, language not installed): say it
  // aloud, compare with the voice, and mark it yourself.
  const [selfCheck, setSelfCheck] = useState<'none' | 'failed' | null>(null);
  const listen = async () => {
    setProblem(null); setListening(true);
    try {
      const { listenInLanguage } = require('./listenTurn');
      const heardBy = await listenInLanguage(lang, { onPartial: onPick, onTranscribing: () => setWriting(true) });
      if (!heardBy) { setSelfCheck('none'); return; }
      session.current = heardBy;
      const heard: string = await heardBy.result;
      if (heard) onPick(heard); else setProblem('Nothing heard. Tap the microphone and try again.');
    } catch (e: any) {
      if (e?.name !== 'SpeechCancelled') { setProblem(String(e?.message || e)); setSelfCheck('failed'); }
    } finally { session.current = null; setListening(false); setWriting(false); }
  };
  return (
    <View>
      <Text style={styles.prompt}>Say this out loud</Text>
      <View style={styles.sayRow}>
        <Say item={ex.item} lang={lang} />
        <View style={styles.sayText}><Tappable text={ex.item.t} style={styles.big} />{!!ex.item.r && <Text style={styles.roman}>{ex.item.r}</Text>}</View>
      </View>
      <Text style={styles.bodyText}>{ex.item.en}</Text>
      <TouchableOpacity style={styles.speaker} onPress={() => (listening ? session.current?.stop() : listen())} disabled={writing || attempt.checked} testID="lesson-speak"
        accessibilityLabel={writing ? 'Writing down what you said' : listening ? 'Listening' : 'Speak'}>
        <Icon name={listening ? 'radio' : 'mic'} size={26} color={colors.background} />
      </TouchableOpacity>
      {!!attempt.value && !selfCheck && <Text style={styles.bodyText} testID="lesson-heard">Heard: {attempt.value}</Text>}
      {!!problem && <Text style={styles.roman}>{problem}</Text>}
      {selfCheck && !attempt.checked && (
        <View testID="lesson-self-check">
          <Text style={styles.bodyText}>
            {selfCheck === 'none' ? 'This phone has no speech recognizer.' : 'Speech recognition did not work.'} Say it out loud, play it to compare, then mark how it went.
          </Text>
          <View style={styles.selfRow}>
            <TouchableOpacity style={styles.tile} onPress={() => onPick(ex.answer)} testID="lesson-said-it"><Text style={styles.tileText}>I said it right</Text></TouchableOpacity>
            <TouchableOpacity style={styles.tile} onPress={() => onPick('-')} testID="lesson-not-yet"><Text style={styles.tileText}>Not yet</Text></TouchableOpacity>
          </View>
        </View>
      )}
      {!attempt.checked && (
        <TouchableOpacity onPress={onSkip} testID="lesson-skip-speaking"><Text style={styles.roman}>Can't speak now</Text></TouchableOpacity>
      )}
    </View>
  );
}

/** One exercise. Match reports its own result; the others report the picked answer for Check. */
export function ExerciseView({ ex, lang, langName, attempt, onPick, onMatched, onSkip = () => undefined }: {
  ex: Exercise; lang: string; langName: string; attempt: Attempt; onPick: (v: string) => void; onMatched: (mistakes: number) => void;
  /** Skips a speaking exercise (no microphone, or somewhere quiet is needed). */
  onSkip?: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  if (ex.kind === 'speak') return <Speak ex={ex} lang={lang} attempt={attempt} onPick={onPick} onSkip={onSkip} />;
  if (ex.kind === 'match') return (<View><Text style={styles.prompt}>Match the pairs</Text><Match pairs={ex.pairs} onDone={onMatched} /></View>);
  if (ex.kind === 'build') return (
    <View>
      <Text style={styles.prompt}>Write this in {langName}</Text>
      <Text style={styles.big}>{ex.item.en}</Text>
      <Build ex={ex} attempt={attempt} onPick={onPick} />
    </View>
  );
  if (ex.kind === 'hear') return (
    <View>
      <Text style={styles.prompt}>Tap what you hear</Text>
      <Say item={ex.item} lang={lang} autoPlay />
      <Build ex={ex} attempt={attempt} onPick={onPick} />
    </View>
  );
  if (ex.kind === 'type') return (
    <View>
      <Text style={styles.prompt}>Type this in {langName}</Text>
      <Text style={styles.big}>{ex.item.en}</Text>
      <Typed attempt={attempt} onPick={onPick} placeholder={`In ${langName}...`} />
    </View>
  );
  if (ex.kind === 'dictation') return (
    <View>
      <Text style={styles.prompt}>Type what you hear</Text>
      <Say item={ex.item} lang={lang} autoPlay />
      <Typed attempt={attempt} onPick={onPick} placeholder="What did you hear?" />
    </View>
  );
  if (ex.kind === 'scramble') return (
    <View>
      <Text style={styles.prompt}>Unscramble the word for "{ex.item.en}"</Text>
      <Build ex={ex} attempt={attempt} onPick={onPick} joiner="" />
    </View>
  );
  if (ex.kind === 'truefalse') return (
    <View>
      <Text style={styles.prompt}>True or false?</Text>
      <View style={styles.sayRow}>
        <Say item={ex.item} lang={lang} />
        <View style={styles.sayText}><Tappable text={ex.item.t} style={styles.big} /></View>
      </View>
      <Text style={styles.bodyText}>means "{ex.shownMeaning}"</Text>
      <Options ex={ex} attempt={attempt} onPick={onPick} />
    </View>
  );
  if (ex.kind === 'blank') return (
    <View>
      <Text style={styles.prompt}>Fill in the blank</Text>
      <Tappable text={ex.shown} style={styles.big} />
      <Text style={styles.roman}>{ex.item.en}</Text>
      <Options ex={ex} attempt={attempt} onPick={onPick} />
    </View>
  );
  return (
    <View>
      <Text style={styles.prompt}>{ex.kind === 'choose' ? `Pick the ${langName} for` : ex.kind === 'meaning' ? 'What does this mean?' : 'Listen and pick what you hear'}</Text>
      {ex.kind === 'choose' && <Text style={styles.big}>{ex.item.en}</Text>}
      {ex.kind === 'meaning' && (
        <View style={styles.sayRow}>
          <Say item={ex.item} lang={lang} />
          <View style={styles.sayText}><Tappable text={ex.item.t} style={styles.big} />{!!ex.item.r && <Text style={styles.roman}>{ex.item.r}</Text>}</View>
        </View>
      )}
      {ex.kind === 'listen' && <Say item={ex.item} lang={lang} autoPlay />}
      <Options ex={ex} attempt={attempt} onPick={onPick} />
    </View>
  );
}
