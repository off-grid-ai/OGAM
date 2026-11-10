import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { sudokuClues, sudokuSolved, sudokuValid } from '../utils/sudoku';
const BORDERWIDTH_2 = 2;
const BORDERWIDTH_1 = 1;
const FONTWEIGHT_700 = '700';
const FONTWEIGHT_400 = '400';
const literalStyles = StyleSheet.create({
  s1: { gap: 12 },
  s2: { fontSize: 18 },
  s3: { width: 315, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap' },
  s4: { width:35, height:35 },
  s5: { alignItems:'center', justifyContent:'center' },
  s6: { fontSize:17 },
  s7: { flexDirection:'row', flexWrap:'wrap', justifyContent:'center' },
  s8: { padding:9, borderRadius:7 },
  s9: { margin:3, minWidth:36, alignItems:'center' },
  s10: { fontSize:18 },
  s11: { padding:13 },
  s12: { borderRadius:8, alignItems:'center' },
});


export function AtlasSudoku() {
  const { colors } = useTheme();
  const [board, setBoard] = useState<number[]>(sudokuClues);
  const [selected, setSelected] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const clues = sudokuClues();
  const put = (value: number) => {
    if (selected === null || clues[selected] !== 0) return;
    const next = [...board]; next[selected] = value;
    if (value !== 0 && !sudokuValid(next)) setMistakes(n=>n+1);
    setBoard(next);
  };
  return <View style={literalStyles.s1}>
    <Text style={[{ color: colors.text }, literalStyles.s2]}>Sudoku · {sudokuSolved(board) ? 'Solved!' : `Mistakes: ${mistakes}`}</Text>
    <Text style={{ color: colors.textSecondary }}>Tap a blank square, then choose 1–9. Rows, columns and 3×3 boxes must contain no duplicates.</Text>
    <View style={literalStyles.s3}>
      {board.map((number,index) => <TouchableOpacity key={index} onPress={() => setSelected(index)} style={[literalStyles.s4, { borderColor: selected===index ? colors.primary : colors.border, borderWidth: selected===index ? BORDERWIDTH_2 : BORDERWIDTH_1, backgroundColor: colors.surface }, literalStyles.s5]}>
        <Text style={[{ color: clues[index] ? colors.text : colors.primary }, literalStyles.s6, { fontWeight: clues[index] ? FONTWEIGHT_700 : FONTWEIGHT_400 }]}>{number || ''}</Text>
      </TouchableOpacity>)}
    </View>
    <View style={literalStyles.s7}>
      {[1,2,3,4,5,6,7,8,9,0].map(n=><TouchableOpacity key={n} onPress={()=>put(n)} style={[literalStyles.s8, { backgroundColor:colors.surface }, literalStyles.s9]}><Text style={[{ color:colors.text }, literalStyles.s10]}>{n || '⌫'}</Text></TouchableOpacity>)}
    </View>
    <TouchableOpacity onPress={()=>{setBoard(sudokuClues());setSelected(null);setMistakes(0);}} style={[literalStyles.s11, { backgroundColor:colors.surface }, literalStyles.s12]}><Text style={{ color:colors.text }}>Restart puzzle</Text></TouchableOpacity>
  </View>;
}
