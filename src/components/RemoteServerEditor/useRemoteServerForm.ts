import { useState, useCallback, useEffect } from 'react';
import { remoteServerManager } from '../../services/remoteServerManager';
import { useRemoteServerStore } from '../../stores';
import {
  RemoteServer,
  RemoteModel,
  RemoteMediaModelIds,
  RemoteModelCatalog,
  ServerTestResult,
} from '../../types';
import { isPrivateNetworkEndpoint } from '../../services/httpClient';
import { AlertState, initialAlertState, showAlert } from '../CustomAlert';

interface FormOptions {
  server?: RemoteServer;
  visible: boolean;
  onSave?: (server: RemoteServer) => void;
  onClose: () => void;
}

interface ModelIdSetters {
  text: React.Dispatch<React.SetStateAction<string>>;
  image: React.Dispatch<React.SetStateAction<string>>;
  transcription: React.Dispatch<React.SetStateAction<string>>;
  voice: React.Dispatch<React.SetStateAction<string>>;
}

function applyDiscoveredModelIds(
  result: ServerTestResult,
  setters: ModelIdSetters,
): void {
  if (result.modelManagement === 'offgrid-desktop-v1') {
    setters.text(result.mediaModels?.text ?? '');
    setters.image(result.mediaModels?.image ?? '');
    setters.transcription(result.mediaModels?.transcription ?? '');
    setters.voice(result.mediaModels?.voice ?? '');
    return;
  }
  setters.text(
    current => current || result.mediaModels?.text || result.models?.[0]?.id || '',
  );
  setters.image(current => current || result.mediaModels?.image || '');
  setters.transcription(
    current => current || result.mediaModels?.transcription || '',
  );
  setters.voice(current => current || result.mediaModels?.voice || '');
}

