import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { TouchableOpacity } from '../Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { ModelCard } from '../ModelCard';
import { GROUPED_CARD_ROW, ListGroup } from '../ListGroup';
import { ModelSwitchStop } from './ModelSwitchStop';
import { useTheme, useThemedStyles } from '../../theme';
import { createAllStyles } from '../ModelSelectorModal/styles';

type CardModel = React.ComponentProps<typeof ModelCard>['model'];
type CardCapabilities = React.ComponentProps<typeof ModelCard>['capabilities'];

interface RemoteModelRow {
  id: string;
  testID: string;
  model: CardModel;
  capabilities?: CardCapabilities;
  facts?: string[];
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
/** Rows a server shows before "Show all": a server like OpenRouter lists hundreds, and mounting every
 *  card held the text picker for ~2.5 s on each open (hand tests 88-90). */
const PREVIEW_ROWS = 5;

export const RemoteModelServerGroup: React.FC<Props> = ({ serverName, rows, disabled, loadingTestID }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createAllStyles);
  const [showAll, setShowAll] = useState(false);
  const hidden = rows.length - PREVIEW_ROWS;
  // The current model always shows, even when it sits past the preview.
  const shown = showAll || hidden <= 0
    ? rows
    : rows.filter((row, index) => index < PREVIEW_ROWS || row.isCurrent || row.isLoading);
  return (
    <View>
      <View style={styles.sectionHeaderRow}>
        <Icon name="wifi" size={14} color={colors.textMuted} />
        <Text style={styles.sectionSubTitle}>{serverName}</Text>
      </View>
      <ListGroup>
      {shown.map(row => (
        <ModelCard
          key={row.id}
          compact
          style={GROUPED_CARD_ROW}
          testID={row.testID}
          model={row.model}
          sourceBadge="Remote"
          capabilities={row.capabilities}
          facts={row.facts}
          // Selected only once the switch has landed; while it runs, the stop spinner says so.
          isActive={row.isCurrent}
          onPress={row.onPress}
          disabled={disabled || row.isCurrent}
          trailing={row.isLoading ? <ModelSwitchStop testID={loadingTestID} />
            : row.isCurrent ? <View style={styles.checkmarkRemote}><Icon name="check" size={16} color={colors.background} /></View>
            : null}
        />
      ))}
      {!showAll && hidden > 0 ? (
        <TouchableOpacity
          style={styles.showAllRow}
          onPress={() => setShowAll(true)}
          accessibilityRole="button"
          testID="remote-models-show-all"
        >
          <Text style={styles.showAllText}>Show all {rows.length}</Text>
          <Icon name="chevron-down" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}
      </ListGroup>
    </View>
  );
};
