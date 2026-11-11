import React, { useState } from 'react';
import { ModelSelectorModal } from './ModelSelectorModal';
import { CustomAlert, hideAlert, initialAlertState, type AlertState } from './CustomAlert';
import { activeModelService, llmService, remoteServerManager } from '../services';
import { loadModelWithOverride } from '../services/loadModelWithOverride';

/**
 * Pick and load a model from anywhere (the Home screen's "Load a model" tile), with the same memory
 * checks and "Load anyway" choice as the chat screen. Downloading models is the Models tab.
 */
export const LoadModelSheet: React.FC<{ visible: boolean; onClose: () => void; onBrowse: (tab?: any) => void; onAddServer: () => void }> = ({ visible, onClose, onBrowse, onAddServer }) => {
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [loading, setLoading] = useState(false);
  const load = (fn: (opts?: any) => Promise<any>) => loadModelWithOverride(fn, {
    setAlertState, onAttemptStart: () => setLoading(true), onAttemptEnd: () => setLoading(false), onSuccess: onClose,
  });
  const unload = async (fn: () => Promise<void>) => { setLoading(true); try { await fn(); } finally { setLoading(false); } };
  return (
    <>
      <ModelSelectorModal
        visible={visible}
        onClose={onClose}
        onSelectModel={(m: any) => load((opts) => activeModelService.loadTextModel(m.id, undefined, opts))}
        onSelectImageModel={(m: any) => load((opts) => activeModelService.loadImageModel(m.id, undefined, opts))}
        onUnloadModel={() => unload(async () => { remoteServerManager.clearActiveRemoteModel(); if (llmService.isModelLoaded()) await activeModelService.unloadTextModel(); })}
        onUnloadImageModel={() => unload(() => activeModelService.unloadImageModel())}
        isLoading={loading}
        onAddServer={() => { onClose(); onAddServer(); }}
        onBrowseModels={(tab) => { onClose(); onBrowse(tab); }}
      />
      <CustomAlert visible={alertState.visible} title={alertState.title} message={alertState.message} buttons={alertState.buttons} onClose={() => setAlertState(hideAlert())} />
    </>
  );
};
