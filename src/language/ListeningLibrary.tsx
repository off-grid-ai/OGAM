import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { Card } from '../components/Card';
import { LEVELS } from './teaching';
import { libraryFor } from './library';
import { writtenPiece } from './libraryEs';
import { useLanguage } from './store';
import type { Listening } from './listening';
import { createStyles } from './ListeningScreen.styles';

/** The pre-made stories or podcasts, by genre. A tick marks pieces ready to open without the AI. */
export function ListeningLibrary({ kind, onOpen }: { kind: Listening['kind']; onOpen: (id: string) => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const code = useLanguage((s) => s.language);
  const kept = useLanguage((s) => s.listening[code]);
  const ready = (id: string) => !!writtenPiece(id, code) || !!kept?.some((l) => l.pieceId === id);
  return (
    <>
      {libraryFor(kind).map((g) => (
        <Card key={g.genre} title={g.title} testID={`library-${g.genre}`}>
          {g.pieces.map((x) => (
            <TouchableOpacity key={x.id} style={styles.word} onPress={() => onOpen(x.id)} testID={`piece-${x.id}`} accessibilityLabel={x.title}>
              <Icon name={g.icon} size={16} color={colors.primary} />
              <View style={styles.pieceText}>
                <Text style={styles.body}>{x.title}</Text>
                <Text style={styles.english}>{LEVELS.find((l) => l.id === x.level)?.name}</Text>
              </View>
              {ready(x.id) && <Icon name="check" size={16} color={colors.success} />}
            </TouchableOpacity>
          ))}
        </Card>
      ))}
    </>
  );
}
