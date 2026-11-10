import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { useAppStore } from '../../stores';
import { offGridOn } from '../../atlasTools/offGrid';
import { checkForUpdate, downloadAndInstall, installedBuild, UpdateCancelled, type UpdateInfo } from '../../services/appUpdate';

const mb = (n: number) => `${Math.max(1, Math.round(n / 1e6))} MB`;

/** Settings card: this build, whether a newer one is published, and a button that downloads and installs it. */
export function AppUpdateCard() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const auto = useAppStore((s) => (s.settings as any)?.checkUpdates !== false);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'error'>('idle');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [fraction, setFraction] = useState(0);
  const [message, setMessage] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const cancelRef = useRef<() => void>(() => undefined);
  const build = installedBuild();

  const check = async () => {
    setState('checking'); setMessage('');
    try {
      const r = await checkForUpdate();
      setUpdate(r.update);
      setState(r.update ? 'available' : 'latest');
    } catch (e: any) { setState('error'); setMessage(String(e?.message || e)); }
  };
  // Looking by itself contacts GitHub, so it is skipped in off-grid mode (the button still works when asked).
  useEffect(() => { if (state === 'idle' && auto && !offGridOn()) check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const install = async () => {
    if (!update) return;
    setState('downloading'); setFraction(0);
    try {
      const r = await downloadAndInstall(update, setFraction, (c) => { cancelRef.current = c; });
      setState('available');
      if (r === 'needs-permission') Alert.alert('One setting first', 'Android needs you to allow installs from Atlas. Turn it on in the screen that just opened, come back, and press Download and install again.');
    } catch (e: any) {
      if (e instanceof UpdateCancelled) { setState('available'); return; }
      setState('error'); setMessage(String(e?.message || e));
    }
  };

  const label = state === 'checking' ? 'Checking...' : state === 'latest' ? 'You have the latest build.' : state === 'available' && update ? `${update.name} is available (${mb(update.size)}).` : state === 'downloading' ? `Downloading ${Math.round(fraction * 100)}%` : state === 'error' ? message : 'Not checked yet.';
  return (
    <View style={styles.card} testID="app-update-card">
      <Text style={styles.title}>App updates</Text>
      <Text style={styles.body}>{build ? `This is build ${build}.` : 'This build did not come from the release workflow, so it cannot tell if it is out of date.'}</Text>
      <Text style={state === 'error' ? styles.statusError : styles.status} testID="app-update-status">{label}</Text>
      <View style={styles.buttons}>
        {state === 'available' && update ? (
          <TouchableOpacity onPress={install} testID="app-update-install" accessibilityRole="button" style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Download and install</Text>
          </TouchableOpacity>
        ) : state === 'downloading' ? (
          <>
            <ActivityIndicator color={colors.primary} />
            <TouchableOpacity onPress={() => cancelRef.current()} testID="app-update-cancel" accessibilityRole="button" style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : state === 'checking' ? <ActivityIndicator color={colors.primary} /> : (
          <TouchableOpacity onPress={check} testID="app-update-check" accessibilityRole="button" style={styles.checkButton}>
            <Text style={styles.link}>Check for updates</Text>
          </TouchableOpacity>
        )}
      </View>
      {state === 'available' && !!update?.notes && (
        <View style={styles.notes}>
          <TouchableOpacity onPress={() => setShowNotes((v) => !v)} testID="app-update-notes-toggle" accessibilityRole="button">
            <Text style={styles.notesToggle}>{showNotes ? 'Hide what is new' : 'What is new'}</Text>
          </TouchableOpacity>
          {showNotes && <Text selectable style={styles.notesText} testID="app-update-notes">{update.notes}</Text>}
        </View>
      )}
      <View style={styles.autoRow}>
        <Text style={styles.autoText}>Check when the app opens (contacts GitHub; skipped in off-grid mode)</Text>
        <Switch value={auto} onValueChange={(v) => updateSettings({ checkUpdates: v } as any)} testID="app-update-auto" />
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => {
  const button = { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 };
  return {
    card: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 12 },
    title: { color: colors.text, fontSize: 15, fontWeight: '400' as const },
    body: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
    status: { color: colors.text, fontSize: 13, marginTop: 6 },
    statusError: { color: colors.error, fontSize: 13, marginTop: 6 },
    buttons: { flexDirection: 'row' as const, gap: 8, marginTop: 8, alignItems: 'center' as const },
    primaryButton: { ...button, backgroundColor: colors.primary },
    primaryButtonText: { color: colors.background, fontWeight: '400' as const },
    cancelButton: { ...button, borderWidth: 1, borderColor: colors.border },
    cancelText: { color: colors.text },
    checkButton: { ...button, borderWidth: 1, borderColor: colors.primary },
    link: { color: colors.primary },
    notes: { marginTop: 8 },
    notesToggle: { color: colors.primary, fontSize: 13 },
    notesText: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
    autoRow: { flexDirection: 'row' as const, alignItems: 'center' as const, marginTop: 10 },
    autoText: { flex: 1, color: colors.textSecondary, fontSize: 12, paddingRight: 8 },
  };
};
