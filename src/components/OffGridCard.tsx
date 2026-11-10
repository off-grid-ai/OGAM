import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { useOffGrid } from '../atlasTools/offGrid';
const BACKGROUNDCOLOR_3A0A0A = '#3A0A0A';
const COLOR_FFB4B4 = '#FFB4B4';
const COLOR_E89A9A = '#E89A9A';
const literalStyles = StyleSheet.create({
  s1: { borderRadius: 12, padding: 14, marginBottom: 14 },
  s2: { flexDirection: 'row', alignItems: 'center' },
  s3: { flex: 1, paddingRight: 10 },
  s4: { fontSize: 16, fontWeight: '700' },
  s5: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  s6: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  s7: { flex: 1 },
  s8: { fontSize: 13 },
});


/** Home: one switch for emergency / off-grid use. */
export function OffGridCard() {
  const { colors } = useTheme();
  const on = useOffGrid((s) => s.on);
  const setOn = useOffGrid((s) => s.setOn);
  const night = useOffGrid((s) => s.nightRed);
  const setNight = useOffGrid((s) => s.setNightRed);
  return (
    <View style={[{ backgroundColor: on ? BACKGROUNDCOLOR_3A0A0A : colors.surface }, literalStyles.s1]}>
      <View style={literalStyles.s2}>
        <View style={literalStyles.s3}>
          <Text style={[{ color: on ? COLOR_FFB4B4 : colors.text }, literalStyles.s4]}>Off-grid mode {on ? '· ON' : ''}</Text>
          <Text style={[{ color: on ? COLOR_E89A9A : colors.textSecondary }, literalStyles.s5]}>
            Atlas agent on, no internet tools, low-battery mode on. Everything still works offline.
          </Text>
        </View>
        <Switch value={on} onValueChange={setOn} />
      </View>
      <View style={literalStyles.s6}>
        <Text style={[literalStyles.s7, { color: on ? COLOR_E89A9A : colors.textSecondary }, literalStyles.s8]}>Red night screens (protects night vision, saves battery)</Text>
        <Switch value={night} onValueChange={setNight} />
      </View>
    </View>
  );
}
