import React from 'react';
import { Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { lessonsUntilExam, type Space, type SpaceKind } from './board';

const COLS = 4;
/** Space between squares: the track runs through it. */
const GAP = 16;
const TRACK = 6;
const BAND = 6;

/** The coloured band across the top of a square, by kind (like the colour groups of a property board). */
function band(kind: SpaceKind, colors: ThemeColors): string {
  if (kind === 'story' || kind === 'review' || kind === 'call' || kind === 'crossword') return colors.success;
  if (kind === 'podcast' || kind === 'checkpoint') return colors.primary;
  if (kind === 'speed' || kind === 'wordsearch' || kind === 'exam') return colors.error;
  return colors.textMuted;
}

/**
 * The board drawn like a board game: a framed board with the squares in a snake (left to right,
 * then right to left) joined by a track that fills in as squares are finished, START and FINISH
 * squares, a coloured band by kind (lesson, story, podcast, speed round, exam...), a pawn on the
 * square you are on, and a "your turn" button for it.
 */
export function Board({ spaces, isDone, isOpen, current, onPress, onFocus }: {
  spaces: Space[]; isDone: (key: string) => boolean; isOpen: (i: number) => boolean; current: number;
  onPress: (s: Space, i: number) => void;
  /** Told once where the current square's row is (from the top of the board's parent), so the screen can scroll to it. */
  onFocus?: (y: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const inner = Math.min(width, 640) - SPACING.lg * 2 - SPACING.md * 2 - 4;
  const size = Math.floor((inner - GAP * (COLS - 1)) / COLS);
  const rows: Space[][] = [];
  for (let i = 0; i < spaces.length; i += COLS) rows.push(spaces.slice(i, i + COLS));
  // The track between square a and the one after it is lit once a is finished.
  const lit = (a: number) => (spaces[a] && isDone(spaces[a].key) ? colors.primary : colors.border);
  const turn = spaces[current];
  const untilExam = lessonsUntilExam(spaces, current, isDone);
  // Where the current row is: the board's place in its parent + the row's place in the board.
  const place = React.useRef({ wrap: null as number | null, board: null as number | null, row: null as number | null, told: false });
  const located = () => {
    const p = place.current;
    if (p.told || !onFocus || p.wrap === null || p.board === null || p.row === null) return;
    p.told = true;
    onFocus(p.wrap + p.board + p.row);
  };
  return (
    <View style={styles.wrap} testID="language-board" onLayout={(e) => { place.current.wrap = e.nativeEvent.layout.y; located(); }}>
      {!!turn && isOpen(current) && !isDone(turn.key) && (
        <View style={styles.turnCard}>
          <View style={styles.turnText}>
            <Text style={styles.turnLabel}>Your turn</Text>
            <Text style={styles.turnTitle} numberOfLines={1}>{turn.title}</Text>
            {untilExam !== null && <Text style={styles.turnLabel} testID="board-exam-countdown">Exam in {untilExam} {untilExam === 1 ? 'lesson' : 'lessons'}</Text>}
          </View>
          <TouchableOpacity style={styles.turnButton} onPress={() => onPress(turn, current)} testID="board-take-turn" accessibilityLabel={`Play ${turn.title}`}>
            <Icon name="play" size={16} color={colors.background} />
            <Text style={styles.turnButtonText}>Play</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.board} testID="board-squares" onLayout={(e) => { place.current.board = e.nativeEvent.layout.y; located(); }}>
        {rows.map((row, r) => {
          const cells = row.map((s, c) => ({ s, i: r * COLS + c }));
          const ordered = r % 2 ? [...cells].reverse() : cells;
          return (
            <View key={r} testID={`board-row-${r}`} onLayout={r === Math.floor(current / COLS) ? (e) => { place.current.row = e.nativeEvent.layout.y; located(); } : undefined}>
              <View style={[styles.row, r % 2 ? styles.rowReverse : null]}>
                {ordered.map(({ s, i }, k) => {
                  const done = isDone(s.key);
                  const open = isOpen(i);
                  const next = ordered[k + 1];
                  return (
                    <React.Fragment key={s.key}>
                      <TouchableOpacity testID={`space-${s.key}`} disabled={!open} onPress={() => onPress(s, i)}
                        accessibilityLabel={`${s.title}${open ? '' : ', locked'}${done ? ', done' : ''}`}
                        style={[styles.square, { width: size, height: size, backgroundColor: done ? colors.primary : colors.background },
                          i === current && styles.current, !open && styles.locked]}>
                        <View style={[styles.band, { backgroundColor: done ? colors.background : band(s.kind, colors) }]} />
                        <Text style={[styles.number, done && styles.onPrimary]}>{i === 0 ? 'START' : i === spaces.length - 1 ? 'FINISH' : i + 1}</Text>
                        <Icon name={open ? s.icon : 'lock'} size={18} color={done ? colors.background : open ? colors.primary : colors.textMuted} />
                        <Text style={[styles.label, done && styles.onPrimary]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>{s.title}</Text>
                        {i === current && !done && (
                          <View style={styles.pawn} testID="board-pawn"><Icon name="user" size={13} color={colors.background} /></View>
                        )}
                      </TouchableOpacity>
                      {next && <View style={[styles.link, { backgroundColor: lit(Math.min(i, next.i)) }]} />}
                    </React.Fragment>
                  );
                })}
              </View>
              {r < rows.length - 1 && (
                <View style={[styles.turn, r % 2 ? styles.turnLeft : styles.turnRight, { width: size }]}>
                  <View style={[styles.turnLine, { backgroundColor: lit(r * COLS + row.length - 1) }]} />
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  wrap: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, alignSelf: 'center' as const, width: '100%' as const, maxWidth: 640 },
  board: { borderWidth: 2, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface, padding: SPACING.md },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const },
  rowReverse: { justifyContent: 'flex-end' as const },
  square: {
    borderRadius: 8, borderWidth: 2, borderColor: colors.border, padding: 4, paddingTop: BAND + 4, overflow: 'hidden' as const,
    alignItems: 'center' as const, justifyContent: 'center' as const, gap: 2,
  },
  band: { position: 'absolute' as const, top: 0, left: 0, right: 0, height: BAND },
  link: { width: GAP, height: TRACK },
  current: { borderColor: colors.primary, borderWidth: 3 },
  locked: { opacity: 0.45 },
  number: { ...TYPOGRAPHY.meta, color: colors.textMuted, position: 'absolute' as const, top: BAND + 1, left: 4, fontSize: 9 },
  label: { ...TYPOGRAPHY.meta, color: colors.text, textAlign: 'center' as const },
  onPrimary: { color: colors.background },
  pawn: {
    position: 'absolute' as const, top: BAND, right: 2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.error, borderWidth: 2, borderColor: colors.background, alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  turn: { height: GAP * 1.5, alignItems: 'center' as const },
  turnRight: { alignSelf: 'flex-end' as const },
  turnLeft: { alignSelf: 'flex-start' as const },
  turnLine: { width: TRACK, flex: 1, borderRadius: 2 },
  turnCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md, marginBottom: SPACING.md,
    padding: SPACING.md, borderRadius: 12, borderWidth: 2, borderColor: colors.primary,
  },
  turnText: { flex: 1 },
  turnLabel: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  turnTitle: { ...TYPOGRAPHY.h3, color: colors.text },
  turnButton: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.xs,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: 8, backgroundColor: colors.primary,
  },
  turnButtonText: { ...TYPOGRAPHY.label, color: colors.background },
});
