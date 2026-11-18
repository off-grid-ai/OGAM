/**
 * One choice in onboarding's picks: a glass row that shows it is picked within one frame. Groups
 * and features share it, so both steps look and answer the same.
 */
import React from 'react';
import { Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Pressable } from '../../components/Touchable';
import { FONTS, SPACING, TYPOGRAPHY } from '../../constants';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { cardSurface } from '../../theme/surface';

export const GROUP_ICONS: Record<string, string> = {
  chat: 'message-circle',
  create: 'image',
  write: 'edit-3',
  remember: 'rewind',
  meetings: 'users',
  work: 'check-square',
  private: 'shield',
};

export const PART_ICONS: Record<string, string> = {
  chat: 'message-circle',
  'own-server': 'server',
  'ask-photo': 'camera',
  images: 'image',
  'video-studio': 'film',
  'animate-photo': 'film',
  'voice-mode': 'volume-2',
  dictation: 'mic',
  scribe: 'edit-3',
  notes: 'edit',
  'ask-documents': 'file-text',
  vault: 'lock',
  clipboard: 'clipboard',
  'web-search': 'globe',
  integrations: 'link',
  sync: 'refresh-cw',
  todos: 'check-square',
  assistant: 'cpu',
};

export const PickRow: React.FC<{
  icon: string;
  title: string;
  line: string;
  note?: string;
  pro?: boolean;
  on: boolean;
  onPress: () => void;
  testID: string;
}> = ({ icon, title, line, note, pro, on, onPress, testID }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={title}
      testID={testID}
      style={({ pressed }: { pressed: boolean }) => [
        styles.row,
        on && styles.rowOn,
        pressed && styles.rowPressed,
      ]}
    >
      <Icon name={icon} size={18} color={colors.text} />
      <View style={styles.text}>
        <View style={styles.titleLine}>
          <Text style={styles.title}>{title}</Text>
          {pro ? <Text style={styles.pro}>Pro</Text> : null}
        </View>
        <Text style={styles.line}>{line}</Text>
        {note ? <Text style={styles.line}>{note}</Text> : null}
      </View>
      <Icon
        name={on ? 'check-circle' : 'circle'}
        size={20}
        color={on ? colors.primary : colors.textMuted}
      />
    </Pressable>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  row: {
    ...cardSurface(colors),
    minHeight: 64,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  rowOn: { borderColor: colors.primary },
  rowPressed: { transform: [{ scale: 0.98 }] },
  text: { flex: 1, gap: 2 },
  titleLine: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  title: { ...TYPOGRAPHY.body, color: colors.text },
  pro: {
    ...TYPOGRAPHY.label,
    fontFamily: FONTS.mono,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.2,
    color: colors.textMuted,
  },
  line: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
});
