/* eslint-disable react-native/no-inline-styles, react-native/no-color-literals, max-params -- Existing device storage/model dashboard uses numerous runtime theme styles and confirmation helper. */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Clipboard, Linking, Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SpeedRankingCard } from '../components/models/SpeedRanking';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useAppStore } from '../stores';
import { useWhisperStore } from '../stores/whisperStore';
import { WHISPER_MODELS } from '../services/whisperService';
import { modelManager } from '../services';
import { modelDownloadService } from '../services/modelDownloadService';
import { uniformDownloadId } from '../services/modelDownloadService/uniformId';
import { CustomAlert, hideAlert, initialAlertState, AlertState, showAlert } from '../components/CustomAlert';
import { pickAndAttachMmProj, pickAndAttachDraft } from './ModelsScreen/importHelpers';
import { quickImportModel } from './ModelsScreen/quickImport';
import { pickAndAttachImageSupport, modifyImageSupport, isPickerCancel, ImageSupport } from './ModelsScreen/imageSupportActions';
import { imageJsonConfigHint, ATLAS_NATIVE_IMAGE_CONFIG_SAMPLE } from '../utils/imageSupportFormat';
import { getMissingImageSupportGuides, imageFamilyDisplay } from '../utils/nativeImageCompatibility';
import { listVolumes, sdCard, useStoragePrefs, chooseSd, fmtBytes, Volume } from '../atlasTools/storage';
import type { DownloadedModel, ONNXImageModel } from '../types';
import { useSpeedStats } from '../atlasTools/speed';

