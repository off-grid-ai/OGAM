import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
const BORDERWIDTH_2 = 2;
const BORDERWIDTH_0 = 0;
const literalStyles = StyleSheet.create({
  s1: { gap:12 },
  s2: { fontSize:19 },
  s3: { width:304, flexDirection:'row', flexWrap:'wrap', alignSelf:'center' },
  s4: { width:38, height:38, alignItems:'center', justifyContent:'center' },
  s5: { fontSize:25 },
  s6: { padding:13, borderRadius:8 },
  s7: { textAlign:'center' },
});

interface MatePuzzle { whiteKing: string; whiteQueen: string; blackKing: string; mate: string }
const puzzles: MatePuzzle[] = [
  { whiteKing:'f6', whiteQueen:'g6', blackKing:'h8', mate:'g7' },
  { whiteKing:'c6', whiteQueen:'b6', blackKing:'a8', mate:'b7' },
  { whiteKing:'f3', whiteQueen:'g3', blackKing:'h1', mate:'g2' },
  { whiteKing:'c3', whiteQueen:'b3', blackKing:'a1', mate:'b2' },
];
const square = (row: number, col: number): string => String.fromCharCode(97+col)+String(8-row);
export function AtlasChessPuzzles() {
  const {colors}=useTheme();
  const [level,setLevel]=useState(0);
  const [selected,setSelected]=useState(false);
  const [solved,setSolved]=useState(false);
  const [message,setMessage]=useState('');
  const puzzle=puzzles[level];
  const select=(cell:string)=>{
    if (solved) return;
    if (!selected) {
      if (cell===puzzle.whiteQueen) { setSelected(true); setMessage('Queen selected. Tap the mating square.'); }
      else setMessage('Select the white queen first.');
    } else if (cell===puzzle.mate) { setSolved(true); setMessage('Checkmate! The queen is protected by the king.'); }
    else { setSelected(false); setMessage('Not mate in one. Try another queen move.'); }
  };
  return <View style={literalStyles.s1}>
    <Text style={[{ color:colors.text }, literalStyles.s2]}>Chess Puzzles · Mate in One · {level+1}/{puzzles.length}</Text>
    <Text style={{color:colors.textSecondary}}>White to move. Select the white queen, then the square that checkmates the black king. These are curated puzzles, not a full chess engine.</Text>
    <View style={literalStyles.s3}>
      {Array.from({length:64},(_,index)=>{
        const row=Math.floor(index/8),col=index%8,cell=square(row,col);
        const piece=cell===puzzle.whiteQueen?'♕':cell===puzzle.whiteKing?'♔':cell===puzzle.blackKing?'♚':'';
        return <TouchableOpacity key={index} onPress={()=>select(cell)} style={[literalStyles.s4, { backgroundColor:(row+col)%2===0?colors.surface:colors.surfaceLight, borderWidth: cell===puzzle.whiteQueen&&selected ? BORDERWIDTH_2 : BORDERWIDTH_0, borderColor:colors.primary }]}>
          <Text style={[{ color:colors.text }, literalStyles.s5]}>{piece}</Text>
        </TouchableOpacity>;
      })}
    </View>
    {!!message&&<Text style={{color:colors.text}}>{message}</Text>}
    {solved&&<TouchableOpacity onPress={()=>{setLevel(i=>(i+1)%puzzles.length);setSelected(false);setSolved(false);setMessage('');}} style={[literalStyles.s6, { backgroundColor:colors.surface }]}><Text style={[{ color:colors.text }, literalStyles.s7]}>Next puzzle</Text></TouchableOpacity>}
    <TouchableOpacity onPress={()=>{setSelected(false);setSolved(false);setMessage('');}} style={[literalStyles.s6, { backgroundColor:colors.surface }]}><Text style={[{ color:colors.text }, literalStyles.s7]}>Try again</Text></TouchableOpacity>
  </View>;
}
