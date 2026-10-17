import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedEntry } from '../components/AnimatedEntry';
import type { ThemeColors } from '../theme';

/** The three appearance choices. Declared where they are rendered; the store owns the persisted one. */
type ThemeMode = 'system' | 'light' | 'dark';
import type { createStyles } from './SettingsScreen.styles';

interface SettingsAppearanceRowProps {
  focusTrigger: number;
  styles: ReturnType<typeof createStyles>;
  colors: ThemeColors;
  themeMode: ThemeMode;
  onSelect: (mode: ThemeMode) => void;
}

/** System, light or dark. Its own component so the Settings render stays inside the 350-line cap. */
export const SettingsAppearanceRow: React.FC<SettingsAppearanceRowProps> = ({
  focusTrigger,
  styles,
  colors,
  themeMode,
  onSelect
}) => (
        <AnimatedEntry index={0} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.themeToggleRow}>
            <Text style={styles.themeToggleLabel}>Appearance</Text>
            <View style={styles.themeSelector}>
              {[
                { mode: 'system' as const, icon: 'monitor' },
                { mode: 'light' as const, icon: 'sun' },
                { mode: 'dark' as const, icon: 'moon' },
              ].map(({ mode, icon }) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.themeSelectorOption,
                    themeMode === mode && styles.themeSelectorOptionActive,
                  ]}
                  onPress={() => onSelect(mode)}
                  testID={`theme-option-${mode}`}
                >
                  <Icon
                    name={icon}
                    size={16}
                    color={
                      themeMode === mode ? colors.background : colors.textMuted
                    }
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </AnimatedEntry>
);
