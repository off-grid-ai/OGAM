import React, { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { ADDONS, Addon, useAddonDownloads, downloadAddon, cancelAddon, deleteAddon, installedAddonPath, resolveAddon } from '../atlasTools/addons';
const literalStyles = StyleSheet.create({
  s1: { borderRadius: 10, padding: 14, marginBottom: 12 },
  s2: { fontSize: 15, fontWeight: '600' },
  s3: { fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 6 },
  s4: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1 },
  s5: { flex: 1, paddingRight: 8 },
  s6: { fontSize: 14, fontWeight: '600' },
  s7: { fontSize: 12 },
  s8: { height: 4 },
  s9: { borderRadius: 2, marginTop: 6 },
  s10: { borderRadius: 2 },
  s11: { flexDirection: 'row', alignItems: 'center' },
  s12: { marginLeft: 6 },
  s13: { borderWidth: 1 },
  s14: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
});


/** Optional add-on packs (Kiwix) you can download inside the app. */
export function AddonsSection() {
  const { colors } = useTheme();
  const progress = useAddonDownloads((s) => s.progress);
  const resolved = useAddonDownloads((s) => s.resolved);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const refresh = async () => {
    const out: Record<string, boolean> = {};
    for (const a of ADDONS) out[a.id] = !!(await installedAddonPath(a).catch(() => null));
    setInstalled(out);
  };
  useEffect(() => { void refresh(); }, [Object.keys(progress).length]); // eslint-disable-line react-hooks/exhaustive-deps

  const get = async (a: Addon) => {
    try {
      const r = await resolveAddon(a);
      Alert.alert(`Download ${a.name}?`, `${r.file}\nSize: ${r.size || a.approx}\nUse Wi-Fi. You can keep using the app while it downloads (keep the app open).`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Download', onPress: () => { void downloadAddon(a).then(refresh).catch((e) => { if (!/abort|stop|cancel/i.test(String(e?.message))) Alert.alert('Download failed', String(e?.message || e)); return refresh(); }); } },
      ]);
    } catch (e: any) {
      Alert.alert('Could not reach the Kiwix server', String(e?.message || e));
    }
  };

  return (
    <View style={[{ backgroundColor: colors.surface }, literalStyles.s1]}>
      <Text style={[{ color: colors.text }, literalStyles.s2]}>Add-ons to download</Text>
      <Text style={[{ color: colors.textSecondary }, literalStyles.s3]}>
        Optional offline encyclopedias. Nothing is downloaded unless you choose it. Stored in this app's folder (deleted if you uninstall the app).
      </Text>
      {ADDONS.map((a) => {
        const p = progress[a.id];
        const busy = p !== undefined;
        return (
          <View key={a.id} style={[literalStyles.s4, { borderTopColor: colors.border }]}>
            <View style={literalStyles.s5}>
              <Text style={[{ color: colors.text }, literalStyles.s6]}>{a.name}</Text>
              <Text style={[{ color: colors.textSecondary }, literalStyles.s7]}>{a.what} · {resolved[a.id]?.size || a.approx}</Text>
              {busy && (
                <View style={[literalStyles.s8, { backgroundColor: colors.border }, literalStyles.s9]}>
                  <View style={[literalStyles.s8, { width: `${Math.round((p || 0) * 100)}%`, backgroundColor: colors.primary }, literalStyles.s10]} />
                </View>
              )}
            </View>
            {busy ? (
              <TouchableOpacity onPress={() => cancelAddon(a)} style={literalStyles.s11}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[{ color: colors.textSecondary }, literalStyles.s12]}>{Math.round((p || 0) * 100)}% · Stop</Text>
              </TouchableOpacity>
            ) : installed[a.id] ? (
              <TouchableOpacity onPress={() => Alert.alert('Remove add-on?', a.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { deleteAddon(a).then(refresh).catch(() => undefined); } }])}>
                <Text style={{ color: colors.primary }}>Installed ✓</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => get(a)} style={[literalStyles.s13, { borderColor: colors.primary }, literalStyles.s14]}>
                <Text style={{ color: colors.primary }}>Get</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}
