import React from 'react';
import { View, Text, ViewStyle, TextStyle } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { Button } from './Button';
import logger from '../utils/logger';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Fallback UI shown when a descendant throws during render. Kept as its own
 * function component so it can use the theme hooks (a class boundary can't).
 * Uses only design tokens + the shared Button — nothing here may itself throw.
 */
function ErrorFallback({ onReset }: { onReset: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.container} testID="error-boundary-fallback">
      <Icon name="alert-triangle" size={40} color={colors.textSecondary} />
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>
        The app hit an unexpected error. Your chats and models are saved on your device.
      </Text>
      <Button title="Try Again" onPress={onReset} variant="primary" testID="error-boundary-retry" />
    </View>
  );
}

/**
 * Top-level error boundary. Converts an otherwise-fatal JS render error (a bad
 * message, a Markdown parse failure, a corrupt attachment) into a recoverable
 * screen instead of a white screen that forces a reinstall. Purely additive: it
 * only renders the fallback when a child has already thrown, so it can never
 * change the behavior of a working path.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error('[ErrorBoundary] Caught render error:', error?.message, info?.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReset={this.reset} />;
    }
    return this.props.children;
  }
}

const createStyles = (colors: ThemeColors): { container: ViewStyle; title: TextStyle; body: TextStyle } =>
  ({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: SPACING.xl,
      backgroundColor: colors.background,
    },
    title: {
      ...TYPOGRAPHY.h2,
      color: colors.text,
      marginTop: SPACING.lg,
      marginBottom: SPACING.sm,
      textAlign: 'center',
    },
    body: {
      ...TYPOGRAPHY.body,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: SPACING.xl,
    },
  });
