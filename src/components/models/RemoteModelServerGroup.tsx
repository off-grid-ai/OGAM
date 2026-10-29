import React from 'react';
import { Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { ModelCard } from '../ModelCard';
import { ModelSwitchStop } from './ModelSwitchStop';
import { useTheme, useThemedStyles } from '../../theme';
import { createAllStyles } from '../ModelSelectorModal/styles';

type CardModel = React.ComponentProps<typeof ModelCard>['model'];
type CardCapabilities = React.ComponentProps<typeof ModelCard>['capabilities'];

export interface RemoteModelRow {
  id: string;
  testID: string;
  model: CardModel;
  capabilities?: CardCapabilities;
  isCurrent: boolean;
  isLoading: boolean;
  onPress: () => void;
}

interface Props {
  serverName: string;
  rows: RemoteModelRow[];
  /** Every row is off while any model is switching. */
  disabled: boolean;
  loadingTestID?: string;
}

/**
 * One server's models in a model picker: the server's name, then a compact card per model. Every
 * picker (text, image, video, voice, transcription) draws its remote models with this, so they
 * read and space the same.
 */
export const RemoteModelServerGroup: React.FC<Props> = ({ serverName, rows, disabled, loadingTestID }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createAllStyles);
  return (
    <View>
      <View style={styles.sectionHeaderRow}>
        <Icon name="wifi" size={14} color={colors.textMuted} />
        <Text style={styles.sectionSubTitle}>{serverName}</Text>
      </View>
      {rows.map(row => (
        <ModelCard
          key={row.id}
          compact
          testID={row.testID}
          model={row.model}
          sourceBadge="Remote"
          capabilities={row.capabilities}
          // Selected only once the switch has landed; while it runs, the stop spinner says so.
          isActive={row.isCurrent}
          onPress={row.onPress}
          disabled={disabled || row.isCurrent}
          trailing={row.isLoading ? <ModelSwitchStop testID={loadingTestID} />
            : row.isCurrent ? <View style={styles.checkmarkRemote}><Icon name="check" size={16} color={colors.background} /></View>
            : null}
        />
      ))}
    </View>
  );
};
