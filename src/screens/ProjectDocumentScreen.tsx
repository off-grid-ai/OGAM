import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { Button } from '../components/Button';
import { ragService } from '../services/rag';
import type { RootStackParamList } from '../navigation/types';
import { createStyles } from './ProjectDocumentScreen.styles';

type RouteProps = RouteProp<RootStackParamList, 'ProjectDocument'>;

/**
 * Read and edit one of a project's shared documents (for example "Current Progress"), or
 * write a new one. Every chat in the project reads these, and agents can update them too.
 */
export const ProjectDocumentScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { projectId, docId, name: initialName } = useRoute<RouteProps>().params;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [name, setName] = useState((initialName ?? '').replace(/\.md$/i, ''));
  const [text, setText] = useState('');
  const [original, setOriginal] = useState({ name: (initialName ?? '').replace(/\.md$/i, ''), text: '' });
  const [loading, setLoading] = useState(docId !== undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (docId === undefined) return;
    ragService.readDocumentText(projectId, docId)
      .then((t) => { setText(t); setOriginal((o) => ({ ...o, text: t })); })
      .catch((e) => Alert.alert('Could not open this document', String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [projectId, docId]);

  const dirty = name !== original.name || text !== original.text;
  const save = async () => {
    setSaving(true);
    try {
      await ragService.saveProjectNote({ projectId, name, text, mode: 'replace', replacesDocId: docId });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not save', String(e?.message || e));
    } finally { setSaving(false); }
  };
  const back = () => {
    if (!dirty) { navigation.goBack(); return; }
    Alert.alert('Discard changes?', 'Your changes to this document are not saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={back} style={styles.backButton} accessibilityLabel="Back">
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{docId === undefined ? 'New shared document' : 'Shared document'}</Text>
        <Button title="Save" size="small" onPress={save} loading={saving} disabled={!dirty || !name.trim() || !text.trim() || saving} testID="project-doc-save" />
      </View>
      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Text style={styles.label}>Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="e.g. Current Progress" placeholderTextColor={colors.textMuted} style={styles.nameInput} testID="project-doc-name" />
          <Text style={styles.label}>Text</Text>
          <TextInput value={text} onChangeText={setText} multiline placeholder="Write what every chat in this project should know." placeholderTextColor={colors.textMuted} style={styles.bodyInput} testID="project-doc-text" />
          <Text style={styles.meta}>Every chat in this project reads this document. Protected projects keep it encrypted.</Text>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
};
