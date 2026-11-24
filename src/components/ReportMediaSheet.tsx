import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from './AppSheet';
import { AppSwitch } from './AppSwitch';
import { Button } from './Button';
import { TouchableOpacity } from './Touchable';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import {
  REPORT_REASONS,
  sendContentReport,
  type ReportKind,
  type ReportReason,
} from '../services/contentReport';

interface Props {
  visible: boolean;
  onClose: () => void;
  kind: ReportKind;
  prompt: string;
  mediaPath: string;
}

type Phase = 'idle' | 'sending' | 'sent' | 'failed';

/**
 * Report a generated image or video: pick a reason, choose whether to include the picture or clip,
 * send. The prompt and the reason go to the developer; the media only when switched on.
 */
export const ReportMediaSheet: React.FC<Props> = ({ visible, onClose, kind, prompt, mediaPath }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');

  // Every opening starts clean.
  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setIncludeMedia(false);
    setPhase('idle');
  }, [visible]);

  const send = () => {
    if (!reason) return;
    setPhase('sending');
    sendContentReport({ kind, reason, prompt, mediaPath, includeMedia }).then(
      () => setPhase('sent'),
      () => setPhase('failed'),
    );
  };

  const noun = kind === 'image' ? 'image' : 'video';
  return (
    <AppSheet sheet={`report-${kind}`} visible={visible} onClose={onClose} enableDynamicSizing title={`Report this ${noun}`}>
      {phase === 'sent' ? (
        <View style={styles.body} testID="report-sent">
          <View style={styles.doneRow}>
            <Icon name="check-circle" size={20} color={colors.primary} />
            <Text style={styles.doneText}>Thanks. We got your report and will look at it.</Text>
          </View>
          <Button title="Done" variant="secondary" onPress={onClose} />
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={styles.label}>WHAT'S WRONG</Text>
          {REPORT_REASONS.map(item => {
            const chosen = item.id === reason;
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.row}
                onPress={() => setReason(item.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={item.label}
                testID={`report-reason-${item.id}`}
              >
                <Text style={styles.rowText}>{item.label}</Text>
                <Icon name={chosen ? 'check-circle' : 'circle'} size={18} color={chosen ? colors.primary : colors.textMuted} />
              </TouchableOpacity>
            );
          })}
          <View style={[styles.row, styles.switchRow]}>
            <View style={styles.switchText}>
              <Text style={styles.rowText}>Include the {noun}</Text>
              <Text style={styles.hint}>Off: only the prompt and your reason are sent.</Text>
            </View>
            <AppSwitch
              value={includeMedia}
              onValueChange={setIncludeMedia}
              accessibilityLabel={`Include the ${noun}`}
              testID="report-include-media"
            />
          </View>
          {phase === 'failed' ? (
            <Text style={styles.error} testID="report-failed">
              Couldn't send. Check your connection and try again.
            </Text>
          ) : null}
          <Button
            title="Send report"
            onPress={send}
            disabled={!reason}
            loading={phase === 'sending'}
            testID="report-send"
          />
        </View>
      )}
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors) => ({
  body: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl, gap: SPACING.sm },
  label: { ...TYPOGRAPHY.label, color: colors.textMuted, marginBottom: SPACING.xs },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    minHeight: 44,
  },
  rowText: { ...TYPOGRAPHY.body, color: colors.text },
  switchRow: { marginTop: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: SPACING.sm },
  switchText: { flex: 1, marginRight: SPACING.md },
  hint: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
  error: { ...TYPOGRAPHY.bodySmall, color: colors.error },
  doneRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm, marginBottom: SPACING.md },
  doneText: { ...TYPOGRAPHY.body, color: colors.text, flex: 1 },
});
