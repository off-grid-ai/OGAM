import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { listAtlasPacks, installAtlasPack, saveTierToDrive, atlasLibraryProjectId, AtlasPack } from '../atlasTools/atlasPacks';
import { importZipPack } from '../atlasTools/packImport';
import { TIERS, packsForTier, tierBytes, type TierId } from '../atlasTools/emergencyTiers';

const KEY = 'atlas-installed-packs';
const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

/** Download the Atlas library (subject packs) into the "Atlas - Library" project. */
export function AtlasPacksSection() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
    <View style={styles.card}>
      <Text style={styles.heading}>Emergency package</Text>
      <Text style={styles.body}>
        Pick a size. Add it to this phone, or save it as one file on an SD card or flash drive, so you can keep a copy off the phone and load it on another one.
      </Text>
      <View style={styles.wrap}>
        {TIERS.map((t) => (
          <TouchableOpacity key={t.id} onPress={() => setTier(t.id)} testID={`tier-${t.id}`} accessibilityRole="button" accessibilityState={{ selected: tier === t.id }}
            style={tier === t.id ? styles.tierOn : styles.tier}>
            <Text style={tier === t.id ? styles.link : styles.text}>{t.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.bodyTop}>{TIERS.find((t) => t.id === tier)!.blurb}</Text>
      <Text style={styles.size} testID="tier-size">
        {packs === null ? 'Looking up the packs...' : `${tierPacks.length} packs, ${mb(tierBytes(tier, packs ?? []))}`}
      </Text>
      <View style={styles.wrap}>
        <TouchableOpacity disabled={!!busy || !tierPacks.length} onPress={addTier} testID="tier-add" accessibilityRole="button"
          style={busy || !tierPacks.length ? styles.buttonOff : styles.button}>
          <Text style={styles.link}>Add to this phone</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={!!busy || !tierPacks.length} onPress={toDrive} testID="tier-save" accessibilityRole="button"
          style={busy || !tierPacks.length ? styles.buttonOff : styles.button}>
          <Text style={styles.link}>Save to SD card or flash drive</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={!!busy} onPress={fromDrive} testID="tier-import" accessibilityRole="button"
          style={busy ? styles.plainButtonOff : styles.plainButton}>
          <Text style={styles.text}>Import from a drive</Text>
        </TouchableOpacity>
      </View>
      {!!busy && <Text style={styles.status}>{busy.msg}</Text>}

      <Text style={styles.headingLibrary}>Atlas library</Text>
      <Text style={styles.bodyLibrary}>
        The Atlas books (medicine, survival, power, farming, rebuilding...) as text, for the AI to search offline. Each subject is a separate download into the "Atlas - Library" project. Use Wi-Fi.
      </Text>
      {err && <Text style={styles.error}>{err} <Text style={styles.link} onPress={load}>Retry</Text></Text>}
      {packs === null && !err && <ActivityIndicator color={colors.primary} />}
      {packs?.length === 0 && <Text style={styles.muted}>No packs published yet. They are being built on GitHub - check back later.</Text>}
      {packs?.map((p) => {
        const isBusy = busy?.name === p.name;
        const have = installed[p.name];
        const outdated = have && have !== p.updated;
        return (
          <View key={p.name} style={styles.packRow}>
            <View style={styles.packText}>
              <Text style={styles.packLabel}>{p.label}</Text>
              <Text style={styles.packSize}>{mb(p.size)}{isBusy ? ` · ${busy?.msg}` : ''}</Text>
            </View>
            {isBusy ? <ActivityIndicator color={colors.primary} /> : have && !outdated ? (
              <Text style={styles.link}>Added ✓</Text>
            ) : (
              <TouchableOpacity disabled={!!busy} onPress={() => install(p)} style={busy ? styles.smallButtonOff : styles.smallButton}>
                <Text style={styles.link}>{outdated ? 'Update' : 'Get'}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => {
  const outlined = { borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 };
  const plain = { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 };
  const tier = { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 };
  const body = { color: colors.textSecondary, fontSize: 13, lineHeight: 18 };
  return {
    card: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 12 },
    heading: { color: colors.text, fontSize: 15, fontWeight: '400' as const },
    headingLibrary: { color: colors.text, fontSize: 15, fontWeight: '400' as const, marginTop: 16 },
    body: { ...body, marginTop: 4 },
    bodyTop: { ...body, marginTop: 8 },
    bodyLibrary: { ...body, marginTop: 4, marginBottom: 6 },
    wrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 8 },
    tier,
    tierOn: { ...tier, borderColor: colors.primary },
    text: { color: colors.text },
    link: { color: colors.primary },
    size: { color: colors.text, fontSize: 13, marginTop: 4 },
    button: outlined,
    buttonOff: { ...outlined, opacity: 0.5 },
    plainButton: plain,
    plainButtonOff: { ...plain, opacity: 0.5 },
    smallButton: { ...outlined, paddingVertical: 6 },
    smallButtonOff: { ...outlined, paddingVertical: 6, opacity: 0.5 },
    status: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
    error: { color: colors.error, fontSize: 13 },
    muted: { color: colors.textMuted, fontSize: 13 },
    packRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
    packText: { flex: 1, paddingRight: 8 },
    packLabel: { color: colors.text, fontSize: 14, fontWeight: '400' as const },
    packSize: { color: colors.textSecondary, fontSize: 12 },
  };
};