/** Everything downloaded, in one place: delete, move to the SD card, add a vision file, import. */
export const MyModelsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const textModels = useAppStore((s) => s.downloadedModels);
  const imageModels = useAppStore((s) => s.downloadedImageModels);
  const nicknames = useAppStore((s) => s.modelNicknames);
  const setModelNickname = useAppStore((s) => s.setModelNickname);
  const [nicknameTarget, setNicknameTarget] = useState<{ id: string; name: string } | null>(null);
  const [nicknameText, setNicknameText] = useState('');
  const openNickname = (id: string, name: string) => {
    setNicknameTarget({ id, name }); setNicknameText(nicknames[id] ?? '');
  };
  const activeId = useAppStore((s) => s.activeModelId);
  const whisperPresent = useWhisperStore((s) => s.presentModelIds);
  const useSd = useStoragePrefs((s) => s.useSd);
  const speeds = useSpeedStats((s) => s.byModel);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [busy, setBusy] = useState<{ id: string; label: string; fraction: number } | null>(null);
  const [vols, setVols] = useState<Volume[]>([]);
  const [sd, setSd] = useState<Volume | undefined>(undefined);

  const refreshVolumes = useCallback(() => {
    listVolumes().then(setVols).catch(() => undefined);
    sdCard().then(setSd).catch(() => undefined);
  }, []);
  useEffect(() => { refreshVolumes(); useWhisperStore.getState().refreshPresentModels?.().catch?.(() => undefined); }, [refreshVolumes]);

  const phone = vols.find((v) => !v.removable);
  const card = { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10 };
  const btn = (color: string) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, borderWidth: 1, borderColor: color, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginRight: 8, marginTop: 8 });

  const confirm = (title: string, msg: string, action: string, fn: () => void) =>
    Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: fn }]);

  const delText = (m: DownloadedModel) => confirm('Delete model?', `${m.name} (${fmtBytes((m.fileSize || 0) + ((m as any).mmProjFileSize || 0))}) will be removed from this device.`, 'Delete', async () => {
    try {
      if (m.id === activeId) {
        const { activeModelService } = require('../services/activeModelService');
        await activeModelService.unloadTextModel().catch(() => undefined);
      }
      await modelManager.deleteModel(m.id);
      useAppStore.getState().removeDownloadedModel(m.id);
      modelDownloadService.remove(uniformDownloadId('text', m.id)).catch(() => undefined); // clear any download record
    } catch (e: any) {
      setAlertState(showAlert('Could not delete', String(e?.message || e)));
    }
  });
  const delImage = (m: ONNXImageModel) => confirm('Delete image model?', `${m.name} will be removed from this device.`, 'Delete', async () => {
    try { await modelDownloadService.remove(uniformDownloadId('image', m.id)); } catch (e: any) { setAlertState(showAlert('Could not delete', String(e?.message || e))); }
  });
  const delWhisper = (id: string, name: string) => confirm('Delete speech model?', `${name} will be removed. Talking to the app needs a speech model.`, 'Delete', async () => {
    try { await useWhisperStore.getState().deleteModelById(id); } catch (e: any) { setAlertState(showAlert('Could not delete', String(e?.message || e))); }
  });

  const move = async (m: DownloadedModel, toSd: boolean) => {
    if (m.id === activeId) {
      try { const { activeModelService } = require('../services/activeModelService'); await activeModelService.unloadTextModel(true); } catch { /* not loaded */ }
    }
    const target = toSd ? await sdCard() : undefined;
    if (toSd && !target) { setAlertState(showAlert('No SD card', 'Insert an SD card (set up as portable storage) and try again.')); return; }
    const need = (m.fileSize || 0) + ((m as any).mmProjFileSize || 0);
    if (toSd && target && target.free < need * 1.05) { setAlertState(showAlert('Not enough space', `The SD card has ${fmtBytes(target.free)} free; this model needs ${fmtBytes(need)}.`)); return; }
    setBusy({ id: m.id, label: toSd ? 'Moving to SD card' : 'Moving to phone', fraction: 0 });
    try {
      await modelManager.moveModel(m.id, toSd && target ? target.path : null, (f) => setBusy((b) => (b ? { ...b, fraction: f } : b)));
      refreshVolumes();
    } catch (e: any) {
      setAlertState(showAlert('Could not move the model', String(e?.message || e)));
    } finally { setBusy(null); }
  };

  const addVision = async (m: DownloadedModel) => {
    await pickAndAttachMmProj(m.id, m.name, {
      setAlertState,
      setImportProgress: (p) => setBusy(p ? { id: m.id, label: 'Adding vision file', fraction: p.fraction } : null),
    });
  };
  const addDraft = async (m: DownloadedModel) => {
    await pickAndAttachDraft(m.id, m.name, {
      setAlertState,
      setImportProgress: (p) => setBusy(p ? { id: m.id, label: 'Adding MTP file', fraction: p.fraction } : null),
    });
  };
  const removeDraft = (m: DownloadedModel) => confirm('Remove MTP file?', `${m.name} will no longer draft with its MTP file.`, 'Remove', async () => {
    await modelManager.removeDraft(m.id);
  });
  const removeVision = (m: DownloadedModel) => confirm('Remove vision file?', `${m.name} will no longer look at pictures.`, 'Remove', async () => {
    const mm = (m as any).mmProjPath as string | undefined;
    await modelManager.clearMmProjLink(m.id);
    if (mm && !textModels.some((x) => x.id !== m.id && (x as any).mmProjPath === mm)) {
      try { const RNFS = require('react-native-fs').default; await RNFS.unlink(mm); } catch { /* already gone */ }
    }
  });

  const doImport = async () => {
    await quickImportModel({ setAlertState, setImportProgress: (p) => setBusy(p ? { id: 'import', label: `Importing ${p.fileName}`, fraction: p.fraction } : null) });
  };

  const addImageSupport = async (model: ONNXImageModel) => {
    try {
      const attached = await pickAndAttachImageSupport(model, (label, fraction) =>
        setBusy({ id: model.id, label, fraction }));
      if (attached) setAlertState(showAlert('Support file attached',
        `${attached.name} is linked to ${model.name}. ${attached.kind === 'config' ? imageJsonConfigHint(attached.name) : ''}`));
    } catch (e: any) {
      if (!isPickerCancel(e)) setAlertState(showAlert('Could not attach image support', String(e?.message || e)));
    } finally { setBusy(null); }
  };

  const changeImageSupport = async (model: ONNXImageModel, file: ImageSupport,
    change: { delete?: boolean; enabled?: boolean; strength?: number }) => {
    setBusy({ id: model.id, label: 'Updating image support', fraction: 0 });
    try {
      await modifyImageSupport(model, file, change);
    } catch (e: any) {
      setAlertState(showAlert('Could not update support', String(e?.message || e)));
    } finally { setBusy(null); }
  };

  const whisperOnDisk = WHISPER_MODELS.filter((w: any) => whisperPresent.includes(w.id));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 6 }}><Icon name="arrow-left" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700', fontFamily: 'serif', marginLeft: 8, flex: 1 }}>My models</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60, width: '100%', maxWidth: 900, alignSelf: 'center' }}>
        <SpeedRankingCard style={card} />
        {/* Storage */}
        <View style={card}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Storage</Text>
          <Text style={{ color: colors.textSecondary, marginTop: 4 }}>
            Phone: {phone ? `${fmtBytes(phone.free)} free of ${fmtBytes(phone.total)}` : '...'}
            {sd ? `\nSD card: ${fmtBytes(sd.free)} free of ${fmtBytes(sd.total)}` : '\nNo SD card found'}
          </Text>
          {!!sd && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
              <Text style={{ color: colors.text, flex: 1, paddingRight: 8 }}>Save new library, maps and voice downloads to the SD card</Text>
              <Switch value={useSd} onValueChange={async (v) => { const r = await chooseSd(v); if (!r.ok) setAlertState(showAlert('SD card', r.message || '')); }} />
            </View>
          )}
          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>
            Models download to the phone first; use "Move to SD card" on a model to free phone space. Keep the card in: models on it can't load while it's out. Files on the SD card are deleted if Atlas is uninstalled.
          </Text>
        </View>

        <TouchableOpacity onPress={doImport} style={[card, { flexDirection: 'row', alignItems: 'center' }]}>
          <Icon name="folder-plus" size={20} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>Import a model file from this device</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>.safetensors images, .gguf images/LLMs (including optional mmproj), or .litertlm. Import MNN/QNN ZIPs in Models.</Text>
          </View>
        </TouchableOpacity>

        {!!busy && (
          <View style={[card, { flexDirection: 'row', alignItems: 'center' }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.text, marginLeft: 10, flex: 1 }}>{busy.label}... {Math.round(busy.fraction * 100)}%</Text>
          </View>
        )}

        <Text style={{ color: colors.textSecondary, fontWeight: '700', marginTop: 8, marginBottom: 6 }}>TEXT MODELS ({textModels.length})</Text>
        {!textModels.length && <Text style={{ color: colors.textMuted, marginBottom: 10 }}>None yet. Download one in the Models tab or import a file.</Text>}
        {textModels.map((m) => {
          const vision = m.engine === 'llama' && !!(m as any).mmProjPath;
          const onSd = (m as any).storage === 'sd';
          const size = (m.fileSize || 0) + ((m as any).mmProjFileSize || 0);
          return (
            <View key={m.id} style={card}>
              <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>{nicknames[m.id] || m.name}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                {m.fileName} · {fmtBytes(size)} · {onSd ? 'SD card' : 'phone'}{m.engine === 'litert' ? ' · LiteRT' : ''}{m.engine === 'llama' && (m.draftPath || m.embeddedMtp) ? ' · MTP' : ''}{vision ? ' · sees pictures' : ''}{m.id === activeId ? ' · in use' : ''}{speeds[m.id]?.decode ? ` · writes ~${Math.max(1, Math.round(speeds[m.id].decode * 0.75))} words/s` : ''}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <TouchableOpacity style={btn(colors.primary)} onPress={() => openNickname(m.id, m.name)}><Icon name="edit-2" size={14} color={colors.primary} /><Text style={{ color: colors.primary, marginLeft: 6 }}>Nickname</Text></TouchableOpacity>
                <TouchableOpacity style={btn(colors.primary)} disabled={!!busy} onPress={() => navigation.navigate('ModelTest', { modelId: m.id })}><Icon name="activity" size={14} color={colors.primary} /><Text style={{ color: colors.primary, marginLeft: 6 }}>Test</Text></TouchableOpacity>
                {m.engine === 'llama' && (vision ? (
                  <TouchableOpacity style={btn(colors.border)} onPress={() => removeVision(m)}><Icon name="eye-off" size={14} color={colors.textSecondary} /><Text style={{ color: colors.textSecondary, marginLeft: 6 }}>Remove vision file</Text></TouchableOpacity>
                ) : (
                  <TouchableOpacity style={btn(colors.primary)} onPress={() => addVision(m)}><Icon name="eye" size={14} color={colors.primary} /><Text style={{ color: colors.primary, marginLeft: 6 }}>Add vision file</Text></TouchableOpacity>
                ))}
                {m.engine === 'llama' && !m.draftPath && (
                  <TouchableOpacity style={btn(m.embeddedMtp ? colors.primary : colors.border)} testID={`embedded-mtp-${m.id}`}
                    onPress={() => { void modelManager.setEmbeddedMtp(m.id, !m.embeddedMtp); }}>
                    <Icon name="zap" size={14} color={m.embeddedMtp ? colors.primary : colors.textSecondary} />
                    <Text style={{ color: m.embeddedMtp ? colors.primary : colors.textSecondary, marginLeft: 6 }}>{m.embeddedMtp ? 'MTP built in: on' : 'MTP built in: off'}</Text>
                  </TouchableOpacity>
                )}
                {m.engine === 'llama' && (m.draftPath ? (
                  <TouchableOpacity style={btn(colors.border)} testID={`remove-mtp-${m.id}`} onPress={() => removeDraft(m)}><Icon name="zap-off" size={14} color={colors.textSecondary} /><Text style={{ color: colors.textSecondary, marginLeft: 6 }}>Remove MTP file</Text></TouchableOpacity>
                ) : (
                  <TouchableOpacity style={btn(colors.primary)} disabled={!!busy} testID={`add-mtp-${m.id}`} onPress={() => addDraft(m)}><Icon name="zap" size={14} color={colors.primary} /><Text style={{ color: colors.primary, marginLeft: 6 }}>Add MTP file</Text></TouchableOpacity>
                ))}
                {(sd || onSd) && (
                  <TouchableOpacity style={btn(colors.border)} disabled={!!busy} onPress={() => move(m, !onSd)}>
                    <Icon name={onSd ? 'smartphone' : 'hard-drive'} size={14} color={colors.text} />
                    <Text style={{ color: colors.text, marginLeft: 6 }}>{onSd ? 'Move to phone' : 'Move to SD card'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={btn(colors.error)} disabled={!!busy} onPress={() => delText(m)}><Icon name="trash-2" size={14} color={colors.error} /><Text style={{ color: colors.error, marginLeft: 6 }}>Delete</Text></TouchableOpacity>
              </View>
            </View>
          );
        })}

        <Text style={{ color: colors.textSecondary, fontWeight: '700', marginTop: 8, marginBottom: 6 }}>IMAGE MODELS ({imageModels.length})</Text>
        {imageModels.map((m) => (
          <View key={m.id} style={card}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{nicknames[m.id] || m.name}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  {fmtBytes(m.size || 0)} · {m.backend === 'sdcpp' ? `Original ${imageFamilyDisplay(m.nativeImageFamily)} weights` : (m.backend || 'model').toUpperCase()}
                </Text>
              </View>
              <TouchableOpacity style={btn(colors.primary)} onPress={() => openNickname(m.id, m.name)}><Icon name="edit-2" size={14} color={colors.primary} /><Text style={{ color: colors.primary, marginLeft: 6 }}>Nickname</Text></TouchableOpacity>
              <TouchableOpacity style={btn(colors.primary)} disabled={!!busy}
                onPress={() => navigation.navigate('ModelTest', { modelId: m.id, modelType: 'image' })}>
                <Icon name="activity" size={14} color={colors.primary} />
                <Text style={{ color: colors.primary, marginLeft: 6 }}>Test</Text>
              </TouchableOpacity>
              <TouchableOpacity style={btn(colors.error)} disabled={!!busy} onPress={() => delImage(m)}>
                <Icon name="trash-2" size={14} color={colors.error} />
                <Text style={{ color: colors.error, marginLeft: 6 }}>Delete</Text>
              </TouchableOpacity>
            </View>
            {m.backend === 'sdcpp' && getMissingImageSupportGuides(m).length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: colors.error, fontSize: 12, fontWeight: '600' }}>
                  Missing components. Download and attach these to {m.name}:
                </Text>
                {getMissingImageSupportGuides(m).map(guide => (
                  <View key={guide.kind} style={{ marginTop: 7 }}>
                    <Text style={{ color: colors.text, fontSize: 12 }}>
                      {guide.label}{guide.fileName ? ` ? ${  guide.fileName}` : ''}
                    </Text>
                    {guide.downloadUrl && (
                      <TouchableOpacity
                        accessibilityRole="link"
                        onPress={() => Linking.openURL(guide.downloadUrl!).catch((err: unknown) =>
                          setAlertState(showAlert('Could not open download', String(err))))}
                        style={{ paddingVertical: 5 }}>
                        <Text style={{ color: colors.primary, fontSize: 12 }}>
                          Open official file on Hugging Face
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 5 }}>
                  After downloading, tap Attach LoRA / support file below. These are not chat models or style LoRAs.
                </Text>
              </View>
            )}
            {m.backend === 'sdcpp' && (
              <View style={{ marginTop: 8 }}>
                <TouchableOpacity style={[btn(colors.primary), { alignSelf: 'flex-start' }]} disabled={!!busy}
                  onPress={() => addImageSupport(m)}>
                  <Icon name="plus-circle" size={14} color={colors.primary} />
                  <Text style={{ color: colors.primary, marginLeft: 6 }}>Attach LoRA / support file</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>
                  LoRAs modify style. RealESRGAN .pth is an upscaler. Native atlas-runtime.json changes supported sampler settings; other JSON is metadata, not model weights.
                </Text>
                <TouchableOpacity testID="native-image-config-example" accessibilityRole="button"
                  style={[btn(colors.border), { alignSelf: 'flex-start' }]}
                  onPress={() => {
                    Clipboard.setString(ATLAS_NATIVE_IMAGE_CONFIG_SAMPLE);
                    setAlertState(showAlert('Native JSON config copied',
                      'Save this JSON as atlas-runtime.json, then Attach LoRA / support file. Supported sampler and schedule fields affect the native image engine. Other model/pipeline JSON cannot make incompatible weights runnable.'));
                  }}>
                  <Icon name="copy" size={14} color={colors.text} />
                  <Text style={{ color: colors.text, marginLeft: 6, fontSize: 12 }}>Copy native JSON example</Text>
                </TouchableOpacity>
                {(m.supportFiles || []).map(file => (
                  <View key={`${file.kind  }/${  file.name}`} style={{ marginTop: 8, borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>
                    <Text style={{ color: colors.text, fontWeight: '500', fontSize: 13 }}>{file.name}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{file.kind.toUpperCase()} · {fmtBytes(file.size)}{file.kind === 'lora' ? ` · strength ${file.strength.toFixed(2)}` : ''} · {file.enabled ? 'enabled' : 'disabled'}</Text>
                    {file.kind === 'config' && <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>{imageJsonConfigHint(file.name)}</Text>}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                      <TouchableOpacity style={btn(colors.primary)} disabled={!!busy}
                        onPress={() => changeImageSupport(m, file, { enabled: !file.enabled })}>
                        <Text style={{ color: colors.primary }}>{file.enabled ? 'Disable' : 'Enable'}</Text>
                      </TouchableOpacity>
                      {file.kind === 'lora' && (
                        <>
                          <TouchableOpacity style={btn(colors.border)} disabled={!!busy}
                            onPress={() => changeImageSupport(m, file, { strength: Math.max(0, file.strength - 0.15) })}>
                            <Icon name="minus" size={15} color={colors.text} />
                          </TouchableOpacity>
                          <TouchableOpacity style={btn(colors.border)} disabled={!!busy}
                            onPress={() => changeImageSupport(m, file, { strength: Math.min(2, file.strength + 0.15) })}>
                            <Icon name="plus" size={15} color={colors.text} />
                          </TouchableOpacity>
                        </>
                      )}
                      <TouchableOpacity style={btn(colors.error)} disabled={!!busy}
                        onPress={() => confirm('Remove support file?', `${file.name  } will be detached and deleted from Atlas.`, 'Remove',
                          () => { void changeImageSupport(m, file, { delete: true }); })}>
                        <Icon name="trash-2" size={14} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}

        <Text style={{ color: colors.textSecondary, fontWeight: '700', marginTop: 8, marginBottom: 6 }}>SPEECH-TO-TEXT ({whisperOnDisk.length})</Text>
        {whisperOnDisk.map((w: any) => (
          <View key={w.id} style={[card, { flexDirection: 'row', alignItems: 'center' }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{w.name || w.id}</Text>
              {!!w.size && <Text style={{ color: colors.textMuted, fontSize: 12 }}>{w.size} MB</Text>}
            </View>
            <TouchableOpacity style={btn(colors.error)} onPress={() => delWhisper(w.id, w.name || w.id)}><Icon name="trash-2" size={14} color={colors.error} /><Text style={{ color: colors.error, marginLeft: 6 }}>Delete</Text></TouchableOpacity>
          </View>
        ))}
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>Natural voices are in Models → Voice. Library packs and encyclopedias are in Settings → Offline Library. Maps are in Atlas → Maps.</Text>
      </ScrollView>
      <Modal transparent visible={!!nicknameTarget} animationType="fade"
        onRequestClose={() => setNicknameTarget(null)}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 14, gap: 12 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 18 }}>Model nickname</Text>
            <Text style={{ color: colors.textSecondary }}>Give {nicknameTarget?.name} a friendly name. The original filename and model weights stay unchanged.</Text>
            <TextInput autoFocus maxLength={80} value={nicknameText} onChangeText={setNicknameText}
              testID="model-nickname-input" placeholder={nicknameTarget?.name}
              placeholderTextColor={colors.textMuted}
              style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 12 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 20 }}>
              <TouchableOpacity onPress={() => setNicknameTarget(null)}><Text style={{ color: colors.text }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => {
                if (nicknameTarget) setModelNickname(nicknameTarget.id, nicknameText);
                setNicknameTarget(null);
              }}><Text style={{ color: colors.primary, fontWeight: '700' }}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};
