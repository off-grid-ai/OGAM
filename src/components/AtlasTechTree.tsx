import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
const OPACITY_1 = 1;
const OPACITY_0_55 = 0.55;
const literalStyles = StyleSheet.create({
  s1: { gap:12 },
  s2: { fontSize:19 },
  s3: { fontSize:20 },
  s4: { padding:12, borderRadius:9, borderWidth:1 },
  s5: { fontWeight:'600' },
  s6: { fontSize:12 },
  s7: { padding:13 },
  s8: { borderRadius:9 },
  s9: { textAlign:'center' },
});


interface Tech { id: string; name: string; cost: number; requires: string[] }
export const TECH_TREE: Tech[] = [
  { id:'agri', name:'Agriculture', cost:2, requires:[] },
  { id:'pottery', name:'Pottery', cost:2, requires:['agri'] },
  { id:'writing', name:'Writing', cost:2, requires:['pottery'] },
  { id:'math', name:'Mathematics', cost:3, requires:['writing'] },
  { id:'metal', name:'Metallurgy', cost:3, requires:[] },
  { id:'engineering', name:'Engineering', cost:3, requires:['math','metal'] },
  { id:'electricity', name:'Electricity', cost:3, requires:['engineering'] },
  { id:'rocketry', name:'Rocketry', cost:4, requires:['electricity'] },
  { id:'space', name:'Spaceflight', cost:5, requires:['rocketry'] },
  { id:'art', name:'Fine Arts', cost:4, requires:['writing'] },
  { id:'trade', name:'Trade Routes', cost:4, requires:['agri'] },
];

export function AtlasTechTree() {
  const { colors } = useTheme();
  const [unlocked,setUnlocked] = useState<string[]>([]);
  const [science,setScience] = useState(30);
  const [turn,setTurn] = useState(0);
  const won = unlocked.includes('space');
  const research = (tech: Tech) => {
    if (unlocked.includes(tech.id) || won || tech.cost > science || !tech.requires.every(id=>unlocked.includes(id))) return;
    setUnlocked(ids=>[...ids,tech.id]);setScience(value=>value-tech.cost);setTurn(t=>t+1);
  };
  const restart = () => {setUnlocked([]);setScience(30);setTurn(0);};
  return <View style={literalStyles.s1}>
    <Text style={[{ color:colors.text }, literalStyles.s2]}>Civilization Tech Tree</Text>
    <Text style={{color:colors.textSecondary}}>Science: {science} · Research actions: {turn} · Goal: unlock Spaceflight</Text>
    {won && <Text style={[{ color:colors.text }, literalStyles.s3]}>Spaceflight unlocked! Your civilization reached the stars.</Text>}
    {!won && science < 5 && <Text style={{color:colors.error}}>Limited science remains. You may need to restart and avoid optional technologies.</Text>}
    {TECH_TREE.map(tech=>{
      const done=unlocked.includes(tech.id), prerequisites=tech.requires.every(id=>unlocked.includes(id));
      const enabled=!done&&prerequisites&&tech.cost<=science&&!won;
      return <TouchableOpacity key={tech.id} disabled={!enabled} onPress={()=>research(tech)} style={[literalStyles.s4, { borderColor:colors.border, backgroundColor:colors.surface, opacity: enabled||done ? OPACITY_1 : OPACITY_0_55 }]}>
        <Text style={[{ color:colors.text }, literalStyles.s5]}>{done?'✓ ':prerequisites?'◯ ':'🔒 '}{tech.name} · {tech.cost} science</Text>
        <Text style={[{ color:colors.textSecondary }, literalStyles.s6]}>{done?'Researched':tech.requires.length?`Requires: ${tech.requires.map(id=>TECH_TREE.find(t=>t.id===id)?.name).join(', ')}`:'Available from the start'}</Text>
      </TouchableOpacity>;
    })}
    <TouchableOpacity onPress={restart} style={[literalStyles.s7, { backgroundColor:colors.surface }, literalStyles.s8]}><Text style={[{ color:colors.text }, literalStyles.s9]}>Restart civilization</Text></TouchableOpacity>
  </View>;
}
