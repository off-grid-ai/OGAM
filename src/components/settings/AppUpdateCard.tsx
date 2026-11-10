import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme';
import { useAppStore } from '../../stores';
import { offGridOn } from '../../atlasTools/offGrid';
import { checkForUpdate, downloadAndInstall, installedBuild, type UpdateInfo } from '../../services/appUpdate';

const mb = (n: number) => `${Math.max(1, Math.round(n / 1e6))} MB`;

/** Settings card: this build, whether a newer one is published, and a button that downloads and installs it. */
export function AppUpdateCard() {
  const { colors } = useTheme();
  const auto = useAppStore((s) => (s.settings as any)?.checkUpdates !== false);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'error'>('idle');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [fraction, setFraction] = useState(0);
  const [message, setMessage] = useState('');
  const [showNotes, setShowNotes] = useState(false);
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
  useEffect(() => { if (state === 'idle' && auto && !offGridOn()) void check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const install = async () => {
    if (!update) return;
    setState('downloading'); setFraction(0);
    try {
      const r = await downloadAndInstall(update, setFraction);
      setState('available');
      if (r === 'needs-permission') Alert.alert('One setting first', 'Android needs you to allow installs from Atlas. Turn it on in the screen that just opened, come back, and press Download and install again.');
    } catch (e: any) { setState('error'); setMessage(String(e?.message || e)); }
  };

  const label = state === 'checking' ? 'Checking...' : state === 'latest' ? 'You have the latest build.' : state === 'available' && update ? `${update.name} is available (${mb(update.size)}).` : state === 'downloading' ? `Downloading ${Math.round(fraction * 100)}%` : state === 'error' ? message : 'Not checked yet.';
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 12 }} testID="app-update-card">
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>App updates</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>{build ? `This is build ${build}.` : 'This build did not come from the release workflow, so it cannot tell if it is out of date.'}</Text>
      <Text style={{ color: state === 'error' ? colors.error : colors.text, fontSize: 13, marginTop: 6 }} testID="app-update-status">{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' }}>
        {state === 'available' && update ? (
          <TouchableOpacity onPress={install} testID="app-update-install" accessibilityRole="button" style={{ backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: colors.background, fontWeight: '600' }}>Download and install</Text>
          </TouchableOpacity>
        ) : state === 'downloading' || state === 'checking' ? <ActivityIndicator color={colors.primary} /> : (
          <TouchableOpacity onPress={check} testID="app-update-check" accessibilityRole="button" style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: colors.primary }}>Check for updates</Text>
          </TouchableOpacity>
        )}
      </View>
      {state === 'available' && !!update?.notes && (
        <View style={{ marginTop: 8 }}>
          <TouchableOpacity onPress={() => setShowNotes((v) => !v)} testID="app-update-notes-toggle" accessibilityRole="button">
            <Text style={{ color: colors.primary, fontSize: 13 }}>{showNotes ? 'Hide what is new' : 'What is new'}</Text>
          </TouchableOpacity>
          {showNotes && <Text selectable style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }} testID="app-update-notes">{update.notes}</Text>}
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
        <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 12, paddingRight: 8 }}>Check when the app opens (contacts GitHub; skipped in off-grid mode)</Text>
        <Switch value={auto} onValueChange={(v) => updateSettings({ checkUpdates: v } as any)} testID="app-update-auto" />
      </View>
    </View>
  );
}
