import React, { useState } from 'react';
import { StyleSheet, ActivityIndicator, Alert, BackHandler, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { useTheme } from '../theme';
import { useWideLayout } from '../hooks/useWideLayout';
import { AddonsSection } from '../components/AddonsSection';
import { AtlasPacksSection } from '../components/AtlasPacksSection';
import {
  useOfflineLibrary, addLibraryFile, removeLibraryFile, searchLibrary, readArticle, libraryAvailable, LibraryHit,
} from '../atlasTools/offlineLibrary';
const COLOR_FFF = '#fff';
const literalStyles = StyleSheet.create({
  s1: { flex: 1 },
  s2: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  s3: { marginRight: 12 },
  s4: { fontSize: 18, fontWeight: '600', flex: 1 },
  s5: { padding: 18, paddingBottom: 100 },
  s6: { fontSize: 16, lineHeight: 24 },
  s7: { padding: 16, paddingBottom: 120 },
  s8: { marginBottom: 12 },
  s9: { fontSize: 15, fontWeight: '600' },
  s10: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  s11: { marginTop: 12 },
  s12: { borderRadius: 8, padding: 12, alignItems: 'center' },
  s13: { color: COLOR_FFF, fontWeight: '600' },
  s14: { fontSize: 13, marginBottom: 6 },
  s15: { flexDirection: 'row', alignItems: 'center' },
  s16: { flex: 1, marginHorizontal: 12 },
  s17: { fontSize: 12 },
  s18: { marginLeft: 8, padding: 4 },
  s19: { fontSize: 15, fontWeight: '600', marginBottom: 8 },
  s20: { flexDirection: 'row' },
  s21: { borderRadius: 8, padding: 10 },
  s22: { marginLeft: 8 },
  s23: { borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center' },
  s24: { marginTop: 10 },
  s25: { paddingVertical: 10, borderBottomWidth: 1 },
  s26: { fontSize: 15 },
  s27: { fontSize: 13 },
});


const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

/** Settings > Offline library: add Kiwix .zim files, search them, read articles. */
export const OfflineLibraryScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const wide = useWideLayout();
  const files = useOfflineLibrary((s) => s.files);
  const toggle = useOfflineLibrary((s) => s.toggle);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LibraryHit[] | null>(null);
  const [article, setArticle] = useState<{ title: string; text: string } | null>(null);

  const add = async () => {
    try {
      const res = await pick({ mode: 'open', requestLongTermAccess: true, type: [types.allFiles], allowMultiSelection: true });
      setBusy(true);
      for (const f of res) {
        if (!/\.zim$/i.test(f.name || '')) { Alert.alert('Not a .zim file', `${f.name} is not a Kiwix .zim file.`); continue; }
        try { await addLibraryFile(f.uri); } catch (e: any) { Alert.alert('Could not open', `${f.name}: ${e?.message || e}`); }
      }
    } catch (e: any) {
      if (!(isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED)) Alert.alert('Error', String(e?.message || e));
    } finally { setBusy(false); }
  };

  const doSearch = async () => {
    if (!q.trim()) return;
    setBusy(true); setArticle(null);
    try { setHits(await searchLibrary(q.trim(), 10)); } catch (e: any) { Alert.alert('Search failed', String(e?.message || e)); } finally { setBusy(false); }
  };

  // System Back closes an open article first, like the header arrow, instead of leaving the screen.
  useFocusEffect(React.useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (article) { setArticle(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [article]));

  const card = { backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 12 };
  return (
    <SafeAreaView style={[literalStyles.s1, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[literalStyles.s2, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => (article ? setArticle(null) : navigation.goBack())} style={literalStyles.s3}><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
        <Text style={[{ color: colors.text }, literalStyles.s4]} numberOfLines={1}>{article ? article.title : 'Offline library'}</Text>
        {busy && <ActivityIndicator color={colors.primary} />}
      </View>
      {article ? (
        <ScrollView contentContainerStyle={[literalStyles.s5, wide.column]}>
          <Text style={[{ color: colors.text }, literalStyles.s6]}>{article.text}</Text>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[literalStyles.s7, wide.column]} keyboardShouldPersistTaps="handled">
          {!libraryAvailable() && <Text style={[{ color: colors.error }, literalStyles.s8]}>The offline library module is missing from this build.</Text>}
          <View style={card}>
            <Text style={[{ color: colors.text }, literalStyles.s9]}>What this is</Text>
            <Text style={[{ color: colors.textSecondary }, literalStyles.s10]}>
              Download add-ons below, or add Kiwix .zim files you already have on this device (the PC build script saves them in the 10_Kiwix folder) - those stay where they are. Then turn on "Offline library" in an agent's tools (or the chat tools menu) and the AI can look things up with no internet.
            </Text>
            <TouchableOpacity onPress={add} disabled={busy} style={[literalStyles.s11, { backgroundColor: colors.primary }, literalStyles.s12]}>
              <Text style={literalStyles.s13}>Add .zim files from this device</Text>
            </TouchableOpacity>
          </View>

          <AtlasPacksSection />
          <AddonsSection />

          {files.length > 0 && <Text style={[{ color: colors.textSecondary }, literalStyles.s14]}>Your library</Text>}
          {files.map((f) => (
            <View key={f.uri} style={[card, literalStyles.s15]}>
              <Icon name="book" size={20} color={colors.primary} />
              <View style={literalStyles.s16}>
                <Text style={[{ color: colors.text }, literalStyles.s9]}>{f.title}</Text>
                <Text style={[{ color: colors.textSecondary }, literalStyles.s17]}>
                  {f.articles.toLocaleString()} articles · {gb(f.bytes)}{f.language ? ` · ${f.language}` : ''}{f.fulltext ? '' : ' · title search only'}
                </Text>
              </View>
              <Switch value={f.enabled} onValueChange={() => toggle(f.uri)} />
              <TouchableOpacity onPress={() => {
                const downloaded = f.uri.startsWith('/') && f.uri.includes('/zim/');
                if (!downloaded) { void removeLibraryFile(f.uri); return; }
                Alert.alert('Remove from the library?', f.title, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete the file', style: 'destructive', onPress: async () => { await removeLibraryFile(f.uri); await require('react-native-fs').default.unlink(f.uri).catch(() => undefined); } },
                ]);
              }} style={literalStyles.s18}><Icon name="x" size={18} color={colors.textMuted} /></TouchableOpacity>
            </View>
          ))}

          {files.length > 0 && (
            <View style={card}>
              <Text style={[{ color: colors.text }, literalStyles.s19]}>Search</Text>
              <View style={literalStyles.s20}>
                <TextInput
                  value={q} onChangeText={setQ} onSubmitEditing={doSearch} returnKeyType="search"
                  placeholder="e.g. tetanus, solar charge controller" placeholderTextColor={colors.textMuted}
                  style={[literalStyles.s1, { backgroundColor: colors.background, color: colors.text }, literalStyles.s21]}
                />
                <TouchableOpacity onPress={doSearch} style={[literalStyles.s22, { backgroundColor: colors.primary }, literalStyles.s23]}>
                  <Icon name="search" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
              {hits?.length === 0 && <Text style={[{ color: colors.textSecondary }, literalStyles.s24]}>No results.</Text>}
              {hits?.map((h, i) => (
                <TouchableOpacity key={`${h.uri}-${h.path}-${i}`} style={[literalStyles.s25, { borderBottomColor: colors.border }]}
                  onPress={async () => { setBusy(true); try { setArticle(await readArticle(h.uri, h.path, 60000)); } catch (e: any) { Alert.alert('Could not open', String(e?.message || e)); } finally { setBusy(false); } }}>
                  <Text style={[{ color: colors.text }, literalStyles.s26]}>{h.title}</Text>
                  <Text style={[{ color: colors.textMuted }, literalStyles.s17]}>{h.library}</Text>
                  {!!h.snippet && <Text style={[{ color: colors.textSecondary }, literalStyles.s27]} numberOfLines={2}>{h.snippet.replace(/<[^>]+>/g, '')}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};
