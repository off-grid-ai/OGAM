import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { hostOf, type CheckedCitation } from '../study/citations';
const VERIFIED = '#16A34A';
const NONE = 'transparent';

const st = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }, chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 3, marginRight: 6, marginBottom: 4 },
  small: { fontSize: 12 }, detail: { marginTop: 4, marginBottom: 6 }, link: { textDecorationLine: 'underline' }, top4: { marginTop: 4 },
});

const label = (c: CheckedCitation, i: number) => `${i + 1} ${c.url ? hostOf(c.url) : `${c.title}${c.page ? ` p. ${c.page}` : ''}`}`.slice(0, 34);

/** Numbered source chips. Tap one to see where it is from and the quote, and whether the quote was found in the source. */
export const CitationChips: React.FC<{ cites: CheckedCitation[]; testID?: string }> = ({ cites, testID }) => {
  const { colors } = useTheme();
  const [open, setOpen] = useState<number | null>(null);
  if (!cites.length) return null;
  const c = open === null ? undefined : cites[open];
  return (
    <View testID={testID ?? 'citation-chips'}>
      <View style={st.row}>
        {cites.map((x, i) => (
          <TouchableOpacity key={i} testID={`chip-${i}`} accessibilityRole="button" onPress={() => setOpen(open === i ? null : i)} style={[st.chip, { borderColor: x.verified ? VERIFIED : colors.border, backgroundColor: open === i ? colors.surfaceLight : NONE }]}>
            <Text style={[st.small, { color: x.verified ? VERIFIED : colors.textSecondary }]}>{label(x, i)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {c && (
        <View testID="chip-detail" style={st.detail}>
          <Text style={{ color: colors.text }}>{c.title}{c.page ? `, p. ${c.page}` : ''}{c.section ? `, ${c.section}` : ''}</Text>
          {!!c.quote && <Text style={[st.top4, { color: colors.textSecondary }]}>"{c.quote}"</Text>}
          <Text testID="chip-status" style={[st.small, st.top4, { color: c.verified ? VERIFIED : colors.textMuted }]}>
            {c.verified ? 'Quote found in the source.' : 'Not checked against the source: this is the text the source gave.'}
          </Text>
          {!!c.file && (
            <Text accessibilityRole="link" testID="chip-open-document" onPress={() => { try { require('../utils/navigationRef').navigationRef.navigate('DocumentPreview', { filePath: c.file!.path, fileName: c.file!.name, fileSize: c.file!.size }); } catch { /* navigation not ready */ } }} style={[st.top4, st.link, { color: colors.primary }]}>Open the document</Text>
          )}
          {!!c.url && <Text accessibilityRole="link" onPress={() => { void Linking.openURL(c.url!); }} style={[st.top4, st.link, { color: colors.primary }]}>{c.url}</Text>}
        </View>
      )}
    </View>
  );
};
