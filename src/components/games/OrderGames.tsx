/** True/false speed round, timeline / steps ordering and category sort, from project sources. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { OrderItem, SortData, Statement } from '../../study/games/generate';
import { longestOrderedRun, shuffle } from '../../study/games/logic';
import { Banner, BAD, Card, Finished, GameButton, GOOD, ScoreLine, SourceLinks, useGameColors, useRecord, type GameProps } from './kit';
const WIDTH_50 = '50%';
const literalStyles = StyleSheet.create({
  s1: { marginTop: 4 },
  s2: { flexDirection: 'row', justifyContent: 'space-between' },
  s3: { fontWeight: '800', fontSize: 18 },
  s4: { fontSize: 19, lineHeight: 27, minHeight: 110 },
  s5: { flexDirection: 'row', gap: 10 },
  s6: { flex: 1 },
  s7: { flexDirection: 'row', alignItems: 'center' },
  s8: { width: 24 },
  s9: { fontWeight: '600' },
  s10: { padding: 8 },
  s11: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  s12: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  s13: { padding: 4 },
  s14: { minHeight: 90, borderRadius: 12, padding: 10, borderWidth: 2, borderStyle: 'dashed' },
  s15: { fontWeight: '700' },
  s16: { fontSize: 11 },
  s17: { fontWeight: '700', marginTop: 6 },
});


// ----------------------------------------------------------------- true / false speed round
const ROUND_SECONDS = 60;
export function TrueFalseGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const all: Statement[] = useMemo(() => result.game?.data?.statements ?? [], [result]);
  const [deck, setDeck] = useState<Statement[]>(() => shuffle(all));
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [left, setLeft] = useState(ROUND_SECONDS);
  const [running, setRunning] = useState(false);
  const [wrong, setWrong] = useState<Statement[]>([]);
  const [flash, setFlash] = useState<'right' | 'wrong' | null>(null);
  const record = useRecord(projectId);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setLeft((s) => { if (s <= 1) { setRunning(false); return 0; } return s - 1; }), 1000);
    return () => clearInterval(t);
  }, [running]);
  const over = !running && (left === 0 || i >= deck.length) && i > 0;
  const item = deck[i % Math.max(1, deck.length)];
  const answer = (saysTrue: boolean) => {
    if (!running || !item) return;
    const ok = saysTrue === item.isTrue;
    record(item.text, item.isTrue ? 'True' : `False: ${item.fix}`, ok, item.src);
    setFlash(ok ? 'right' : 'wrong');
    setTimeout(() => setFlash(null), 250);
    if (ok) { setCombo((c) => c + 1); setScore((s) => s + 1 + Math.min(2, Math.floor(combo / 3))); }
    else { setCombo(0); setWrong((w) => [...w, item]); setLeft((s) => Math.max(0, s - 3)); }
    if (i + 1 >= deck.length) setRunning(false);
    setI((x) => x + 1);
  };
  if (!running && i === 0) {
    return (
      <View>
        <Banner>{ROUND_SECONDS} seconds. Tap True or False for each statement from your documents. Streaks multiply points; a wrong answer costs 3 seconds.</Banner>
        <GameButton label="Start" onPress={() => setRunning(true)} />
      </View>
    );
  }
  if (over) {
    return (
      <View>
        <Finished score={score} max={deck.length} note={`${wrong.length} wrong`} onAgain={() => { setDeck(shuffle(all)); setI(0); setScore(0); setCombo(0); setWrong([]); setLeft(ROUND_SECONDS); setRunning(true); }} />
        {wrong.map((w, k) => (
          <Card key={k} highlight={BAD}>
            <Text style={{ color: colors.text }}>{w.text}</Text>
            <Text style={[{ color: colors.textSecondary }, literalStyles.s1]}>{w.isTrue ? 'This was TRUE.' : `FALSE. ${w.fix}`}</Text>
            <SourceLinks nums={w.src} result={result} onOpenSource={onOpenSource} />
          </Card>
        ))}
      </View>
    );
  }
  return (
    <View>
      <View style={literalStyles.s2}>
        <ScoreLine score={score} max={deck.length} extra={combo >= 3 ? `combo x${1 + Math.min(2, Math.floor(combo / 3))}` : undefined} />
        <Text style={[{ color: left <= 10 ? BAD : colors.text }, literalStyles.s3]}>{left}s</Text>
      </View>
      <Card highlight={flash === 'right' ? GOOD : flash === 'wrong' ? BAD : undefined}>
        <Text style={[{ color: colors.text }, literalStyles.s4]}>{item?.text}</Text>
      </Card>
      <View style={literalStyles.s5}>
        <View style={literalStyles.s6}><GameButton label="False" onPress={() => answer(false)} kind="plain" /></View>
        <View style={literalStyles.s6}><GameButton label="True" onPress={() => answer(true)} /></View>
      </View>
    </View>
  );
}

// ----------------------------------------------------------------- timeline / steps
export function TimelineGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const items: OrderItem[] = useMemo(() => result.game?.data?.items ?? [], [result]);
  const kind: string = result.game?.data?.kind ?? 'steps';
  const [order, setOrder] = useState<OrderItem[]>(() => {
    let s = shuffle(items);
    if (s.every((x, k) => x.order === k + 1)) s = [...s.slice(1), s[0]];
    return s;
  });
  const [tries, setTries] = useState(0);
  const [checked, setChecked] = useState(false);
  const record = useRecord(projectId);
  const move = (k: number, d: number) => {
    const j = k + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[k], next[j]] = [next[j], next[k]];
    setOrder(next); setChecked(false);
  };
  const allRight = order.every((x, k) => x.order === k + 1);
  const check = () => {
    setChecked(true);
    const t = tries + 1;
    setTries(t);
    if (allRight || t >= 3) order.forEach((x, k) => record(`${kind === 'dates' ? 'When' : 'Which step'}: ${x.text}`, x.label || String(x.order), x.order === k + 1, x.src));
  };
  const done = checked && (allRight || tries >= 3);
  const partial = longestOrderedRun(order.map((x) => x.order));
  return (
    <View>
      <Banner>{kind === 'dates' ? 'Put these events in time order, earliest first.' : 'Put these steps in the right order.'} Use the arrows, then Check. 3 tries.</Banner>
      {(done ? [...order].sort((a, b) => a.order - b.order) : order).map((x, k) => {
        const right = checked && x.order === k + 1;
        return (
          <Card key={x.text} highlight={checked ? (right || done ? GOOD : BAD) : undefined}>
            <View style={literalStyles.s7}>
              <Text style={[{ color: colors.textMuted }, literalStyles.s8]}>{k + 1}.</Text>
              <View style={literalStyles.s6}>
                <Text style={{ color: colors.text }}>{x.text}</Text>
                {done && !!x.label && <Text style={[{ color: colors.primary }, literalStyles.s9]}>{x.label}</Text>}
                {done && <SourceLinks nums={x.src} result={result} onOpenSource={onOpenSource} />}
              </View>
              {!done && (
                <View>
                  <TouchableOpacity onPress={() => move(k, -1)} accessibilityLabel={`Move ${x.text} up`} style={literalStyles.s10}><Icon name="chevron-up" size={20} color={colors.text} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => move(k, 1)} accessibilityLabel={`Move ${x.text} down`} style={literalStyles.s10}><Icon name="chevron-down" size={20} color={colors.text} /></TouchableOpacity>
                </View>
              )}
            </View>
          </Card>
        );
      })}
      {!done ? <GameButton label={`Check (${3 - tries} left)`} onPress={check} />
        : <Finished score={allRight ? order.length : partial} max={order.length} note={allRight ? `solved in ${tries} ${tries === 1 ? 'try' : 'tries'}` : 'longest correct run'} />}
      {checked && !done && <Text style={{ color: colors.textSecondary }}>{partial} of {order.length} are already in the right relative order.</Text>}
    </View>
  );
}

// ----------------------------------------------------------------- category sort
export function SortGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const data: SortData = result.game?.data ?? { buckets: [], items: [] };
  const deck = useRef(shuffle(data.items)).current;
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState<{ ok: boolean; why: string; src: number[] } | null>(null);
  const [placed, setPlaced] = useState<Record<number, string[]>>({});
  const record = useRecord(projectId);
  const item = deck[i];
  if (!item) return <Finished score={score} max={deck.length} />;
  const drop = (bucket: number) => {
    if (feedback) return;
    const ok = bucket === item.bucket;
    record(item.text, data.buckets[item.bucket], ok, item.src);
    if (ok) setScore((s) => s + 1);
    setPlaced((p) => ({ ...p, [item.bucket]: [...(p[item.bucket] ?? []), item.text] }));
    setFeedback({ ok, why: item.why, src: item.src });
  };
  return (
    <View>
      <Banner>Tap the group this item belongs to.</Banner>
      <ScoreLine score={score} max={deck.length} extra={`item ${i + 1} of ${deck.length}`} />
      <Card><Text style={[{ color: colors.text }, literalStyles.s11]}>{item.text}</Text></Card>
      <View style={literalStyles.s12}>
        {data.buckets.map((b, k) => (
          <View key={b} style={[{ width: data.buckets.length > 2 ? WIDTH_50 : `${100 / data.buckets.length}%` }, literalStyles.s13]}>
            <TouchableOpacity onPress={() => drop(k)} disabled={!!feedback} accessibilityRole="button" accessibilityLabel={`Put in ${b}`}
              style={[literalStyles.s14, { borderColor: feedback && k === item.bucket ? GOOD : colors.border, backgroundColor: colors.surface }]}>
              <Text style={[{ color: colors.text }, literalStyles.s15]}>{b}</Text>
              {(placed[k] ?? []).slice(-3).map((t) => <Text key={t} style={[{ color: colors.textMuted }, literalStyles.s16]} numberOfLines={1}>• {t}</Text>)}
            </TouchableOpacity>
          </View>
        ))}
      </View>
      {feedback && (
        <View>
          <Text style={[{ color: feedback.ok ? GOOD : BAD }, literalStyles.s17]}>{feedback.ok ? 'Right!' : `It belongs in: ${data.buckets[item.bucket]}`}</Text>
          {!!feedback.why && <Text style={{ color: colors.textSecondary }}>{feedback.why}</Text>}
          <SourceLinks nums={feedback.src} result={result} onOpenSource={onOpenSource} />
          <GameButton label="Next" onPress={() => { setFeedback(null); setI((x) => x + 1); }} />
        </View>
      )}
    </View>
  );
}
