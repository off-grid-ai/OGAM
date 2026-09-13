import React, { useState } from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { CustomAlert } from '../components/CustomAlert';
import { useRemoteServerStore } from '../stores';
import { useTheme, useThemedStyles } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { useRemoteServerForm } from '../components/RemoteServerEditor/useRemoteServerForm';
import { RemoteModelField } from '../components/RemoteServerEditor/RemoteModelField';
import { createStyles } from '../components/RemoteServerEditor/styles';

// Private-LAN model servers use HTTP by design. Public addresses show an explicit warning.
const PRIVATE_LAN_ENDPOINT_EXAMPLE = 'http://192.168.1.50:7878'; // NOSONAR

type Navigation = NativeStackNavigationProp<
  RootStackParamList,
  'RemoteServerEditor'
>;
type EditorRoute = RouteProp<RootStackParamList, 'RemoteServerEditor'>;

export const RemoteServerEditorScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<EditorRoute>();
  const server = useRemoteServerStore(s =>
    s.servers.find(item => item.id === route.params?.serverId),
  );
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [showApiKey, setShowApiKey] = useState(false);
  const close = () => navigation.goBack();
  const form = useRemoteServerForm({ server, visible: true, onClose: close });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader
        title={server ? 'Edit server' : 'Add a server'}
        onBack={close}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.label}>Server name</Text>
        <TextInput
          testID="server-name"
          style={[styles.input, form.errors.name && styles.inputError]}
          value={form.name}
          onChangeText={form.setName}
          placeholder="Off Grid AI Desktop"
          placeholderTextColor={theme.colors.textMuted}
        />
        {form.errors.name ? (
          <Text style={styles.errorText}>{form.errors.name}</Text>
        ) : null}

        <Text style={styles.label}>Address</Text>
        <TextInput
          testID="server-endpoint"
          style={[styles.input, form.errors.endpoint && styles.inputError]}
          value={form.endpoint}
          onChangeText={form.setEndpoint}
          placeholder={PRIVATE_LAN_ENDPOINT_EXAMPLE}
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {form.errors.endpoint ? (
          <Text style={styles.errorText}>{form.errors.endpoint}</Text>
        ) : null}
        {form.isPublicNetwork ? (
          <View style={styles.warningContainer}>
            <Icon name="alert-triangle" size={13} color={theme.colors.error} />
            <Text style={styles.warningText}>
              This server is on the public internet. Your prompts, images, and
              audio leave this phone and go to whoever runs it.
            </Text>
          </View>
        ) : (
          <Text style={styles.helperText}>
            A server on your network keeps requests between your devices.
          </Text>
        )}

        <Text style={styles.label}>API key (optional)</Text>
        <View style={styles.apiKeyContainer}>
          <TextInput
            testID="server-api-key"
            style={[styles.input, styles.apiKeyInput]}
            value={form.apiKey}
            onChangeText={form.setApiKey}
            placeholder="sk-..."
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showApiKey}
          />
          <TouchableOpacity
            style={styles.apiKeyToggle}
            onPress={() => setShowApiKey(value => !value)}
            accessibilityRole="button"
            accessibilityLabel={showApiKey ? 'Hide API key' : 'Show API key'}
          >
            <Icon
              name={showApiKey ? 'eye-off' : 'eye'}
              size={18}
              color={theme.colors.textMuted}
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.helperText}>
          The key stays in Keychain on this phone.
        </Text>

        <Text style={styles.sectionHeader}>Remote media</Text>
        <Text style={styles.helperText}>
          Add only the models this server provides. Empty fields keep that work
          on this phone.
        </Text>
        <RemoteModelField
          label="Text model"
          value={form.textModelId}
          options={form.discoveredModels}
          onChange={form.setTextModelId}
          placeholder="llama3.2"
          testID="server-text-model"
          loading={form.isTesting}
          allowManualEntry={form.modelManagement !== 'offgrid-desktop-v1'}
        />
        <RemoteModelField
          label="Image model"
          value={form.imageModelId}
          options={form.modelCatalog.image ?? []}
          onChange={form.setImageModelId}
          placeholder="gpt-image-1"
          testID="server-image-model"
          loading={form.isTesting}
          allowManualEntry={form.modelManagement !== 'offgrid-desktop-v1'}
        />
        <RemoteModelField
          label="Transcription model"
          value={form.transcriptionModelId}
          options={form.modelCatalog.transcription ?? []}
          onChange={form.setTranscriptionModelId}
          placeholder="whisper-1"
          testID="server-transcription-model"
          loading={form.isTesting}
          allowManualEntry={form.modelManagement !== 'offgrid-desktop-v1'}
        />
        <RemoteModelField
          label="Voice model"
          value={form.voiceModelId}
          options={form.modelCatalog.voice ?? []}
          onChange={form.setVoiceModelId}
          placeholder="gpt-4o-mini-tts"
          testID="server-voice-model"
          loading={form.isTesting}
          allowManualEntry={form.modelManagement !== 'offgrid-desktop-v1'}
        />

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={form.notes}
          onChangeText={form.setNotes}
          placeholder="What this server is for"
          placeholderTextColor={theme.colors.textMuted}
          multiline
        />

        {form.testResult ? (
          <View style={styles.statusContainer}>
            <View
              style={[
                styles.statusDot,
                form.testResult.success
                  ? styles.statusDotSuccess
                  : styles.statusDotError,
              ]}
            />
            <Text style={styles.statusText}>{form.testResult.message}</Text>
          </View>
        ) : null}

        <View style={styles.buttonRow}>
          <Button
            title={form.isTesting ? 'Testing' : 'Test connection'}
            variant="secondary"
            onPress={form.handleTestConnection}
            disabled={form.isTesting}
            style={styles.buttonHalf}
            testID="test-connection"
          />
          <Button
            title={server ? 'Update server' : 'Add server'}
            onPress={form.handleSave}
            disabled={!form.testResult?.success}
            style={styles.buttonHalf}
            testID="save-server"
          />
        </View>
      </ScrollView>
      <CustomAlert {...form.alertState} onClose={form.dismissAlert} />
    </SafeAreaView>
  );
};
