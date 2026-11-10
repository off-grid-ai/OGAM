import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme';
import { listAtlasPacks, installAtlasPack, saveTierToDrive, atlasLibraryProjectId, AtlasPack } from '../atlasTools/atlasPacks';
import { importZipPack } from '../atlasTools/packImport';
import { TIERS, packsForTier, tierBytes, type TierId } from '../atlasTools/emergencyTiers';

const KEY = 'atlas-installed-packs';
const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

/** Download the Atlas library (subject packs) into the "Atlas - Library" project. */
export function AtlasPacksSection() {
  const { colors } = useTheme();
  const [packs, setPacks] = useState<AtlasPack[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<{ name: string; msg: string } | null>(null);
  const [tier, setTier] = useState<TierId>('small');

  const load = async () => {
    setErr(null);
    try { setPacks(await listAtlasPacks()); } catch (e: any) { setErr(String(e?.message || e)); }
  };
  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((v) => { if (v) setInstalled(JSON.parse(v)); }).catch(() => undefined);
    void load();
  }, []);

  const install = async (p: AtlasPack) => {
    setBusy({ name: p.name, msg: 'Starting...' });
    try {
      const r = await installAtlasPack(p, (msg) => setBusy({ name: p.name, msg }));
      const next = { ...installed, [p.name]: p.updated };
      setInstalled(next);
      void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
      Alert.alert('Pack added', `${r.added} added, ${r.skipped} already there${r.failed.length ? `, ${r.failed.length} could not be added` : ''}. Chat in the "Atlas - Library" project (Atlas agent) or use Study there.`);
    } catch (e: any) {
      Alert.alert('Could not add the pack', String(e?.message || e));
    } finally { setBusy(null); }
  };

  const tierPacks = packsForTier(tier, packs ?? []);
  const addTier = async () => {
    for (const p of tierPacks) {
      if (installed[p.name] && installed[p.name] === p.updated) continue;
      await install(p);
    }
  };
  const toDrive = async () => {
    setBusy({ name: `tier-${tier}`, msg: 'Starting...' });
    try {
      const saved = await saveTierToDrive(tier, packs ?? [], (msg) => setBusy({ name: `tier-${tier}`, msg }));
      if (saved) Alert.alert('Saved', `${saved} is on your drive. To use it on any phone with Atlas: Import from a drive (below).`);
    } catch (e: any) { Alert.alert('Could not save the package', String(e?.message || e)); } finally { setBusy(null); }
  };
  const fromDrive = async () => {
    setBusy({ name: 'import', msg: 'Starting...' });
    try {
      const r = await importZipPack(atlasLibraryProjectId(), (msg) => setBusy({ name: 'import', msg }));
      if (r) Alert.alert('Added from the drive', `${r.added} added, ${r.skipped} already there${r.failed.length ? `, ${r.failed.length} could not be added` : ''}.`);
    } catch (e: any) { Alert.alert('Could not add from the drive', String(e?.message || e)); } finally { setBusy(null); }
  };

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Emergency package</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 }}>
        Pick a size. Add it to this phone, or save it as one file on an SD card or flash drive, so you can keep a copy off the phone and load it on another one.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {TIERS.map((t) => (
          <TouchableOpacity key={t.id} onPress={() => setTier(t.id)} testID={`tier-${t.id}`} accessibilityRole="button" accessibilityState={{ selected: tier === t.id }}
            style={{ borderWidth: 1, borderColor: tier === t.id ? colors.primary : colors.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 }}>
            <Text style={{ color: tier === t.id ? colors.primary : colors.text }}>{t.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 8 }}>{TIERS.find((t) => t.id === tier)!.blurb}</Text>
      <Text style={{ color: colors.text, fontSize: 13, marginTop: 4 }} testID="tier-size">
        {packs === null ? 'Looking up the packs...' : `${tierPacks.length} packs, ${mb(tierBytes(tier, packs ?? []))}`}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <TouchableOpacity disabled={!!busy || !tierPacks.length} onPress={addTier} testID="tier-add" accessibilityRole="button"
          style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, opacity: busy || !tierPacks.length ? 0.5 : 1 }}>
          <Text style={{ color: colors.primary }}>Add to this phone</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={!!busy || !tierPacks.length} onPress={toDrive} testID="tier-save" accessibilityRole="button"
          style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, opacity: busy || !tierPacks.length ? 0.5 : 1 }}>
          <Text style={{ color: colors.primary }}>Save to SD card or flash drive</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={!!busy} onPress={fromDrive} testID="tier-import" accessibilityRole="button"
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, opacity: busy ? 0.5 : 1 }}>
          <Text style={{ color: colors.text }}>Import from a drive</Text>
        </TouchableOpacity>
      </View>
      {!!busy && <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6 }}>{busy.msg}</Text>}

      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 16 }}>Atlas library</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 6 }}>
        The Atlas books (medicine, survival, power, farming, rebuilding...) as text, for the AI to search offline. Each subject is a separate download into the "Atlas - Library" project. Use Wi-Fi.
      </Text>
      {err && <Text style={{ color: colors.error, fontSize: 13 }}>{err} <Text style={{ color: colors.primary }} onPress={load}>Retry</Text></Text>}
      {packs === null && !err && <ActivityIndicator color={colors.primary} />}
      {packs?.length === 0 && <Text style={{ color: colors.textMuted, fontSize: 13 }}>No packs published yet. They are being built on GitHub - check back later.</Text>}
      {packs?.map((p) => {
        const isBusy = busy?.name === p.name;
        const have = installed[p.name];
        const outdated = have && have !== p.updated;
        return (
          <View key={p.name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{p.label}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{mb(p.size)}{isBusy ? ` · ${busy?.msg}` : ''}</Text>
            </View>
            {isBusy ? <ActivityIndicator color={colors.primary} /> : have && !outdated ? (
              <Text style={{ color: colors.primary }}>Added ✓</Text>
            ) : (
              <TouchableOpacity disabled={!!busy} onPress={() => install(p)} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, opacity: busy ? 0.5 : 1 }}>
                <Text style={{ color: colors.primary }}>{outdated ? 'Update' : 'Get'}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}
