import React from 'react';
import {
  View,
  Text,
  ViewStyle,
} from 'react-native';
import { TouchableOpacity } from './Touchable';
import { useThemedStyles } from '../theme/useThemedStyles';
import type { ThemeColors, ThemeShadows } from '../theme';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  onPress?: () => void;
  style?: ViewStyle;
  headerRight?: React.ReactNode;
  testID?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  subtitle,
  onPress,
  style,
  headerRight,
  testID,
}) => {
  const styles = useThemedStyles(createStyles);
  const Container = onPress ? TouchableOpacity : View;

  return (
    <Container
      style={[styles.card, style]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      testID={testID}
    >
      {(title || subtitle || headerRight) && (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {title && <Text style={styles.title}>{title}</Text>}
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
          {headerRight}
        </View>
      )}
      {children}
    </Container>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    ...shadows.small,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
});
