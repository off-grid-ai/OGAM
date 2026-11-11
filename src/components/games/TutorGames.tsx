/** Games that talk with you, grounded in the project: teach it back, Socratic tutor, explain at my level, mnemonics, memory palace, concept map. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Svg, { Line, Rect, Text as SvgText, G } from 'react-native-svg';
import { MarkdownText } from '../MarkdownText';
import {
  explainAtLevel, gradeExplanation, LEVELS, makeMnemonics, tutorTurn,
  type ConceptMap, type PalaceStation,
} from '../../study/games/generate';
import { acronymMatches, layoutConceptMap, similarity } from '../../study/games/logic';
import { useStudyStore } from '../../study/engine';
import type { LearningTerm } from '../../study/learningGames';
import { Banner, BAD, Card, Choice, Finished, GameButton, GOOD, SourceLinks, Title, useGameColors, useRecord, type GameProps } from './kit';
const COLOR_FFF = '#fff';
const ALIGNSELF_FLEX_END = 'flex-end';
const ALIGNSELF_FLEX_START = 'flex-start';
const literalStyles = StyleSheet.create({
  s1: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  s2: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  s3: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  s4: { borderRadius: 10, padding: 12, minHeight: 130, textAlignVertical: 'top' },
  s5: { marginTop: 6 },
  s6: { maxHeight: 420 },
  s7: { maxWidth: '88%' },
  s8: { borderRadius: 12, padding: 10, marginVertical: 4 },
  s9: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  s10: { flex: 1 },
  s11: { borderRadius: 10, padding: 12 },
  s12: { flexDirection: 'row', gap: 4, marginVertical: 6 },
  s13: { flex: 1, paddingVertical: 10, borderRadius: 8 },
  s14: { alignItems: 'center' },
  s15: { fontSize: 11, textAlign: 'center' },
  s16: { borderRadius: 10, padding: 12, minHeight: 100, textAlignVertical: 'top' },
  s17: { fontSize: 12 },
  s18: { fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  s19: { marginTop: 4 },
  s20: { marginTop: 4, fontStyle: 'italic' },
  s21: { fontSize: 22, fontWeight: '800', marginVertical: 6 },
  s22: { fontSize: 16, lineHeight: 23 },
  s23: { fontSize: 16, marginVertical: 6 },
  s24: { borderRadius: 8, padding: 12 },
  s25: { fontWeight: '700', marginTop: 6 },
  s26: { flexDirection: 'row', gap: 8 },
  s27: { alignSelf: 'center' },
  s28: { borderRadius: 12 },
  s29: { fontSize: 18 },
  s30: { fontWeight: '700' },
});


const Busy = ({ label }: { label: string }) => {
  const colors = useGameColors();
  return <View style={literalStyles.s1}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.textSecondary }}>{label}</Text></View>;
};

// ----------------------------------------------------------------- Feynman: teach it back
export function FeynmanGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const concepts: string[] = result.game?.data?.concepts ?? [];
  const terms: LearningTerm[] = result.game?.data?.terms ?? [];
  const [concept, setConcept] = useState(concepts[0] ?? result.topic);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState<Awaited<ReturnType<typeof gradeExplanation>> | null>(null);
  const [error, setError] = useState('');
  const record = useRecord(projectId);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const g = await gradeExplanation(result.sources, concept, text);
      setGrade(g);
      const t = terms.find((x) => x.answer === concept);
      if (t) record({ prompt: t.clue, answer: t.answer, src: t.src }, g.score >= 7);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };
  return (
    <View>
      <Banner>Explain the idea in your own words, as if teaching a friend. You can type, or use the keyboard's microphone. The AI checks it against your documents.</Banner>
      <View style={literalStyles.s2}>
        {concepts.slice(0, 10).map((c) => (
          <TouchableOpacity key={c} onPress={() => { setConcept(c); setGrade(null); setText(''); }} style={[literalStyles.s3, { backgroundColor: concept === c ? colors.primary : colors.surface }]}>
            <Text style={{ color: concept === c ? COLOR_FFF : colors.text }}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Title>Explain: {concept}</Title>
      <TextInput value={text} onChangeText={setText} multiline placeholder="Start explaining..." placeholderTextColor={colors.textMuted}
        style={[{ color: colors.text, backgroundColor: colors.surface }, literalStyles.s4]} />
      <GameButton label={busy ? 'Checking...' : 'Check my explanation'} disabled={busy || text.trim().split(/\s+/).length < 8} onPress={submit} />
      {busy && <Busy label="Comparing with your documents..." />}
      {!!error && <Text style={{ color: BAD }}>{error}</Text>}
      {grade && (
        <View>
          <Title>Score: {grade.score} / 10</Title>
          {grade.correct.map((c, i) => <Card key={`c${i}`} highlight={GOOD}><Text style={{ color: colors.text }}>✓ {c}</Text></Card>)}
          {grade.wrong.map((w, i) => (
            <Card key={`w${i}`} highlight={BAD}><Text style={{ color: colors.text }}>✗ {w.claim}</Text><Text style={{ color: colors.textSecondary }}>Actually: {w.fix}</Text><SourceLinks nums={w.src} result={result} onOpenSource={onOpenSource} /></Card>
          ))}
          {grade.missed.map((m, i) => (
            <Card key={`m${i}`} highlight="#CA8A04"><Text style={{ color: colors.text }}>Missed: {m.point}</Text><SourceLinks nums={m.src} result={result} onOpenSource={onOpenSource} /></Card>
          ))}
          {!!grade.followUp && <Text style={[{ color: colors.text }, literalStyles.s5]}>Think about: {grade.followUp}</Text>}
          <GameButton label="Try again" kind="plain" onPress={() => setGrade(null)} />
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------- Socratic tutor
export function TutorGame({ result }: GameProps) {
  const colors = useGameColors();
  const goal: string = result.game?.data?.goal ?? result.topic;
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scroll = useRef<ScrollView>(null);
  const turn = async (next: typeof history) => {
    setBusy(true); setError('');
    try {
      const reply = await tutorTurn(result.sources, goal, next);
      setHistory([...next, { role: 'assistant', content: reply }]);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100); }
  };
  useEffect(() => { void turn([]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => {
    if (!text.trim() || busy) return;
    const next = [...history, { role: 'user' as const, content: text.trim() }];
    setHistory(next); setText('');
    void turn(next);
  };
  return (
    <View>
      <Banner>Goal: {goal}. The tutor asks questions instead of giving answers, using only your documents.</Banner>
      <ScrollView ref={scroll} style={literalStyles.s6} nestedScrollEnabled>
        {history.map((m, i) => (
          <View key={i} style={[{ alignSelf: m.role === 'user' ? ALIGNSELF_FLEX_END : ALIGNSELF_FLEX_START }, literalStyles.s7, { backgroundColor: m.role === 'user' ? colors.primary : colors.surface }, literalStyles.s8]}>
            <Text style={{ color: m.role === 'user' ? COLOR_FFF : colors.text }}>{m.content}</Text>
          </View>
        ))}
        {busy && <Busy label="Tutor is thinking..." />}
      </ScrollView>
      {!!error && <Text style={{ color: BAD }}>{error}</Text>}
      <View style={literalStyles.s9}>
        <TextInput value={text} onChangeText={setText} placeholder="Your answer" placeholderTextColor={colors.textMuted} onSubmitEditing={send}
          style={[literalStyles.s10, { color: colors.text, backgroundColor: colors.surface }, literalStyles.s11]} />
        <GameButton label="Send" onPress={send} disabled={busy || !text.trim()} />
      </View>
    </View>
  );
}

// ----------------------------------------------------------------- explain at my level
export function LevelsGame({ result, projectId }: GameProps) {
  const colors = useGameColors();
  const update = useStudyStore((s) => s.update);
  const topic: string = result.game?.data?.topic ?? result.topic;
  const [texts, setTexts] = useState<Record<number, string>>(result.game?.data?.texts ?? {});
  const [level, setLevel] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (texts[level] || busy) return;
    setBusy(true); setError('');
    explainAtLevel(result.sources, topic, level)
      .then((t) => {
        const next = { ...texts, [level]: t };
        setTexts(next);
        // Cache each level in the saved item so moving back is instant later too.
        update(projectId, result.createdAt, { game: { type: 'levels', data: { ...result.game?.data, texts: next } } });
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setBusy(false));
  }, [level]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View>
      <Title>{topic}</Title>
      <View style={literalStyles.s12}>
        {LEVELS.map((l, i) => (
          <TouchableOpacity key={l} onPress={() => setLevel(i)} accessibilityRole="button" accessibilityState={{ selected: level === i }}
            style={[literalStyles.s13, { backgroundColor: level === i ? colors.primary : colors.surface }, literalStyles.s14]}>
            <Text style={[{ color: level === i ? COLOR_FFF : colors.text }, literalStyles.s15]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {busy && <Busy label={`Rewriting for ${LEVELS[level]}...`} />}
      {!!error && <Text style={{ color: BAD }}>{error}</Text>}
      {!!texts[level] && <Card><MarkdownText>{texts[level]}</MarkdownText></Card>}
    </View>
  );
}

// ----------------------------------------------------------------- mnemonic maker
export function MnemonicGame({ result, projectId }: GameProps) {
  const colors = useGameColors();
  const update = useStudyStore((s) => s.update);
  const [list, setList] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<{ items: string[]; acronym: string; sentence: string; rhyme: string; story: string }[]>(result.game?.data?.results ?? []);
  const make = async () => {
    const items = list.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
    if (items.length < 2) { setError('Enter at least 2 items, one per line or separated by commas.'); return; }
    setBusy(true); setError('');
    try {
      const m = await makeMnemonics(items);
      // Only show an acronym that really matches the first letters.
      const fixed = { ...m, acronym: acronymMatches(m.acronym, items) ? m.acronym : items.map((x) => x[0].toUpperCase()).join('') };
      const next = [{ items, ...fixed }, ...results].slice(0, 20);
      setResults(next); setList('');
      update(projectId, result.createdAt, { game: { type: 'mnemonic', data: { results: next } } });
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };
  return (
    <View>
      <Banner>Type a list you need to remember (steps, names, parts), in order. You get an acronym, a sentence, a rhyme and a story.</Banner>
      <TextInput value={list} onChangeText={setList} multiline placeholder={'e.g.\nAirway\nBreathing\nCirculation'} placeholderTextColor={colors.textMuted}
        style={[{ color: colors.text, backgroundColor: colors.surface }, literalStyles.s16]} />
      <GameButton label={busy ? 'Making...' : 'Make mnemonics'} onPress={make} disabled={busy} />
      {!!error && <Text style={{ color: BAD }}>{error}</Text>}
      {results.map((r, i) => (
        <Card key={i}>
          <Text style={[{ color: colors.textMuted }, literalStyles.s17]}>{r.items.join(' · ')}</Text>
          <Text style={[{ color: colors.primary }, literalStyles.s18]}>{r.acronym}</Text>
          {!!r.sentence && <Text style={[{ color: colors.text }, literalStyles.s19]}>“{r.sentence}”</Text>}
          {!!r.rhyme && <Text style={[{ color: colors.text }, literalStyles.s20]}>{r.rhyme}</Text>}
          {!!r.story && <Text style={[{ color: colors.textSecondary }, literalStyles.s19]}>{r.story}</Text>}
        </Card>
      ))}
    </View>
  );
}

// ----------------------------------------------------------------- memory palace
export function PalaceGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const stations: PalaceStation[] = result.game?.data?.stations ?? [];
  const terms: LearningTerm[] = result.game?.data?.terms ?? [];
  const [mode, setMode] = useState<'walk' | 'test'>('walk');
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const record = useRecord(projectId);
  const st = stations[i];
  if (!st) {
    if (mode === 'walk') return (
      <View>
        <Banner>You walked the whole palace. Now test yourself: in each room, name what you placed there.</Banner>
        <GameButton label="Start the test" onPress={() => { setMode('test'); setI(0); setScore(0); }} />
      </View>
    );
    return <Finished score={score} max={stations.length} note="come back tomorrow and in 3 days to lock it in" onAgain={() => { setMode('walk'); setI(0); }} />;
  }
  const clue = terms.find((t) => t.answer === st.term)?.clue ?? '';
  return (
    <View>
      <Text style={{ color: colors.textSecondary }}>{mode === 'walk' ? 'Walk' : 'Test'} · room {i + 1} of {stations.length}</Text>
      <Card highlight={colors.primary}>
        <Text style={{ color: colors.textMuted }}>🏠 {st.room}</Text>
        {mode === 'walk' ? (
          <View>
            <Text style={[{ color: colors.text }, literalStyles.s21]}>{st.term}</Text>
            <Text style={[{ color: colors.text }, literalStyles.s22]}>{st.image}</Text>
            {!!clue && <Text style={[{ color: colors.textSecondary }, literalStyles.s5]}>{clue}</Text>}
            <SourceLinks nums={st.src} result={result} onOpenSource={onOpenSource} />
          </View>
        ) : (
          <View>
            <Text style={[{ color: colors.text }, literalStyles.s23]}>What did you leave in the {st.room.toLowerCase()}?</Text>
            <TextInput value={typed} onChangeText={setTyped} editable={checked === null} autoCapitalize="characters" placeholder="Term" placeholderTextColor={colors.textMuted} style={[{ color: colors.text, backgroundColor: colors.background }, literalStyles.s24]} />
            {checked !== null && <Text style={[{ color: checked ? GOOD : BAD }, literalStyles.s25]}>{checked ? 'Yes!' : `It was ${st.term}: ${st.image}`}</Text>}
          </View>
        )}
      </Card>
      {mode === 'walk' ? <GameButton label="Next room" onPress={() => setI((x) => x + 1)} />
        : checked === null ? <GameButton label="Check" disabled={!typed.trim()} onPress={() => {
          const ok = similarity(typed, st.term) >= 0.8;
          setChecked(ok); if (ok) setScore((s) => s + 1);
          record({ prompt: `Memory palace, ${st.room}: ${clue || st.image}`, answer: st.term, src: st.src }, ok);
        }} />
          : <GameButton label="Next room" onPress={() => { setChecked(null); setTyped(''); setI((x) => x + 1); }} />}
    </View>
  );
}

// ----------------------------------------------------------------- concept map
export function ConceptMapGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const { width } = useWindowDimensions();
  const map: ConceptMap = result.game?.data ?? { nodes: [], edges: [] };
  const laid = useMemo(() => layoutConceptMap(map.nodes, map.edges), [map]);
  const [selected, setSelected] = useState<string | null>(null);
  const [quiz, setQuiz] = useState(false);
  const [qi, setQi] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const record = useRecord(projectId);
  const W = Math.min(width - 32, 760);
  const H = Math.round(W * 0.9);
  const pos = (id: string) => laid.find((n) => n.id === id)!;
  const label = (id: string) => laid.find((n) => n.id === id)?.label ?? id;
  // "Fill the link" quiz: which idea does this arrow connect to?
  const edge = map.edges[qi];
  const options = useMemo(() => {
    if (!edge) return [];
    const wrong = laid.filter((n) => n.id !== edge.to && n.id !== edge.from).map((n) => n.id).slice(0, 3);
    return [edge.to, ...wrong].sort(() => 0.5 - Math.random());
  }, [edge, laid]);
  return (
    <View>
      <View style={literalStyles.s26}>
        <GameButton label="Explore" kind={quiz ? 'plain' : 'primary'} onPress={() => setQuiz(false)} />
        <GameButton label="Quiz the links" kind={quiz ? 'primary' : 'plain'} onPress={() => { setQuiz(true); setQi(0); setScore(0); setPicked(null); }} />
      </View>
      {!quiz ? (
        <View>
          <Banner>Tap an idea to see how it connects.</Banner>
          <Svg width={W} height={H} style={[literalStyles.s27, { backgroundColor: colors.surface }, literalStyles.s28]}>
            {map.edges.map((e, i) => {
              const a = pos(e.from), b = pos(e.to);
              const active = selected && (e.from === selected || e.to === selected);
              return (
                <G key={i}>
                  <Line x1={a.x * W} y1={a.y * H} x2={b.x * W} y2={b.y * H} stroke={active ? colors.primary : colors.textMuted} strokeWidth={active ? 2.5 : 1} />
                  <SvgText x={((a.x + b.x) / 2) * W} y={((a.y + b.y) / 2) * H} fill={colors.textSecondary} fontSize={10} textAnchor="middle">{e.label}</SvgText>
                </G>
              );
            })}
            {laid.map((n) => {
              const w = Math.min(130, 16 + n.label.length * 7);
              return (
                <G key={n.id} onPress={() => setSelected(n.id === selected ? null : n.id)}>
                  <Rect x={n.x * W - w / 2} y={n.y * H - 14} width={w} height={28} rx={14} fill={n.id === selected ? colors.primary : colors.background} stroke={colors.primary} />
                  <SvgText x={n.x * W} y={n.y * H + 4} fill={n.id === selected ? '#fff' : colors.text} fontSize={12} fontWeight="700" textAnchor="middle">{n.label}</SvgText>
                </G>
              );
            })}
          </Svg>
          {selected && map.edges.filter((e) => e.from === selected || e.to === selected).map((e, i) => (
            <Card key={i}><Text style={{ color: colors.text }}>{label(e.from)} <Text style={{ color: colors.primary }}>{e.label}</Text> {label(e.to)}</Text><SourceLinks nums={e.src} result={result} onOpenSource={onOpenSource} /></Card>
          ))}
        </View>
      ) : !edge ? <Finished score={score} max={map.edges.length} onAgain={() => { setQi(0); setScore(0); }} /> : (
        <View>
          <Card><Text style={[{ color: colors.text }, literalStyles.s29]}>{label(edge.from)} <Text style={[{ color: colors.primary }, literalStyles.s30]}>{edge.label}</Text> ...?</Text></Card>
          {options.map((id) => (
            <Choice key={id} label={label(id)} disabled={picked !== null} onPress={() => {
              setPicked(id);
              const ok = id === edge.to;
              if (ok) setScore((s) => s + 1);
              record({ prompt: `${label(edge.from)} ${edge.label} ...?`, answer: label(edge.to), src: edge.src }, ok);
            }} state={picked === null ? null : id === edge.to ? 'right' : id === picked ? 'wrong' : null} />
          ))}
          {picked !== null && <GameButton label="Next link" onPress={() => { setPicked(null); setQi((x) => x + 1); }} />}
        </View>
      )}
    </View>
  );
}