// eslint-disable-next-line max-lines-per-function
export function useRemoteServerForm({
  server,
  visible,
  onSave,
  onClose,
}: FormOptions) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [notes, setNotes] = useState('');
  const [textModelId, setTextModelId] = useState('');
  const [textContextWindowTokens, setTextContextWindowTokens] = useState('');
  const [imageModelId, setImageModelId] = useState('');
  const [transcriptionModelId, setTranscriptionModelId] = useState('');
  const [voiceModelId, setVoiceModelId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<RemoteModel[]>([]);
  const [modelCatalog, setModelCatalog] = useState<RemoteModelCatalog>({});
  const [modelManagement, setModelManagement] = useState<
    RemoteServer['modelManagement']
  >(server?.modelManagement);
  const [confirmedMediaModels, setConfirmedMediaModels] =
    useState<RemoteMediaModelIds>(server?.mediaModels ?? {});
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  // Initialize form when editing existing server
  useEffect(() => {
    let cancelled = false;
    if (server) {
      setName(server.name);
      setEndpoint(server.endpoint);
      setNotes(server.notes || '');
      setTextModelId(server.mediaModels?.text || '');
      setTextContextWindowTokens(server.textContextWindowTokens ? String(server.textContextWindowTokens) : '');
      setImageModelId(server.mediaModels?.image || '');
      setTranscriptionModelId(server.mediaModels?.transcription || '');
      setVoiceModelId(server.mediaModels?.voice || '');
      // Load existing API key from keychain so user can see it's set
      remoteServerManager
        .getApiKey(server.id)
        .then(key => {
        if (!cancelled) setApiKey(key || '');
        })
        .catch(() => {
          if (!cancelled) setApiKey('');
        });
    } else {
      // Reset form for new server
      setName('');
      setEndpoint('');
      setApiKey('');
      setNotes('');
      setTextModelId('');
      setTextContextWindowTokens('');
      setImageModelId('');
      setTranscriptionModelId('');
      setVoiceModelId('');
    }
    setErrors({});
    setTestResult(null);
    setDiscoveredModels([]);
    setModelCatalog(server?.modelCatalog ?? {});
    setModelManagement(server?.modelManagement);
    setConfirmedMediaModels(server?.mediaModels ?? {});
    return () => {
      cancelled = true;
    };
  }, [server, visible]);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = 'Server name is required';
    }
    if (endpoint.trim()) {
      try {
        // Validate URL format by parsing it - constructor throws on invalid URLs
        new URL(endpoint); // eslint-disable-line no-new
      } catch {
        newErrors.endpoint = 'Invalid URL format';
      }
    } else {
      newErrors.endpoint = 'Endpoint URL is required';
    }
    if (textContextWindowTokens && (!Number.isSafeInteger(Number(textContextWindowTokens)) || Number(textContextWindowTokens) < 1024)) {
      newErrors.textContextWindowTokens = 'Enter at least 1024 tokens';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, endpoint, textContextWindowTokens]);

  const applySuccessfulConnection = useCallback((result: ServerTestResult) => {
    const modelCount =
      (result.models?.length ?? 0) +
      Object.values(result.modelCatalog ?? {}).reduce(
        (count, models) => count + (models?.length ?? 0),
        0,
      );
    setTestResult({
      success: true,
      message: `Connected (${result.latency}ms)${
        modelCount > 0
          ? `\n${modelCount} model${modelCount === 1 ? '' : 's'} available`
          : ''
      }`,
    });
    setDiscoveredModels(result.models ?? []);
    setModelCatalog(result.modelCatalog ?? {});
    setModelManagement(result.modelManagement);
    setConfirmedMediaModels(result.mediaModels ?? {});
    applyDiscoveredModelIds(result, {
      text: setTextModelId,
      image: setImageModelId,
      transcription: setTranscriptionModelId,
      voice: setVoiceModelId,
    });
  }, []);

  // A saved Desktop server can predate the managed-model contract. Refresh it
  // when the editor opens so the user sees canonical installed choices without
  // having to delete, recreate, or manually retest the server first.
  useEffect(() => {
    if (!server || !visible) return;
    let cancelled = false;
    setIsTesting(true);
    (async () => {
      try {
        const storedApiKey = await remoteServerManager.getApiKey(server.id);
        const result = await remoteServerManager.testConnectionByEndpoint(
          server.endpoint,
          storedApiKey || undefined,
        );
        if (!cancelled && result.success) applySuccessfulConnection(result);
      } finally {
        if (!cancelled) setIsTesting(false);
      }
    })().catch(() => {
      if (!cancelled) setIsTesting(false);
    });
    return () => { cancelled = true; };
  }, [applySuccessfulConnection, server, visible]);

  const handleTestConnection = useCallback(async () => {
    if (!validateForm()) return;
    setIsTesting(true);
    setTestResult(null);
    setDiscoveredModels([]);
    setModelCatalog({});
    setModelManagement(undefined);
    setConfirmedMediaModels({});
    try {
      const result = await remoteServerManager.testConnectionByEndpoint(
        endpoint,
        apiKey || undefined,
      );
      if (result.success) {
        applySuccessfulConnection(result);
      } else {
        const triedUrl = `${endpoint.replace(/\/+$/, '')}/v1/models`;
        setTestResult({
          success: false,
          message: `${result.error || 'Connection failed'}\nTried: ${triedUrl}`,
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsTesting(false);
    }
  }, [endpoint, apiKey, applySuccessfulConnection, validateForm]);

  // eslint-disable-next-line complexity
  const saveServer = useCallback(async () => {
    try {
      const mediaModels = {
        ...(textModelId.trim() ? { text: textModelId.trim() } : {}),
        ...(imageModelId.trim() ? { image: imageModelId.trim() } : {}),
        ...(transcriptionModelId.trim()
          ? { transcription: transcriptionModelId.trim() }
          : {}),
        ...(voiceModelId.trim() ? { voice: voiceModelId.trim() } : {}),
      };
      const desktopManaged = modelManagement === 'offgrid-desktop-v1';
      const activateDesktopSelections = async (
        serverId: string,
        current: RemoteMediaModelIds,
      ) => {
        if (!desktopManaged) return;
        if (mediaModels.text && mediaModels.text !== current.text) {
          await remoteServerManager.setActiveRemoteTextModel(
            serverId,
            mediaModels.text,
          );
        }
        for (const category of [
          'image',
          'transcription',
          'voice',
        ] as const) {
          const modelId = mediaModels[category];
          if (modelId && modelId !== current[category]) {
            await remoteServerManager.setActiveRemoteMediaModel(
              serverId,
              category,
              modelId,
            );
          }
        }
      };
      if (server) {
        await remoteServerManager.updateServer(server.id, {
          name,
          endpoint,
          notes,
          apiKey,
          mediaModels: desktopManaged ? server.mediaModels : mediaModels,
          textContextWindowTokens: textContextWindowTokens ? Number(textContextWindowTokens) : undefined,
          modelCatalog,
          modelManagement,
        });
        if (discoveredModels.length > 0) {
          useRemoteServerStore
            .getState()
            .setDiscoveredModels(
              server.id,
              discoveredModels.map(model => ({ ...model, serverId: server.id })),
            );
        }
        await activateDesktopSelections(server.id, server.mediaModels ?? {});
        if (
          !desktopManaged &&
          textModelId.trim() &&
          useRemoteServerStore.getState().activeServerId === server.id
        ) {
          await remoteServerManager.setActiveRemoteTextModel(
            server.id,
            textModelId.trim(),
          );
        }
        onSave?.(server);
      } else {
        const newServer = await remoteServerManager.addServer({
          name,
          endpoint,
          providerType: 'openai-compatible',
          notes: notes || undefined,
          apiKey: apiKey || undefined,
          mediaModels: desktopManaged ? confirmedMediaModels : mediaModels,
          textContextWindowTokens: textContextWindowTokens ? Number(textContextWindowTokens) : undefined,
          modelCatalog,
          modelManagement,
        });
        if (discoveredModels.length > 0) {
          useRemoteServerStore
            .getState()
            .setDiscoveredModels(
              newServer.id,
              discoveredModels.map(model => ({
                ...model,
                serverId: newServer.id,
              })),
            );
        }
        await activateDesktopSelections(
          newServer.id,
          desktopManaged ? confirmedMediaModels : {},
        );
        // Probe before closing so no network work outlives this editor session.
        await remoteServerManager
          .testConnection(newServer.id)
          .catch(() => undefined);
        onSave?.(newServer);
      }
      onClose();
    } catch (error) {
      setAlertState(
        showAlert(
          'Error',
          error instanceof Error ? error.message : 'Failed to save server',
        ),
      );
    }
  }, [
    server,
    name,
    endpoint,
    apiKey,
    notes,
    textModelId,
    textContextWindowTokens,
    imageModelId,
    transcriptionModelId,
    voiceModelId,
    modelCatalog,
    modelManagement,
    confirmedMediaModels,
    discoveredModels,
    onSave,
    onClose,
  ]);

  const handleSave = useCallback(async () => {
    if (!validateForm()) return;
    // Warn if connecting to public internet
    if (endpoint && !isPrivateNetworkEndpoint(endpoint)) {
      setAlertState(
        showAlert(
        'Public Network Warning',
        'This endpoint appears to be on the public internet. Your data will be sent to a remote server. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: () => saveServer() },
          ],
        ),
      );
    } else {
      saveServer();
    }
  }, [validateForm, endpoint, saveServer]);

  return {
    name,
    setName,
    endpoint,
    setEndpoint,
    apiKey,
    setApiKey,
    notes,
    setNotes,
    textModelId,
    setTextModelId,
    textContextWindowTokens,
    setTextContextWindowTokens,
    imageModelId,
    setImageModelId,
    transcriptionModelId,
    setTranscriptionModelId,
    voiceModelId,
    setVoiceModelId,
    errors,
    isTesting,
    testResult,
    discoveredModels,
    modelCatalog,
    modelManagement,
    handleTestConnection,
    handleSave,
    isPublicNetwork: !!(endpoint && !isPrivateNetworkEndpoint(endpoint)),
    alertState,
    dismissAlert: () => setAlertState(initialAlertState),
  };
}
