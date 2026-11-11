import React, { useState } from 'react';
import { StyleSheet, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { Direction2048, empty2048, hasMoves2048, move2048, spawn2048 } from '../utils/game2048';
import { MineGrid, mineResult, newMineGrid, revealMines } from '../utils/minesweeper';
import { moveSnake, newSnake, SnakeDirection } from '../utils/snake';
import { AtlasSudoku } from './AtlasSudoku';
import { AtlasSurvival } from './AtlasSurvival';
import { AtlasTechTree } from './AtlasTechTree';
import { AtlasChessPuzzles } from './AtlasChessPuzzles';
const FONTSIZE_19 = 19;
const FONTSIZE_24 = 24;
const OPACITY_0_3 = 0.3;
const OPACITY_1 = 1;
const literalStyles = StyleSheet.create({
  s1: { padding: 13 },
  s2: { borderWidth: 1, borderRadius: 10, marginBottom: 9 },
  s3: { fontSize: 17 },
  s4: { flexGrow: 1, padding: 24, paddingTop: 48 },
  s5: { fontSize: 26, fontWeight: '700' },
  s6: { marginBottom: 14 },
  s7: { marginBottom: 15 },
  s8: { fontSize: 18, marginBottom: 12 },
  s9: { flexDirection: 'row', justifyContent: 'center' },
  s10: { width: 85, height: 85, margin: 4, borderRadius: 8 },
  s11: { borderWidth: 1 },
  s12: { justifyContent: 'center', alignItems: 'center' },
  s13: { fontSize: 36 },
  s14: { fontSize: 42, textAlign: 'center' },
  s15: { flexDirection: 'row', justifyContent: 'space-around' },
  s16: { padding: 12 },
  s17: { borderRadius: 8 },
  s18: { fontSize: 18 },
  s19: { textAlign: 'center', marginVertical: 25 },
  s20: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  s21: { padding: 18, margin: 5 },
  s22: { borderRadius: 9 },
  s23: { fontSize: 20 },
  s24: { fontSize: 27, textAlign: 'center' },
  s25: { margin: 15 },
  s26: { marginBottom: 12 },
  s27: { width: 67, height: 67, margin: 6, borderRadius: 8, borderWidth: 1 },
  s28: { alignItems: 'center', justifyContent: 'center' },
  s29: { fontSize: 26 },
  s30: { fontSize: 19, marginBottom: 8 },
  s31: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', maxWidth: 340, alignSelf: 'center' },
  s32: { width: 74, height: 74, justifyContent: 'center', alignItems: 'center', margin: 3, borderRadius: 8 },
  s33: { fontWeight: '700' },
  s34: { alignItems: 'center', marginTop: 15 },
  s35: { flexDirection: 'row', gap: 20 },
  s36: { width: 306, flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center', marginBottom: 14 },
  s37: { width: 45, height: 45, margin: 3, borderWidth: 1 },
  s38: { borderRadius: 5 },
  s39: { fontWeight: '700', fontSize: 19 },
  s40: { fontSize: 18, marginBottom: 10 },
  s41: { width: 304, flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center' },
  s42: { width: 34, height: 34, margin: 2, borderRadius: 5, borderWidth: 1 },
  s43: { alignItems: 'center', marginTop: 12 },
  s44: { flexDirection: 'row', gap: 14 },
  s45: { fontSize: 29, textAlign: 'center', letterSpacing: 5, marginBottom: 20 },
  s46: { padding: 10, margin: 3, borderWidth: 1 },
  s47: { borderRadius: 7 },
  s48: { fontSize: 21, marginBottom: 15 },
});


const WORDS = ['PUZZLE','PLANET','JOURNAL','ROBOT','GALAXY','GARDEN','COMPASS','ARCADE'];
const TRIVIA = [
  { q: 'Which planet is known as the Red Planet?', options: ['Venus','Mars','Jupiter','Saturn'], correct: 1 },
  { q: 'What is the largest ocean?', options: ['Atlantic','Indian','Pacific','Arctic'], correct: 2 },
  { q: 'What is 12 × 8?', options: ['84','96','108','98'], correct: 1 },
  { q: 'How many sides does a hexagon have?', options: ['5','6','7','8'], correct: 1 },
  { q: 'Which gas do plants absorb for photosynthesis?', options: ['Oxygen','Nitrogen','Carbon dioxide','Hydrogen'], correct: 2 },
];
type Board = number[];
const emptyBoard = (): Board => Array(9).fill(0);
const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function winner(b: Board): number {
  for (const [a,c,d] of lines) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  return b.every(Boolean) ? 3 : 0;
}
export const evaluateTicTacToe = winner;

export function AtlasGames({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const [game, setGame] = useState<'menu' | 'tic' | 'guess' | 'math' | 'rps' | 'memory' | '2048' | 'mines' | 'snake' | 'word' | 'trivia' | 'sudoku' | 'survival' | 'techtree' | 'chess'>('menu');
  const [word, setWord] = useState('PLANET');
  const [letters, setLetters] = useState<string[]>([]);
  const [triviaIndex, setTriviaIndex] = useState(0);
  const [triviaScore, setTriviaScore] = useState(0);
  const [triviaAnswered, setTriviaAnswered] = useState(false);
  const [snake, setSnake] = useState(() => newSnake());
  const [mines, setMines] = useState<MineGrid>(() => newMineGrid());
  const [placingFlags, setPlacingFlags] = useState(false);
  const [grid2048, setGrid2048] = useState<number[]>(() => spawn2048(spawn2048(empty2048())));
  const [score2048, setScore2048] = useState(0);
  const [rpsResult, setRpsResult] = useState('Choose rock, paper or scissors.');
  const [rpsScore, setRpsScore] = useState({ wins: 0, losses: 0, draws: 0 });
  const [memoryCards, setMemoryCards] = useState<number[]>([1,2,3,4,1,2,3,4]);
  const [memoryOpen, setMemoryOpen] = useState<number[]>([]);
  const [memoryMatched, setMemoryMatched] = useState<number[]>([]);
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [target, setTarget] = useState(() => Math.floor(Math.random() * 100) + 1);
  const [guess, setGuess] = useState(50);
  const [attempts, setAttempts] = useState(0);
  const [submittedGuess, setSubmittedGuess] = useState<number | null>(null);
  const [lastMathCorrect, setLastMathCorrect] = useState<boolean | null>(null);
  const [a, setA] = useState(4);
  const [b, setB] = useState(7);
  const [answer, setAnswer] = useState(0);
  const [score, setScore] = useState(0);
  const start = (id: typeof game) => { setGame(id); setBoard(emptyBoard()); setTarget(Math.floor(Math.random()*100)+1); setGuess(50); setAttempts(0); setSubmittedGuess(null); setLastMathCorrect(null); setScore(0); setA(Math.ceil(Math.random()*12)); setB(Math.ceil(Math.random()*12)); setWord(WORDS[Math.floor(Math.random() * WORDS.length)]); setLetters([]); setTriviaIndex(0); setTriviaScore(0); setTriviaAnswered(false); setSnake(newSnake()); setMines(newMineGrid()); setPlacingFlags(false); setGrid2048(spawn2048(spawn2048(empty2048()))); setScore2048(0); setRpsScore({ wins: 0, losses: 0, draws: 0 }); setRpsResult('Choose rock, paper or scissors.'); setMemoryCards([1,2,3,4,1,2,3,4].sort(() => Math.random()-0.5)); setMemoryOpen([]); setMemoryMatched([]); };
  const press = (label: string, fn: () => void) => <TouchableOpacity onPress={fn} style={[literalStyles.s1, { backgroundColor: colors.surface, borderColor: colors.border }, literalStyles.s2]}><Text style={[{ color: colors.text }, literalStyles.s3]}>{label}</Text></TouchableOpacity>;
  const tic = (idx: number) => {
    if (winner(board) || board[idx]) return;
    const next = [...board]; next[idx] = 1;
    if (!winner(next)) {
      // A deterministic, locally playable opponent: take a win, then block, then center.
      const available = next.map((v, i) => v ? -1 : i).filter(i => i >= 0);
      const winMove = available.find(i => { const copy = [...next]; copy[i] = 2; return winner(copy) === 2; });
      const blockMove = available.find(i => { const copy = [...next]; copy[i] = 1; return winner(copy) === 1; });
      const choice = winMove ?? blockMove ?? (available.includes(4) ? 4 : available[Math.floor(Math.random() * available.length)]);
      if (choice !== undefined) next[choice] = 2;
    }
    setBoard(next);
  };
  const slide2048 = (direction: Direction2048) => {
    const result = move2048(grid2048, direction);
    if (result.moved) {
      setGrid2048(spawn2048(result.board));
      setScore2048(current => current + result.score);
    }
  };
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <ScrollView contentContainerStyle={[literalStyles.s4, { backgroundColor: colors.background }]}>
      <Text style={[literalStyles.s5, { color: colors.text }, literalStyles.s6]}>Atlas Offline Arcade</Text>
      {press(`← ${game === 'menu' ? 'Close' : 'All games'}`, () => game === 'menu' ? onClose() : setGame('menu'))}
      {game === 'menu' && <>
        <Text style={[{ color: colors.textSecondary }, literalStyles.s7]}>Playable locally, with no model, connection or account required.</Text>
        {press('Tic-Tac-Toe — play against Atlas', () => start('tic'))}
        {press('Number Guess — find the secret number', () => start('guess'))}
        {press('Math Sprint — multiplication practice', () => start('math'))}
        {press('Rock Paper Scissors — challenge Atlas', () => start('rps'))}
        {press('Memory Match — find the matching pairs', () => start('memory'))}
        {press('2048 — slide and combine tiles', () => start('2048'))}
        {press('Minesweeper — reveal safe squares', () => start('mines'))}
        {press('Snake — grow without hitting a wall', () => start('snake'))}
        {press('Word Guess — uncover the hidden word', () => start('word'))}
        {press('Trivia — five quick questions', () => start('trivia'))}
        {press('Sudoku — fill the 9×9 number puzzle', () => start('sudoku'))}
        {press('Wilderness Survival — make decisions to stay alive', () => start('survival'))}
        {press('Civilization Tech Tree — research your way to space', () => start('techtree'))}
        {press('Chess Puzzles — solve mate in one', () => start('chess'))}
      </>}
      {game === 'tic' && <>
        <Text style={[{ color: colors.text }, literalStyles.s8]}>{winner(board) === 1 ? 'You win!' : winner(board) === 2 ? 'Atlas wins' : winner(board) === 3 ? 'Draw!' : 'Your turn — X'}</Text>
        {[0,1,2].map(row => <View key={row} style={literalStyles.s9}>
          {[0,1,2].map(col => { const i = row*3+col; return <TouchableOpacity key={i} onPress={() => tic(i)} style={[literalStyles.s10, { backgroundColor: colors.surface }, literalStyles.s11, { borderColor: colors.border }, literalStyles.s12]}><Text style={[{ color: colors.text }, literalStyles.s13]}>{board[i] === 1 ? 'X' : board[i] === 2 ? 'O' : ''}</Text></TouchableOpacity>; })}
        </View>)}
        {press('New round', () => setBoard(emptyBoard))}
      </>}
      {game === 'guess' && <>
        <Text style={[{ color: colors.text }, literalStyles.s8]}>Find the number between 1 and 100. Attempts: {attempts}</Text>
        <Text style={[{ color: colors.text }, literalStyles.s14]}>{guess}</Text>
        <View style={literalStyles.s15}>
          {[-10,-1,1,10].map(delta => <TouchableOpacity key={delta} onPress={() => setGuess(v => Math.max(1,Math.min(100,v+delta)))} style={[literalStyles.s16, { backgroundColor: colors.surface }, literalStyles.s17]}><Text style={{ color: colors.text }}>{delta > 0 ? '+' : ''}{delta}</Text></TouchableOpacity>)}
        </View>
        {press('Submit guess', () => { if (submittedGuess !== target) { setSubmittedGuess(guess); setAttempts(v=>v+1); } })}
        {submittedGuess !== null && <Text style={[{ color: colors.text }, literalStyles.s7]}>{submittedGuess === target ? 'Correct! Secret number found.' : submittedGuess < target ? 'Go higher' : 'Go lower'}</Text>}
        {press('Start over', () => start('guess'))}
      </>}
      {game === 'math' && <>
        <Text style={[{ color: colors.text }, literalStyles.s18]}>Score: {score}</Text>
        <Text style={[literalStyles.s13, { color: colors.text }, literalStyles.s19]}>{a} × {b} = ?</Text>
        <View style={literalStyles.s20}>{[0,1,2,3,4,5,6,7,8,9].map(n => <TouchableOpacity key={n} onPress={() => setAnswer(v => Number(String(v)+n) % 10000)} style={[literalStyles.s21, { backgroundColor: colors.surface }, literalStyles.s22]}><Text style={[{ color: colors.text }, literalStyles.s23]}>{n}</Text></TouchableOpacity>)}</View>
        <Text style={[literalStyles.s24, { color: colors.text }, literalStyles.s25]}>{answer}</Text>
        {press('Clear', () => setAnswer(0))}
        {lastMathCorrect !== null && <Text style={{ color: colors.text }}>{lastMathCorrect ? 'Correct!' : 'Not quite. Keep practicing!'}</Text>}
        {press('Check answer / Next', () => { const correct = answer === a*b; setLastMathCorrect(correct); if (correct) setScore(v=>v+1); setAnswer(0); setA(Math.ceil(Math.random()*12)); setB(Math.ceil(Math.random()*12)); })}
      </>}
      {game === 'rps' && <>
        <Text style={[{ color: colors.text }, literalStyles.s8]}>{rpsResult}</Text>
        <Text style={[{ color: colors.textSecondary }, literalStyles.s26]}>Wins: {rpsScore.wins} · Losses: {rpsScore.losses} · Draws: {rpsScore.draws}</Text>
        {['Rock', 'Paper', 'Scissors'].map((choice, i) => press(choice, () => {
          const theirs = Math.floor(Math.random() * 3);
          const outcome = (i - theirs + 3) % 3;
          setRpsResult(`You: ${choice} · Atlas: ${['Rock', 'Paper', 'Scissors'][theirs]}. ${outcome === 0 ? 'Draw!' : outcome === 1 ? 'You win!' : 'Atlas wins!'}`);
          setRpsScore(s => outcome === 0 ? { ...s, draws: s.draws + 1 } : outcome === 1 ? { ...s, wins: s.wins + 1 } : { ...s, losses: s.losses + 1 });
        }))}
      </>}
      {game === 'memory' && <>
        <Text style={[{ color: colors.text }, literalStyles.s8]}>{memoryMatched.length === memoryCards.length ? 'All pairs matched!' : `${memoryMatched.length / 2} of 4 pairs found`}</Text>
        <View style={literalStyles.s20}>
          {memoryCards.map((value, i) => <TouchableOpacity key={i} onPress={() => {
            if (memoryMatched.includes(i) || memoryOpen.includes(i)) return;
            if (memoryOpen.length === 2) { setMemoryOpen([i]); return; }
            if (memoryOpen.length === 1 && memoryCards[memoryOpen[0]] === value) {
              setMemoryMatched(current => [...current, memoryOpen[0], i]); setMemoryOpen([]);
            } else setMemoryOpen(current => [...current, i]);
          }} style={[literalStyles.s27, { borderColor: colors.border, backgroundColor: colors.surface }, literalStyles.s28]}><Text style={[{ color: colors.text }, literalStyles.s29]}>{memoryMatched.includes(i) || memoryOpen.includes(i) ? value : '?'}</Text></TouchableOpacity>)}
        </View>
        <Text style={[{ color: colors.textSecondary }, literalStyles.s26]}>Choose two cards. If they differ, tap another card to hide them and try again.</Text>
        {press('New round', () => start('memory'))}
      </>}
      {game === '2048' && <>
        <Text style={[{ color: colors.text }, literalStyles.s30]}>2048 · Score: {score2048}</Text>
        {!hasMoves2048(grid2048) && <Text style={{ color: colors.error }}>No moves left. Start a new round.</Text>}
        <View style={literalStyles.s31}>
          {grid2048.map((number, index) => <View key={index} style={[literalStyles.s32, { backgroundColor: colors.surface }, literalStyles.s11, { borderColor: colors.border }]}><Text style={[{ color: colors.text }, literalStyles.s33, { fontSize: number >= 1024 ? FONTSIZE_19 : FONTSIZE_24 }]}>{number || ''}</Text></View>)}
        </View>
        <View style={literalStyles.s34}>
          {press('↑ Up', () => slide2048('up'))}
          <View style={literalStyles.s35}>
            {press('← Left', () => slide2048('left'))}
            {press('↓ Down', () => slide2048('down'))}
            {press('→ Right', () => slide2048('right'))}
          </View>
        </View>
        {press('New 2048 round', () => start('2048'))}
      </>}
      {game === 'mines' && <>
        <Text style={[{ color: colors.text }, literalStyles.s8]}>Minesweeper · {mineResult(mines) === 'won' ? 'You cleared the minefield!' : mineResult(mines) === 'lost' ? 'Mine hit — game over' : 'Find the 7 mines without hitting one.'}</Text>
        <Text style={[{ color: colors.textSecondary }, literalStyles.s26]}>Flags placed: {mines.filter(c => c.flagged).length} · 7 mines</Text>
        {press(placingFlags ? 'Mode: Place flags (tap to switch)' : 'Mode: Reveal cells (tap to switch)', () => setPlacingFlags(v => !v))}
        <View style={literalStyles.s36}>
          {mines.map((cell, index) => <TouchableOpacity key={index} onPress={() => {
            if (mineResult(mines) !== 'playing') return;
            if (placingFlags) { if (!cell.revealed) setMines(cells => cells.map((c, i) => i === index ? { ...c, flagged: !c.flagged } : c)); }
            else setMines(cells => revealMines(cells, index));
          }} style={[literalStyles.s37, { borderColor: colors.border }, literalStyles.s38, { backgroundColor: colors.surface }, literalStyles.s28]}><Text style={[{ color: colors.text }, literalStyles.s39]}>{cell.flagged ? '⚑' : cell.revealed ? (cell.mine ? '✕' : cell.nearby || '') : '?'}</Text></TouchableOpacity>)}
        </View>
        {press('New minefield', () => start('mines'))}
      </>}
      {game === 'snake' && <>
        <Text style={[{ color: colors.text }, literalStyles.s40]}>Snake · Apples: {snake.score} {snake.over ? '· Game over' : ''}</Text>
        <Text style={[{ color: colors.textSecondary }, literalStyles.s26]}>Use the arrows to move one square at a time. Collect the apples and avoid walls and your tail.</Text>
        <View style={literalStyles.s41}>
          {Array.from({ length: snake.size * snake.size }, (_, index) => <View key={index} style={[literalStyles.s42, { borderColor: colors.border, backgroundColor: colors.surface }, literalStyles.s12]}>
            <Text style={[{ color: colors.text }, literalStyles.s23]}>{snake.body[0] === index ? '●' : snake.body.includes(index) ? '•' : snake.food === index ? '◆' : ''}</Text>
          </View>)}
        </View>
        <View style={literalStyles.s43}>
          {press('↑ Up', () => setSnake(state => moveSnake(state, 'up')))}
          <View style={literalStyles.s44}>
            {(['left', 'down', 'right'] as SnakeDirection[]).map(direction => <View key={direction}>{press(direction === 'left' ? '← Left' : direction === 'down' ? '↓ Down' : '→ Right', () => setSnake(state => moveSnake(state, direction)))}</View>)}
          </View>
        </View>
        {press('New Snake game', () => start('snake'))}
      </>}
      {game === 'word' && <>
        <Text style={[{ color: colors.text }, literalStyles.s8]}>Word Guess · Wrong letters: {letters.filter(l => !word.includes(l)).length}/6</Text>
        <Text style={[{ color: colors.text }, literalStyles.s45]}>{word.split('').map(l => letters.includes(l) ? l : '_').join(' ')}</Text>
        {word.split('').every(l => letters.includes(l)) ? <Text style={{ color: colors.text }}>You solved it!</Text> : letters.filter(l => !word.includes(l)).length >= 6 ? <Text style={{ color: colors.text }}>Out of guesses! The word was {word}.</Text> :
          <View style={literalStyles.s20}>
            {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => <TouchableOpacity key={letter} disabled={letters.includes(letter)} onPress={() => setLetters(v => [...v, letter])} style={[literalStyles.s46, { borderColor: colors.border }, literalStyles.s47, { backgroundColor: colors.surface, opacity: letters.includes(letter) ? OPACITY_0_3 : OPACITY_1 }]}><Text style={{ color: colors.text }}>{letter}</Text></TouchableOpacity>)}
          </View>}
        {press('New word', () => start('word'))}
      </>}
      {game === 'trivia' && <>
        <Text style={[{ color: colors.text }, literalStyles.s40]}>Question {Math.min(triviaIndex+1, TRIVIA.length)}/{TRIVIA.length} · Score {triviaScore}</Text>
        {triviaIndex < TRIVIA.length ? <>
          <Text style={[{ color: colors.text }, literalStyles.s48]}>{TRIVIA[triviaIndex].q}</Text>
          {TRIVIA[triviaIndex].options.map((option, index) => press(option, () => {
            if (triviaAnswered) return;
            setTriviaAnswered(true);
            if (index === TRIVIA[triviaIndex].correct) setTriviaScore(s => s + 1);
          }))}
          {triviaAnswered && <>
            <Text style={[{ color: colors.text }, literalStyles.s26]}>Answer: {TRIVIA[triviaIndex].options[TRIVIA[triviaIndex].correct]}</Text>
            {press('Next question', () => { setTriviaIndex(i => i+1); setTriviaAnswered(false); })}
          </>}
        </> : <Text style={[{ color: colors.text }, literalStyles.s23]}>Finished! You got {triviaScore} out of {TRIVIA.length}.</Text>}
        {press('Restart trivia', () => start('trivia'))}
      </>}
      {game === 'sudoku' && <AtlasSudoku />}
      {game === 'survival' && <AtlasSurvival />}
      {game === 'techtree' && <AtlasTechTree />}
      {game === 'chess' && <AtlasChessPuzzles />}
    </ScrollView>
  </Modal>;
}
