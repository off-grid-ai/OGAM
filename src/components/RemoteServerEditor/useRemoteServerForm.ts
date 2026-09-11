import { useCallback, useEffect, useMemo, useState } from 'react';
import { isPrivateNetworkEndpoint } from '../../services/httpClient';
import {
  RemoteServerEditorOperationError,
  type RemoteServerConnectionProjection,
  type RemoteServerEditorFailure,
  type RemoteServerEditorModelIds,
} from '../../services/modelServices/remoteServerEditorApplication';
import { remoteServerEditorApplication } from '../../services/composition/remote-server-editor';
import type {
  RemoteMediaModelIds,
  RemoteModel,
  RemoteModelCatalog,
  RemoteServer,
} from '../../types';
import { initialAlertState, showAlert, type AlertState } from '../CustomAlert';

export type { RemoteServerEditorFailure };

interface FormOptions {
  server?: RemoteServer;
  visible: boolean;
  onSave?: (server: RemoteServer) => void;
  onClose: () => void;
}

const idsForServer = (server?: RemoteServer): Required<RemoteServerEditorModelIds> => ({
  text: server?.selections?.text ?? '',
  image: server?.selections?.image ?? '',
  transcription: server?.selections?.transcription ?? '',
  voice: server?.selections?.voice ?? '',
});

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
  const [catalog, setCatalog] = useState<RemoteModelCatalog>({});
  const [modelManagement, setModelManagement] =
    useState<RemoteServer['modelManagement']>(server?.modelManagement);
  const [confirmedMediaModels, setConfirmedMediaModels] =
    useState<RemoteMediaModelIds>(server?.selections ?? {});
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [operationFailure, setOperationFailure] =
    useState<RemoteServerEditorFailure | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const currentModelIds = useCallback(
    (): RemoteServerEditorModelIds => ({
      text: textModelId,
      image: imageModelId,
      transcription: transcriptionModelId,
      voice: voiceModelId,
    }),
    [imageModelId, textModelId, transcriptionModelId, voiceModelId],
  );

  const modelNames = useMemo(
    () => remoteServerEditorApplication.projectModelNames(
      {
        text: textModelId,
        image: imageModelId,
        transcription: transcriptionModelId,
        voice: voiceModelId,
      },
      discoveredModels,
      catalog,
    ),
    [
      catalog,
      discoveredModels,
      imageModelId,
      textModelId,
      transcriptionModelId,
      voiceModelId,
    ],
  );

  const applyConnection = useCallback((projection: RemoteServerConnectionProjection) => {
    setTestResult(projection.result);
    setOperationFailure(projection.failure);
    setDiscoveredModels(projection.models);
    setCatalog(projection.catalog);
    setModelManagement(projection.modelManagement);
    setConfirmedMediaModels(projection.confirmedSelections);
    setTextModelId(projection.modelIds.text ?? '');
    setImageModelId(projection.modelIds.image ?? '');
    setTranscriptionModelId(projection.modelIds.transcription ?? '');
    setVoiceModelId(projection.modelIds.voice ?? '');
  }, []);

  useEffect(() => {
    setName(server?.name ?? '');
    setEndpoint(server?.endpoint ?? '');
    setApiKey('');
    setNotes(server?.notes ?? '');
    const ids = idsForServer(server);
    setTextModelId(ids.text);
    setImageModelId(ids.image);
    setTranscriptionModelId(ids.transcription);
    setVoiceModelId(ids.voice);
    setErrors({});
    setTestResult(null);
    setOperationFailure(null);
    setDiscoveredModels([]);
    setCatalog(server?.catalog ?? {});
    setModelManagement(server?.modelManagement);
    setConfirmedMediaModels(server?.selections ?? {});
    if (!server || !visible) return;

    let cancelled = false;
    setIsTesting(true);
    remoteServerEditorApplication
      .loadExisting(server, ids)
      .then(result => {
        if (cancelled) return;
        setApiKey(result.credential);
        applyConnection(result.connection);
      })
      .catch(error => {
        if (cancelled) return;
        const failure =
          error instanceof RemoteServerEditorOperationError
            ? error.failure
            : {
                kind: 'discovery' as const,
                message:
                  error instanceof Error
                    ? error.message
                    : 'Could not load models from this server.',
              };
        setOperationFailure(failure);
        if (failure.kind === 'credential-read') {
          setAlertState(showAlert('API key unavailable', failure.message, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: () => setLoadAttempt(value => value + 1) },
          ]));
        } else {
          setTestResult({ success: false, message: failure.message });
        }
      })
      .finally(() => {
        if (!cancelled) setIsTesting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyConnection, loadAttempt, server, visible]);

  const validateForm = useCallback((): boolean => {
    const next = remoteServerEditorApplication.validate({ name, endpoint });
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [endpoint, name]);

  const handleTestConnection = useCallback(async () => {
    if (!validateForm()) return;
    setIsTesting(true);
    setTestResult(null);
    setDiscoveredModels([]);
    setCatalog({});
    setModelManagement(undefined);
    setConfirmedMediaModels({});
    try {
      applyConnection(
        await remoteServerEditorApplication.test({
          endpoint,
          apiKey,
          current: currentModelIds(),
        }),
      );
    } finally {
      setIsTesting(false);
    }
  }, [apiKey, applyConnection, currentModelIds, endpoint, validateForm]);

  const saveServer = useCallback(async () => {
    try {
      const saved = await remoteServerEditorApplication.save({
        server,
        name,
        endpoint,
        apiKey,
        notes,
        modelIds: currentModelIds(),
        catalog,
        modelManagement,
        confirmedSelections: confirmedMediaModels,
        discoveredModels,
      });
      setOperationFailure(null);
      onSave?.(saved);
      onClose();
    } catch (error) {
      const failure =
        error instanceof RemoteServerEditorOperationError ? error.failure : null;
      if (failure) setOperationFailure(failure);
      setAlertState(
        showAlert(
          'Error',
          error instanceof Error ? error.message : 'Failed to save server',
        ),
      );
    }
  }, [
    apiKey,
    catalog,
    confirmedMediaModels,
    currentModelIds,
    discoveredModels,
    endpoint,
    modelManagement,
    name,
    notes,
    onClose,
    onSave,
    server,
  ]);

  const handleSave = useCallback(async () => {
    if (!validateForm()) return;
    if (endpoint && !isPrivateNetworkEndpoint(endpoint)) {
      setAlertState(showAlert(
        'Public Network Warning',
        'This endpoint appears to be on the public internet. Your data will be sent to a remote server. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: saveServer },
        ],
      ));
      return;
    }
    await saveServer();
  }, [endpoint, saveServer, validateForm]);

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
    imageModelId,
    setImageModelId,
    transcriptionModelId,
    setTranscriptionModelId,
    voiceModelId,
    setVoiceModelId,
    modelNames,
    errors,
    isTesting,
    testResult,
    operationFailure,
    discoveredModels,
    catalog,
    modelManagement,
    handleTestConnection,
    handleSave,
    isPublicNetwork: Boolean(endpoint && !isPrivateNetworkEndpoint(endpoint)),
    alertState,
    dismissAlert: () => setAlertState(initialAlertState),
  };
}
