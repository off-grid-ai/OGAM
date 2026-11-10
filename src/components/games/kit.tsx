/** Shared building blocks for the project learning games. */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme';
import type { Source, StudyResult } from '../../study/engine';
import { useStudyProgress } from '../../study/progress';
const BORDERWIDTH_0 = 0;
const BORDERWIDTH_1 = 1;
const OPACITY_0_5 = 0.5;
const OPACITY_1 = 1;
const COLOR_FFF = '#fff';
const BORDERLEFTWIDTH_4 = 4;
const BORDERLEFTWIDTH_0 = 0;
const literalStyles = StyleSheet.create({
  s1: { marginVertical: 8, lineHeight: 20 },
  s2: { fontSize: 19, fontWeight: '700', marginVertical: 8 },
  s3: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, marginVertical: 5, minHeight: 48, justifyContent: 'center' },
  s4: { textAlign: 'center', fontWeight: '700' },
  s5: { padding: 13, marginVertical: 4, borderRadius: 10, borderWidth: 1 },
  s6: { minHeight: 48, justifyContent: 'center' },
  s7: { fontSize: 15 },
  s8: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  s9: { marginRight: 10, paddingVertical: 4 },
  s10: { fontSize: 12 },
  s11: { borderRadius: 12, padding: 14, marginVertical: 6 },
  s12: { fontWeight: '600', marginVertical: 6 },
  s13: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  s14: { textAlign: 'center', marginTop: 4 },
  s15: { textAlign: 'center', marginTop: 6, fontSize: 12 },
});


export interface GameProps {
  result: StudyResult;
  projectId: string;
  onOpenSource: (s: Source) => void;
}

export function useGameColors() {
  const { colors } = useTheme();
  return colors;
}

export const GOOD = '#16A34A';
export const BAD = '#DC2626';

export function Banner({ children }: { children: React.ReactNode }) {
  const colors = useGameColors();
  return <Text style={[{ color: colors.textSecondary }, literalStyles.s1]}>{children}</Text>;
}

export function Title({ children }: { children: React.ReactNode }) {
  const colors = useGameColors();
  return <Text style={[{ color: colors.text }, literalStyles.s2]}>{children}</Text>;
}

export function GameButton({ label, onPress, disabled, kind = 'primary', accessibilityLabel }: {
  label: string; onPress: () => void; disabled?: boolean; kind?: 'primary' | 'plain'; accessibilityLabel?: string;
}) {
  const colors = useGameColors();
  const primary = kind === 'primary';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[literalStyles.s3, { backgroundColor: primary ? colors.primary : colors.surface, borderWidth: primary ? BORDERWIDTH_0 : BORDERWIDTH_1, borderColor: colors.border, opacity: disabled ? OPACITY_0_5 : OPACITY_1 }]}>
      <Text style={[{ color: primary ? COLOR_FFF : colors.text }, literalStyles.s4]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** A tappable answer option that shows right/wrong after picking. */
export function Choice({ label, onPress, state, disabled }: {
  label: string; onPress: () => void; state?: 'right' | 'wrong' | 'picked' | null; disabled?: boolean;
}) {
  const colors = useGameColors();
  const bg = state === 'right' ? `${GOOD}33` : state === 'wrong' ? `${BAD}33` : state === 'picked' ? `${colors.primary}33` : colors.surface;
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      style={[literalStyles.s5, { borderColor: state === 'right' ? GOOD : state === 'wrong' ? BAD : colors.border, backgroundColor: bg }, literalStyles.s6]}>
      <Text style={[{ color: colors.text }, literalStyles.s7]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function SourceLinks({ nums, result, onOpenSource }: { nums?: number[]; result: StudyResult; onOpenSource: (s: Source) => void }) {
  const colors = useGameColors();
  const list = (nums ?? []).map((n) => result.sources.find((s) => s.n === n)).filter(Boolean) as Source[];
  if (!list.length) return null;
  return (
    <View style={literalStyles.s8}>
      {list.map((s) => (
        <TouchableOpacity key={s.n} onPress={() => onOpenSource(s)} accessibilityLabel={`Source ${s.n}, ${s.doc}`} style={literalStyles.s9}>
          <Text style={[{ color: colors.primary }, literalStyles.s10]}>[{s.n}] {s.doc.replace(/\.(md|txt|pdf)$/i, '').slice(0, 28)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function Card({ children, highlight }: { children: React.ReactNode; highlight?: string }) {
  const colors = useGameColors();
  return (
    <View style={[{ backgroundColor: colors.surface }, literalStyles.s11, { borderLeftWidth: highlight ? BORDERLEFTWIDTH_4 : BORDERLEFTWIDTH_0, borderLeftColor: highlight }]}>
      {children}
    </View>
  );
}

export function ScoreLine({ score, max, extra }: { score: number; max: number; extra?: string }) {
  const colors = useGameColors();
  return <Text style={[{ color: colors.text }, literalStyles.s12]}>Score: {score} / {max}{extra ? ` · ${extra}` : ''}</Text>;
}

/** Report an answer to spaced repetition (all games share one review queue). */
export function useRecord(projectId: string) {
  const record = useStudyProgress((s) => s.record);
  return (prompt: string, answer: string, correct: boolean, src?: number[]) => record(projectId, prompt, answer, correct, src);
}

export function Finished({ score, max, onAgain, note }: { score: number; max: number; onAgain?: () => void; note?: string }) {
  const colors = useGameColors();
  const pct = max ? Math.round((score / max) * 100) : 0;
  return (
    <Card>
      <Text style={[{ color: colors.text }, literalStyles.s13]}>{pct >= 90 ? 'Excellent!' : pct >= 60 ? 'Nice work!' : 'Keep practising!'}</Text>
      <Text style={[{ color: colors.textSecondary }, literalStyles.s14]}>{score} / {max} ({pct}%){note ? ` · ${note}` : ''}</Text>
      <Text style={[{ color: colors.textMuted }, literalStyles.s15]}>Missed items come back in Review due cards.</Text>
      {onAgain && <GameButton label="Play again" onPress={onAgain} />}
    </Card>
  );
}
