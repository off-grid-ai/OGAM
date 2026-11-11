/** Quiz board (Jeopardy), boss battle, exam simulator, spaced-repetition review, daily challenge and podcast quiz. */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { JeopardyCategory, McQuestion, Statement } from '../../study/games/generate';
import { closeEnough, shuffle, type ClozeItem } from '../../study/games/logic';
import { dueItems, nextIntervalLabel, streakFrom, useStudyProgress, type ProgressItem, type Rating, type StudyCard } from '../../study/progress';
import { useStudyStore } from '../../study/engine';
import { speakAndWait, stop } from '../../atlasVoice/tts';
import { Banner, BAD, Card, Choice, Finished, GameButton, GOOD, ScoreLine, SourceLinks, Title, useGameColors, useRecord, type GameProps } from './kit';
const COLOR_FFF = '#fff';
const FONTWEIGHT_800 = '800';
const FONTWEIGHT_400 = '400';
const BACKGROUNDCOLOR_1E3A8A = '#1E3A8A';
const COLOR_FBBF24 = '#FBBF24';
const literalStyles = StyleSheet.create({
  s1: { fontSize: 17, fontWeight: '600', marginBottom: 6 },
  s2: { marginTop: 4 },
  s3: { flexDirection: 'row', gap: 8 },
  s4: { padding: 12, borderRadius: 8 },
  s5: { fontWeight: '700' },
  s6: { fontSize: 17 },
  s7: { fontSize: 20, lineHeight: 28 },
  s8: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  s9: { flexDirection: 'row', gap: 10 },
  s10: { flex: 1 },
  s11: { flex: 1, padding: 3 },
  s12: { fontWeight: '700', textAlign: 'center', minHeight: 36 },
  s13: { height: 56, marginVertical: 3, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  s14: { fontSize: 20, fontWeight: '800' },
  s15: { fontWeight: '700', marginVertical: 6 },
  s16: { flexDirection: 'row' },
  s17: { flexDirection: 'row', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  s18: { padding: 8, borderRadius: 8 },
  s19: { fontSize: 12 },
  s20: { alignItems: 'center' },
  s21: { fontWeight: '800' },
  s22: { width: '80%', height: 12, borderRadius: 6 },
  s23: { marginVertical: 6 },
  s24: { height: 12, borderRadius: 6 },
  s25: { flexDirection: 'row', justifyContent: 'space-between' },
  s26: { borderRadius: 8, padding: 12, marginTop: 8 },
  s27: { fontSize: 19, minHeight: 90, marginTop: 6 },
  s28: { flexDirection: 'row', gap: 6 },
  s29: { flex: 1, padding: 10, borderRadius: 8 },
  s30: { fontSize: 11 },
  s31: { fontSize: 18 },
  s32: { borderRadius: 8, padding: 12 },
  s33: { fontSize: 18, fontWeight: '700' },
});


/** One multiple-choice question with feedback. */
export function McView({ q, onAnswer, result, onOpenSource, revealNow = true }: {
  q: McQuestion; onAnswer: (ok: boolean) => void; result: GameProps['result']; onOpenSource: GameProps['onOpenSource']; revealNow?: boolean;
}) {
  const colors = useGameColors();
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [q]);
  return (
    <View>
      <Text style={[{ color: colors.text }, literalStyles.s1]}>{q.q}</Text>
      {q.options.map((o, k) => (
        <Choice key={k} label={o} disabled={picked !== null}
          onPress={() => { setPicked(k); onAnswer(k === q.answer); }}
          state={picked === null ? null : !revealNow ? (k === picked ? 'picked' : null) : k === q.answer ? 'right' : k === picked ? 'wrong' : null} />
      ))}
      {picked !== null && revealNow && (
        <View>
          {!!q.why && <Text style={[{ color: colors.textSecondary }, literalStyles.s2]}>{q.why}</Text>}
          <SourceLinks nums={q.src} result={result} onOpenSource={onOpenSource} />
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------- Jeopardy-style board
export function JeopardyGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const board: JeopardyCategory[] = result.game?.data?.board ?? [];
  const [players, setPlayers] = useState<string[]>(['Player 1']);
  const [scores, setScores] = useState<number[]>([0]);
  const [turn, setTurn] = useState(0);
  const [used, setUsed] = useState<string[]>([]);
  const [open, setOpen] = useState<{ c: number; k: number } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [started, setStarted] = useState(false);
  const [col, setCol] = useState(0);
  const record = useRecord(projectId);
  const total = board.reduce((n, c) => n + c.clues.length, 0);
  if (!started) {
    return (
      <View>
        <Banner>Pass the phone around. Each player taps a tile, says the answer out loud, then reveals it and marks themselves right or wrong.</Banner>
        <Text style={{ color: colors.text }}>Players: {players.length}</Text>
        <View style={literalStyles.s3}>
          {[1, 2, 3, 4].map((n) => (
            <TouchableOpacity key={n} onPress={() => { setPlayers(Array.from({ length: n }, (_, i) => `Player ${i + 1}`)); setScores(Array(n).fill(0)); }}
              style={[literalStyles.s4, { backgroundColor: players.length === n ? colors.primary : colors.surface }]}>
              <Text style={[{ color: players.length === n ? COLOR_FFF : colors.text }, literalStyles.s5]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <GameButton label="Start" onPress={() => setStarted(true)} />
      </View>
    );
  }
  if (used.length === total) {
    const best = Math.max(...scores);
    return (
      <View>
        <Title>Final scores</Title>
        {players.map((p, i) => <Text key={p} style={[{ color: scores[i] === best ? GOOD : colors.text }, literalStyles.s6, { fontWeight: scores[i] === best ? FONTWEIGHT_800 : FONTWEIGHT_400 }]}>{p}: {scores[i]}</Text>)}
        <GameButton label="Play again" onPress={() => { setUsed([]); setScores(Array(players.length).fill(0)); setTurn(0); }} />
      </View>
    );
  }
  if (open) {
    const clue = board[open.c].clues[open.k];
    const mark = (ok: boolean) => {
      record({ prompt: clue.clue, answer: clue.answer, src: clue.src }, ok);
      setScores((s) => s.map((v, i) => (i === turn ? v + (ok ? clue.value : -Math.round(clue.value / 2)) : v)));
      setUsed((u) => [...u, `${open.c}:${open.k}`]);
      setOpen(null); setRevealed(false); setTurn((t) => (t + 1) % players.length);
    };
    return (
      <View>
        <Text style={{ color: colors.textSecondary }}>{players[turn]} · {board[open.c].name} for {clue.value}</Text>
        <Card><Text style={[{ color: colors.text }, literalStyles.s7]}>{clue.clue}</Text></Card>
        {!revealed ? <GameButton label="Reveal answer" onPress={() => setRevealed(true)} /> : (
          <View>
            <Text style={[{ color: colors.primary }, literalStyles.s8]}>{clue.answer}</Text>
            <SourceLinks nums={clue.src} result={result} onOpenSource={onOpenSource} />
            <View style={literalStyles.s9}>
              <View style={literalStyles.s10}><GameButton label="I was wrong" kind="plain" onPress={() => mark(false)} /></View>
              <View style={literalStyles.s10}><GameButton label="I was right" onPress={() => mark(true)} /></View>
            </View>
          </View>
        )}
      </View>
    );
  }
  // Phones show one category column at a time; tablets show the whole board.
  const Column = ({ c }: { c: number }) => (
    <View style={literalStyles.s11}>
      <Text style={[{ color: colors.text }, literalStyles.s12]} numberOfLines={2}>{board[c].name}</Text>
      {board[c].clues.map((cl, k) => {
        const gone = used.includes(`${c}:${k}`);
        return (
          <TouchableOpacity key={k} disabled={gone} onPress={() => setOpen({ c, k })} accessibilityLabel={`${board[c].name} for ${cl.value}`}
            style={[literalStyles.s13, { backgroundColor: gone ? colors.surface : BACKGROUNDCOLOR_1E3A8A }]}>
            <Text style={[{ color: gone ? colors.textMuted : COLOR_FBBF24 }, literalStyles.s14]}>{gone ? '' : cl.value}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
  return (
    <View>
      <Text style={{ color: colors.textSecondary }}>{players.map((p, i) => `${p}: ${scores[i]}`).join('   ')}</Text>
      <Text style={[{ color: colors.text }, literalStyles.s15]}>{players[turn]}, pick a tile</Text>
      <View style={literalStyles.s16}>
        {board.length <= 2 ? board.map((_, c) => <Column key={c} c={c} />) : <Column c={col} />}
      </View>
      {board.length > 2 && (
        <View style={literalStyles.s17}>
          {board.map((b, c) => (
            <TouchableOpacity key={b.name} onPress={() => setCol(c)} style={[literalStyles.s18, { backgroundColor: col === c ? colors.primary : colors.surface }]}>
              <Text style={[{ color: col === c ? COLOR_FFF : colors.text }, literalStyles.s19]}>{b.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------- boss battle
const BOSS_COLORS = ['#7C3AED', '#DC2626', '#059669', '#D97706', '#2563EB', '#DB2777'];
function BossArt({ n, hurt }: { n: number; hurt: boolean }) {
  const c = BOSS_COLORS[n % BOSS_COLORS.length];
  return (
    <Svg width={140} height={120} viewBox="0 0 140 120">
      <Path d={n % 2 ? 'M20 110 Q70 -10 120 110 Z' : 'M15 110 Q15 20 70 20 Q125 20 125 110 Z'} fill={hurt ? '#F87171' : c} />
      <Circle cx={50} cy={60} r={11} fill="#fff" /><Circle cx={90} cy={60} r={11} fill="#fff" />
      <Circle cx={hurt ? 47 : 52} cy={62} r={5} fill="#111" /><Circle cx={hurt ? 87 : 92} cy={62} r={5} fill="#111" />
      <Rect x={48} y={85} width={44} height={8} rx={4} fill="#111" />
      {n % 3 === 0 && <Path d="M40 25 L50 5 L58 22 M82 22 L90 5 L100 25" stroke={c} strokeWidth={6} fill="none" />}
    </Svg>
  );
}
export function BossGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const questions: McQuestion[] = result.game?.data?.questions ?? [];
  const boss: number = result.game?.data?.boss ?? 0;
  const maxHp = questions.reduce((n, q) => n + (q.difficulty ?? 2) * 10, 0);
  const [i, setI] = useState(0);
  const [hp, setHp] = useState(maxHp);
  const [hearts, setHearts] = useState(3);
  const [streak, setStreak] = useState(0);
  const [hurt, setHurt] = useState(false);
  const [answered, setAnswered] = useState(false);
  const record = useRecord(projectId);
  const name = result.topic || result.sources[0]?.doc.replace(/\.(md|txt|pdf)$/i, '') || 'The Topic';
  const won = hp <= 0;
  const lost = hearts <= 0 || (!won && i >= questions.length);
  if (won || lost) {
    return (
      <View style={literalStyles.s20}>
        <BossArt n={boss} hurt={won} />
        <Title>{won ? `You defeated ${name}!` : `${name} wins this time`}</Title>
        <GameButton label="Fight again" onPress={() => { setI(0); setHp(maxHp); setHearts(3); setStreak(0); setAnswered(false); }} />
      </View>
    );
  }
  const q = questions[i];
  return (
    <View>
      <View style={literalStyles.s20}>
        <BossArt n={boss} hurt={hurt} />
        <Text style={[{ color: colors.text }, literalStyles.s21]}>{name}</Text>
        <View style={[literalStyles.s22, { backgroundColor: colors.surface }, literalStyles.s23]}>
          <View style={[{ width: `${Math.max(0, (hp / maxHp) * 100)}%` }, literalStyles.s24, { backgroundColor: BAD }]} />
        </View>
        <Text style={{ color: colors.text }}>{'♥'.repeat(hearts)}{'♡'.repeat(3 - hearts)}{streak >= 2 ? `   streak x${streak}` : ''}</Text>
      </View>
      <Card>
        <McView q={q} result={result} onOpenSource={onOpenSource} onAnswer={(ok) => {
          setAnswered(true);
          record({ prompt: q.q, answer: q.options[q.answer], src: q.src }, ok);
          if (ok) {
            const dmg = (q.difficulty ?? 2) * 10 + streak * 5;
            setHp((h) => h - dmg); setStreak((s) => s + 1); setHurt(true); setTimeout(() => setHurt(false), 400);
          } else { setHearts((h) => h - 1); setStreak(0); }
        }} />
      </Card>
      {answered && <GameButton label="Next attack" onPress={() => { setAnswered(false); setI((x) => x + 1); }} />}
    </View>
  );
}

// ----------------------------------------------------------------- exam simulator
type ExamQ = { kind: 'mc'; q: McQuestion } | { kind: 'tf'; s: Statement } | { kind: 'cloze'; c: ClozeItem };
export function ExamGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const data = result.game?.data ?? {};
  const all: ExamQ[] = useMemo(() => shuffle([
    ...(data.mc ?? []).map((q: McQuestion) => ({ kind: 'mc' as const, q })),
    ...(data.tf ?? []).map((s: Statement) => ({ kind: 'tf' as const, s })),
    ...(data.cloze ?? []).map((c: ClozeItem) => ({ kind: 'cloze' as const, c })),
  ], result.createdAt), [data, result.createdAt]);
  const [started, setStarted] = useState(false);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [left, setLeft] = useState((data.minutes ?? 10) * 60);
  const [typed, setTyped] = useState('');
  const record = useRecord(projectId);
  useEffect(() => {
    if (!started || i >= all.length) return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [started, i, all.length]);
  const finished = started && (i >= all.length || left === 0);
  const answer = (ok: boolean, card: StudyCard) => {
    record(card, ok);
    setAnswers((a) => [...a, ok]); setTyped('');
    setTimeout(() => setI((x) => x + 1), 250);
  };
  if (!started) {
    return (
      <View>
        <Banner>{all.length} questions, {data.minutes ?? 10} minutes. No feedback until the end, like a real exam.</Banner>
        <GameButton label="Start exam" onPress={() => setStarted(true)} />
      </View>
    );
  }
  if (finished) {
    const score = answers.filter(Boolean).length;
    return (
      <View>
        <Finished score={score} max={all.length} note={left === 0 ? 'time ran out' : `${Math.round(((data.minutes ?? 10) * 60 - left) / 60)} min`} />
        <Title>Review</Title>
        {all.map((x, k) => {
          const ok = answers[k];
          const prompt = x.kind === 'mc' ? x.q.q : x.kind === 'tf' ? x.s.text : x.c.sentence;
          const ans = x.kind === 'mc' ? x.q.options[x.q.answer] : x.kind === 'tf' ? (x.s.isTrue ? 'True' : `False: ${x.s.fix}`) : x.c.answer;
          const src = x.kind === 'mc' ? x.q.src : x.kind === 'tf' ? x.s.src : x.c.src;
          return (
            <Card key={k} highlight={ok === undefined ? colors.textMuted : ok ? GOOD : BAD}>
              <Text style={{ color: colors.text }}>{k + 1}. {prompt}</Text>
              <Text style={{ color: colors.textSecondary }}>Answer: {ans}{ok === undefined ? ' (not answered)' : ''}</Text>
              <SourceLinks nums={src} result={result} onOpenSource={onOpenSource} />
            </Card>
          );
        })}
      </View>
    );
  }
  const x = all[i];
  return (
    <View>
      <View style={literalStyles.s25}>
        <Text style={{ color: colors.text }}>Question {i + 1} of {all.length}</Text>
        <Text style={[{ color: left < 60 ? BAD : colors.text }, literalStyles.s5]}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</Text>
      </View>
      <Card>
        {x.kind === 'mc' && <McView key={i} q={x.q} result={result} onOpenSource={onOpenSource} revealNow={false} onAnswer={(ok) => answer(ok, { prompt: x.q.q, answer: x.q.options[x.q.answer], src: x.q.src })} />}
        {x.kind === 'tf' && (
          <View>
            <Text style={[{ color: colors.text }, literalStyles.s6]}>True or false: {x.s.text}</Text>
            <View style={literalStyles.s9}>
              <View style={literalStyles.s10}><GameButton label="False" kind="plain" onPress={() => answer(!x.s.isTrue, { prompt: x.s.text, answer: x.s.isTrue ? 'True' : 'False', src: x.s.src })} /></View>
              <View style={literalStyles.s10}><GameButton label="True" onPress={() => answer(x.s.isTrue, { prompt: x.s.text, answer: x.s.isTrue ? 'True' : 'False', src: x.s.src })} /></View>
            </View>
          </View>
        )}
        {x.kind === 'cloze' && (
          <View>
            <Text style={[{ color: colors.text }, literalStyles.s6]}>{x.c.sentence}</Text>
            <TextInput value={typed} onChangeText={setTyped} autoCapitalize="characters" placeholder="Missing word" placeholderTextColor={colors.textMuted} style={[{ color: colors.text, backgroundColor: colors.background }, literalStyles.s26]} />
            <GameButton label="Answer" disabled={!typed.trim()} onPress={() => answer(closeEnough(typed, x.c.answer), { prompt: x.c.sentence, answer: x.c.answer, src: x.c.src })} />
          </View>
        )}
      </Card>
    </View>
  );
}

// ----------------------------------------------------------------- spaced-repetition review
const RATINGS: { r: Rating; label: string }[] = [
  { r: 'again', label: 'Again' }, { r: 'hard', label: 'Hard' }, { r: 'good', label: 'Good' }, { r: 'easy', label: 'Easy' },
];
export function ReviewGame({ projectId }: GameProps) {
  const colors = useGameColors();
  const items = useStudyProgress((s) => s.items);
  const rate = useStudyProgress((s) => s.rate);
  const [queue, setQueue] = useState<ProgressItem[]>(() => dueItems(projectId, Date.now(), 40));
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const total = Object.values(items).filter((x) => x.projectId === projectId).length;
  const item = queue[0];
  if (!item) {
    const nextDue = Object.values(items).filter((x) => x.projectId === projectId).sort((a, b) => a.due - b.due)[0];
    return (
      <Card>
        <Title>{done ? `Done! ${done} reviewed.` : 'Nothing due right now.'}</Title>
        <Text style={{ color: colors.textSecondary }}>{total ? `${total} items in this project's review deck.` : 'Play any project game or make flashcards; what you learn appears here for review.'}</Text>
        {!!nextDue && <Text style={[{ color: colors.textSecondary }, literalStyles.s2]}>Next review: {new Date(nextDue.due).toLocaleString()}</Text>}
        <GameButton label="Check again" kind="plain" onPress={() => setQueue(dueItems(projectId, Date.now(), 40))} />
      </Card>
    );
  }
  return (
    <View>
      <Text style={{ color: colors.textSecondary }}>{queue.length} due · {done} done today</Text>
      <TouchableOpacity onPress={() => setFlipped((f) => !f)} accessibilityRole="button" accessibilityLabel={flipped ? `Answer: ${item.answer}` : `Question: ${item.prompt}. Tap to show the answer.`}>
        <Card>
          <Text style={[{ color: colors.textMuted }, literalStyles.s19]}>{flipped ? 'Answer' : 'Question (tap to flip)'}</Text>
          <Text style={[{ color: colors.text }, literalStyles.s27]}>{flipped ? item.answer : item.prompt}</Text>
        </Card>
      </TouchableOpacity>
      {flipped ? (
        <View style={literalStyles.s28}>
          {RATINGS.map(({ r, label }) => (
            <TouchableOpacity key={r} onPress={() => { rate(item.key, r); setFlipped(false); setDone((d) => d + 1); setQueue((q) => (r === 'again' ? [...q.slice(1), item] : q.slice(1))); }}
              accessibilityRole="button" accessibilityLabel={`${label}, next in ${nextIntervalLabel(item, r)}`}
              style={[literalStyles.s29, { backgroundColor: r === 'again' ? `${BAD}33` : r === 'easy' ? `${GOOD}33` : colors.surface }, literalStyles.s20]}>
              <Text style={[{ color: colors.text }, literalStyles.s5]}>{label}</Text>
              <Text style={[{ color: colors.textMuted }, literalStyles.s30]}>{nextIntervalLabel(item, r)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : <GameButton label="Show answer" onPress={() => setFlipped(true)} />}
    </View>
  );
}

// ----------------------------------------------------------------- daily challenge
export function DailyGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const doneDays = useStudyProgress((s) => s.doneDays);
  const markDailyDone = useStudyProgress((s) => s.markDailyDone);
  const record = useRecord(projectId);
  const saved = useStudyStore((s) => s.saved[projectId]) || [];
  // Mix: due review items, plus true/false statements and blanks from saved games.
  const tasks = useMemo(() => {
    const due = dueItems(projectId, Date.now(), 5).map((x) => ({ kind: 'card' as const, prompt: x.prompt, answer: x.answer, src: x.src ?? [] }));
    const tf: Statement[] = saved.flatMap((r) => (r.game?.type === 'truefalse' ? r.game.data.statements : r.game?.type === 'exam' ? r.game.data.tf ?? [] : []));
    const cz: ClozeItem[] = saved.flatMap((r) => (r.game?.type === 'cloze' ? r.game.data.items : r.game?.type === 'exam' ? r.game.data.cloze ?? [] : []));
    return [
      ...due,
      ...shuffle(tf, Date.parse(new Date().toISOString().slice(0, 10))).slice(0, 2).map((s) => ({ kind: 'tf' as const, prompt: s.text, answer: s.isTrue ? 'True' : `False: ${s.fix}`, isTrue: s.isTrue, src: s.src })),
      ...shuffle(cz, 7).slice(0, 1).map((c) => ({ kind: 'cloze' as const, prompt: c.sentence, answer: c.answer, src: c.src })),
    ].slice(0, 8);
  }, [projectId, saved]);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [typed, setTyped] = useState('');
  const [score, setScore] = useState(0);
  const today = new Date().toISOString().slice(0, 10);
  const streak = streakFrom(doneDays, today);
  useEffect(() => { if (tasks.length && i >= tasks.length) markDailyDone(); }, [i, tasks.length, markDailyDone]);
  if (!tasks.length) {
    return (
      <Card>
        <Title>Streak: {streak} day{streak === 1 ? '' : 's'}</Title>
        <Text style={{ color: colors.textSecondary }}>Nothing to practise yet. Play a few games in this project (true or false, fill the blanks, any term game) and the daily challenge fills itself.</Text>
      </Card>
    );
  }
  if (i >= tasks.length) {
    return <Finished score={score} max={tasks.length} note={`streak ${streakFrom([...doneDays, today], today)} days`} />;
  }
  const t = tasks[i];
  const next = (ok: boolean) => { record({ prompt: t.prompt, answer: t.answer, src: t.src }, ok); if (ok) setScore((s) => s + 1); setShown(false); setTyped(''); setI((x) => x + 1); };
  return (
    <View>
      <Text style={{ color: colors.textSecondary }}>Daily challenge · {i + 1} of {tasks.length} · streak {streak} 🔥</Text>
      <Card>
        <Text style={[{ color: colors.text }, literalStyles.s31]}>{t.kind === 'tf' ? `True or false: ${t.prompt}` : t.prompt}</Text>
        <SourceLinks nums={t.src} result={result} onOpenSource={onOpenSource} />
      </Card>
      {t.kind === 'tf' ? (
        <View style={literalStyles.s9}>
          <View style={literalStyles.s10}><GameButton label="False" kind="plain" onPress={() => next(!(t as any).isTrue)} /></View>
          <View style={literalStyles.s10}><GameButton label="True" onPress={() => next(!!(t as any).isTrue)} /></View>
        </View>
      ) : t.kind === 'cloze' ? (
        <View>
          <TextInput value={typed} onChangeText={setTyped} autoCapitalize="characters" placeholder="Missing word" placeholderTextColor={colors.textMuted} style={[{ color: colors.text, backgroundColor: colors.surface }, literalStyles.s32]} />
          <GameButton label="Answer" disabled={!typed.trim()} onPress={() => next(closeEnough(typed, t.answer))} />
        </View>
      ) : !shown ? <GameButton label="Show answer" onPress={() => setShown(true)} /> : (
        <View>
          <Text style={[{ color: colors.primary }, literalStyles.s33]}>{t.answer}</Text>
          <View style={literalStyles.s9}>
            <View style={literalStyles.s10}><GameButton label="Didn't know" kind="plain" onPress={() => next(false)} /></View>
            <View style={literalStyles.s10}><GameButton label="Knew it" onPress={() => next(true)} /></View>
          </View>
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------- podcast quiz
export function PodcastQuizGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const data = result.game?.data ?? {};
  const questions: McQuestion[] = data.questions ?? [];
  const lines: { host: string; text: string }[] = data.lines ?? [];
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const record = useRecord(projectId);
  useEffect(() => () => stop(), []);
  if (i >= questions.length) return <Finished score={score} max={questions.length} />;
  const q = questions[i];
  const replay = async () => {
    const line = lines[q.line ?? 0];
    if (!line) return;
    setReplaying(true);
    await speakAndWait(line.text, { messageId: 'podcast-quiz' });
    setReplaying(false);
  };
  return (
    <View>
      <ScoreLine score={score} max={questions.length} extra={`question ${i + 1}`} />
      <Card>
        <McView q={q} result={result} onOpenSource={onOpenSource} onAnswer={(ok) => { setAnswered(true); if (ok) setScore((s) => s + 1); record({ prompt: q.q, answer: q.options[q.answer] }, ok); }} />
      </Card>
      {answered && (
        <View>
          {!!lines[q.line ?? 0] && (
            <Card><Text style={[{ color: colors.textMuted }, literalStyles.s19]}>The part that answers it:</Text><Text style={{ color: colors.text }}>{lines[q.line ?? 0].text}</Text></Card>
          )}
          <GameButton label={replaying ? 'Playing...' : 'Replay that part'} kind="plain" disabled={replaying} onPress={replay} />
          <GameButton label="Next question" onPress={() => { stop(); setAnswered(false); setI((x) => x + 1); }} />
        </View>
      )}
    </View>
  );
}

