/**
 * ResidentModelsSection — "In Memory": lists EVERY model currently resident in RAM (text, image, and
 * sidecars like whisper/tts/embedding), each with its RAM footprint and an individual Eject control. Lets
 * the user free any single model on demand (calling its real unload via modelResidencyManager.evictByKey);
 * the others stay resident, and an ejected model lazy-reloads on next use (ensureResident).
 *
 * modelResidencyManager has no subscription, so we poll getResidents() (the accounting is the source of
 * truth for what is actually in RAM) — the same approach as the test-only ResidentsProbe.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { modelResidencyManager } from '../../services/modelResidency';
import type { Resident } from '../../services/modelResidency/policy';
import logger from '../../utils/logger';

const TYPE_LABEL: Record<string, string> = {
  text: 'Text model',
  image: 'Image model',
  whisper: 'Voice input (Whisper)',
  tts: 'Voice output (TTS)',
  embedding: 'Search index',
  classifier: 'Router',
};

export const ResidentModelsSection: React.FC = () => {
  const { colors } = useTheme();
  const [residents, setResidents] = useState<Resident[]>(() => modelResidencyManager.getResidents());

  useEffect(() => {
    const tick = () => setResidents(modelResidencyManager.getResidents());
    tick();
    // No manager subscription — poll so load/eject elsewhere reflect here.
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, []);

  const eject = useCallback((r: Resident) => {
    logger.log(`[MODEL-SM] user eject requested → ${r.type} (${r.key}) ~${(r.sizeMB / 1024).toFixed(1)}GB`);
    modelResidencyManager
      .evictByKey(r.key)
      .then((ok) => {
        logger.log(`[MODEL-SM] user eject ${r.key} done ok=${ok}`);
        setResidents(modelResidencyManager.getResidents());
      })
      .catch((err) => logger.log(`[MODEL-SM] user eject ${r.key} failed:`, err));
  }, []);

  if (residents.length === 0) return null;

  const styles = createStyles(colors);
  return (
    <View testID="in-memory-section" style={styles.section}>
      <View style={styles.header}>
        <Icon name="cpu" size={14} color={colors.textSecondary} />
        <Text style={styles.headerLabel}>In Memory</Text>
      </View>
      {residents.map((r) => (
        <View key={r.key} testID={`resident-item-${r.type}`} style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>{TYPE_LABEL[r.type] ?? r.type}</Text>
            <Text testID={`resident-${r.type}-ram`} style={styles.meta}>{`~${(r.sizeMB / 1024).toFixed(1)} GB RAM`}</Text>
          </View>
          <TouchableOpacity testID={`eject-resident-${r.type}`} style={styles.ejectBtn} onPress={() => eject(r)}>
            <Icon name="power" size={15} color={colors.error} />
            <Text style={styles.ejectText}>Eject</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createStyles = (colors: any) => StyleSheet.create({
  section: { backgroundColor: colors.surface, borderRadius: 8, marginBottom: SPACING.md, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, padding: SPACING.md, paddingBottom: SPACING.sm },
  headerLabel: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border },
  info: { flex: 1 },
  name: { ...TYPOGRAPHY.body, fontWeight: '400', color: colors.text },
  meta: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: 2 },
  ejectBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  ejectText: { ...TYPOGRAPHY.bodySmall, color: colors.error },
});
