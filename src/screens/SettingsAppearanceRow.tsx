import React from 'react';
import { Text, View } from 'react-native';
import { TouchableOpacity } from '../components/Touchable';
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
          <View style={styles.navItem}>
            <View style={styles.navItemIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Icon name="sun" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Appearance</Text>
            </View>
            <View style={styles.themeSelector}>
              {[
                { mode: 'system' as const, icon: 'monitor', label: 'System' },
                { mode: 'light' as const, icon: 'sun', label: 'Light' },
                { mode: 'dark' as const, icon: 'moon', label: 'Dark' },
              ].map(({ mode, icon, label }) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.themeSelectorOption,
                    themeMode === mode && styles.themeSelectorOptionActive,
                  ]}
                  onPress={() => onSelect(mode)}
                  testID={`theme-option-${mode}`}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: themeMode === mode }}
                >
                  <Icon
                    name={icon}
                    size={16}
                    color={
                      themeMode === mode ? colors.text : colors.textMuted
                    }
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </AnimatedEntry>
);
