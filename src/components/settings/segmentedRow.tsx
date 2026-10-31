/**
 * The segmented control every advanced text-generation setting renders as: title, description, and a
 * row of pill buttons. Its own module so each control can import it without importing every other
 * control — the file that used to hold both grew past the size budget, and a re-export from there
 * would have made the dependency circular.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { TouchableOpacity } from '../Touchable';
import { useThemedStyles } from '../../theme';
import { createTextGenAdvancedStyles } from './textGenAdvancedStyles';

export interface PillOption<T extends string> {
  id: T;
  label: string;
}

/** A labelled segmented control: title + description + a row of pill buttons.
 *  The one place the pill markup lives, so every setting renders identically. */
export function SegmentedRow<T extends string>(props: {
  label: string;
  description: string;
  options: PillOption<T>[];
  current: T;
  onSelect: (id: T) => void;
  testIdFor?: (id: T) => string;
  isDisabled?: (id: T) => boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const { label, description, options, current, onSelect, testIdFor, isDisabled, children } = props;
  return (
    <View style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.desc}>{description}</Text>
      </View>
      <View style={styles.buttons}>
        {options.map(o => {
          const active = current === o.id;
          return (
            <TouchableOpacity
              key={o.id}
              testID={testIdFor?.(o.id)}
              style={[styles.button, active && styles.buttonActive]}
              disabled={isDisabled?.(o.id)}
              onPress={() => onSelect(o.id)}
            >
              <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {children}
    </View>
  );
}

export const BOOL_OPTIONS: PillOption<'off' | 'on'>[] = [
  { id: 'off', label: 'Off' },
  { id: 'on', label: 'On' },
];
