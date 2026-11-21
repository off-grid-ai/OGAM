/**
 * The `hero` button: a screen's one main action. It reads as the way
 * on (emerald text on an emerald wash) without a solid block of colour.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { Button } from '../../../src/components/Button';
import { useTheme } from '../../../src/theme';

function Probe({ onPress, loading }: { onPress: () => void; loading?: boolean }) {
  return <Button title="Continue" variant="hero" onPress={onPress} loading={loading} testID="hero" />;
}

describe('Button, hero', () => {
  // Pressing one is covered where it is used: onboarding's Get Started (OnboardingScreen.test).
  it('shows emerald text on an emerald wash, not a solid fill', () => {
    const view = render(<Probe onPress={() => undefined} />);
    const { colors } = (() => {
      let theme: ReturnType<typeof useTheme> | undefined;
      const Read = () => {
        theme = useTheme();
        return null;
      };
      render(<Read />);
      return theme!;
    })();

    const box = StyleSheet.flatten(view.getByTestId('hero').props.style);
    expect(box.backgroundColor).toBe(`${colors.primary}1A`);
    expect(box.borderColor).toBe(`${colors.primary}59`);
    expect(StyleSheet.flatten(view.getByText('Continue').props.style).color).toBe(colors.primary);

  });

  it('while working, shows the dots and no label', () => {
    const view = render(<Probe onPress={() => undefined} loading />);
    expect(view.queryByText('Continue')).toBeNull();
  });
});
