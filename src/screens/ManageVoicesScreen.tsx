/**
 * Manage the enrolled voices — the privacy + control surface for voice fingerprinting.
 *
 * Lists every saved voiceprint (name, sample count, which model made it), lets the user rename or
 * delete one (a voiceprint never leaves the device, and delete forgets it entirely), tune match
 * sensitivity, and jump to enrollment to add a new voice. Brand: Menlo, light weights, 8px radius.
 */
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { TYPOGRAPHY, SPACING } from '../constants';
import { speakerEmbeddingModelById } from '@offgrid/models';
import { useSpeakerProfilesStore } from '../stores/speakerProfilesStore';
import { useSpeakerModelStore } from '../stores/speakerModelStore';

const SENSITIVITY = [
  { label: 'Lenient', value: 0.6, hint: 'Matches more easily — fewer "unknown", more mix-ups' },
  { label: 'Balanced', value: 0.7, hint: 'Recommended' },
  { label: 'Strict', value: 0.8, hint: 'Only confident matches — more "unknown"' },
];

export function ManageVoicesScreen(): React.ReactElement {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const profiles = useSpeakerProfilesStore(s => s.profiles);
  const rename = useSpeakerProfilesStore(s => s.rename);
  const remove = useSpeakerProfilesStore(s => s.remove);
  const threshold = useSpeakerModelStore(s => s.matchThreshold);
  const setThreshold = useSpeakerModelStore(s => s.setMatchThreshold);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const list = Object.values(profiles);

  const confirmDelete = (id: string, name: string) =>
    Alert.alert('Forget this voice?', `“${name}” and its voiceprint will be deleted from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove(id) },
    ]);

  const commitRename = (id: string) => {
    const name = draft.trim();
    if (name) rename(id, name);
    setEditingId(null);
    setDraft('');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Voices" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>ENROLLED VOICES</Text>
        {list.length === 0 ? (
          <Text style={styles.empty}>No voices yet. Add one so the recorder can tell who's speaking.</Text>
        ) : (
          list.map(p => {
            const model = speakerEmbeddingModelById(p.modelId);
            const editing = editingId === p.id;
            return (
              <View key={p.id} style={styles.row}>
                <Icon name="user" size={16} color={colors.primary} />
                <View style={styles.rowText}>
                  {editing ? (
                    <TextInput
                      style={styles.rename}
                      value={draft}
                      onChangeText={setDraft}
                      autoFocus
                      onBlur={() => commitRename(p.id)}
                      onSubmitEditing={() => commitRename(p.id)}
                      returnKeyType="done"
                      placeholderTextColor={colors.textMuted}
                    />
                  ) : (
                    <Text style={styles.name}>{p.name}</Text>
                  )}
                  <Text style={styles.meta}>
                    {p.sampleCount} sample{p.sampleCount === 1 ? '' : 's'} · {model?.name ?? p.modelId}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setEditingId(p.id);
                    setDraft(p.name);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="edit-2" size={15} color={colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => confirmDelete(p.id, p.name)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="trash-2" size={15} color={colors.error} />
                </TouchableOpacity>
              </View>
            );
          })
        )}

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => (navigation as any).navigate('SpeakerEnrollment')}
          activeOpacity={0.8}
        >
          <Icon name="plus" size={16} color={colors.background} />
          <Text style={styles.addText}>Add a voice</Text>
        </TouchableOpacity>

        <Text style={[styles.label, styles.spacer]}>MATCH SENSITIVITY</Text>
        <View style={styles.seg}>
          {SENSITIVITY.map(opt => {
            const on = Math.abs(threshold - opt.value) < 0.001;
            return (
              <TouchableOpacity
                key={opt.label}
                style={[styles.segBtn, on && styles.segBtnOn]}
                onPress={() => setThreshold(opt.value)}
              >
                <Text style={[styles.segText, on && styles.segTextOn]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.hint}>{SENSITIVITY.find(o => Math.abs(threshold - o.value) < 0.001)?.hint ?? ''}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  const RADIUS = SPACING.sm;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: SPACING.lg, gap: SPACING.sm, paddingBottom: SPACING.xxl },
    label: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1.4, textTransform: 'uppercase' },
    spacer: { marginTop: SPACING.xl },
    empty: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, lineHeight: 19 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADIUS,
      backgroundColor: colors.surface,
    },
    rowText: { flex: 1 },
    name: { ...TYPOGRAPHY.body, color: colors.text },
    rename: {
      ...TYPOGRAPHY.body,
      color: colors.text,
      borderBottomWidth: 1,
      borderBottomColor: colors.primary,
      padding: 0,
    },
    meta: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: 2 },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.sm,
      marginTop: SPACING.md,
      paddingVertical: SPACING.md,
      borderRadius: RADIUS,
      backgroundColor: colors.primary,
    },
    addText: { ...TYPOGRAPHY.bodySmall, color: colors.background },
    seg: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, overflow: 'hidden' },
    segBtn: { flex: 1, alignItems: 'center', paddingVertical: SPACING.sm },
    segBtnOn: { backgroundColor: colors.surfaceHover },
    segText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
    segTextOn: { color: colors.primary },
    hint: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: SPACING.sm },
  });
}
