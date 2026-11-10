import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, ActivityIndicator, Image, ScrollView, Share, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import RNFS from 'react-native-fs';
import { useTheme } from '../theme';
import { useAppStore } from '../stores';
import { activeModelService } from '../services/activeModelService';
import { imageGenerationService } from '../services/imageGenerationService';
import { localDreamGeneratorService, type NativeImageRuntimeStatus } from '../services/localDreamGenerator';
import { hardwareService } from '../services/hardware';
import { selectImageAccelerator, imageComputeMode } from '../services/imageAcceleratorSelection';
import type { GeneratedImage, ONNXImageModel } from '../types';
import { imageTestPreset, type ImageTestMode } from '../utils/nativeImageTuning';
import { isOverridableMemoryError } from '../utils/modelLoadErrors';
import { getMissingImageSupportGuides, isRunnableNativeModel, imageFamilyDisplay } from '../utils/nativeImageCompatibility';
const COLOR_FFF = '#fff';
const COLOR_B78A26 = '#b78a26';
const literalStyles = StyleSheet.create({
  s1: { flex: 1 },
  s2: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  s3: { padding: 6 },
  s4: { fontSize: 21, fontWeight: '700', marginLeft: 8 },
  s5: { padding: 12, paddingBottom: 56, maxWidth: 850, width: '100%', alignSelf: 'center' },
  s6: { fontSize: 16, fontWeight: '700' },
  s7: { marginTop: 6 },
  s8: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  s9: { marginTop: 8 },
  s10: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  s11: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  s12: { fontSize: 12 },
  s13: { marginTop: 12, alignItems: 'center' },
  s14: { fontWeight: '600' },
  s15: { marginTop: 9 },
  s16: { paddingVertical: 7 },
  s17: { alignItems: 'center' },
  s18: { padding: 12, borderRadius: 10, marginTop: 12 },
  s19: { color: COLOR_FFF, fontWeight: '700' },
  s20: { marginTop: 10, borderWidth: 1 },
  s21: { borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  s22: { fontSize: 12, marginTop: 2 },
  s23: { marginTop: 10 },
  s24: { color: COLOR_B78A26, marginTop: 7 },
  s25: { flexDirection: 'row' },
  s26: { width: 20 },
  s27: { flex: 1, marginLeft: 10 },
  s28: { marginTop: 4 },
  s29: { fontWeight: '700' },
  s30: { width: '100%', height: 330 },
  s31: { fontWeight: '600', marginTop: 8 },
  s32: { flexDirection: 'row', marginTop: 10 },
});


type Status = 'wait' | 'run' | 'ok' | 'warn' | 'fail';
type TestItem = { key: string; title: string; status: Status; detail: string };
const TITLES = [
  ['files', 'Model and supporting files'],
  ['ram', 'Available memory'],
  ['engine', 'Image engine loaded'],
  ['diffusion', 'Diffusion / generation progress'],
  ['output', 'Rendered image and prompt accuracy'],
] as const;
const emptyItems = (): TestItem[] => TITLES.map(([key, title]) => ({ key, title, status: 'wait', detail: '' }));
const SMILE = 'A single simple flat yellow smiley face icon: one bright yellow round circle with two small black dot eyes and one curved black smiling mouth, centered on a plain white background, clean vector art, no text.';
const fmt = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;
function settingsFor(model: ONNXImageModel, mode: ImageTestMode) {
  return imageTestPreset(model, mode, useAppStore.getState().settings);
}

export const ImageModelTestScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors } = useTheme();
  const id: string | undefined = route.params?.modelId;
  const model = useAppStore(s => s.downloadedImageModels.find(m => m.id === id));
  const [testMode, setTestMode] = useState<ImageTestMode>('smoke');
  const [includeLoRA, setIncludeLoRA] = useState(false);
  const [includeUpscaler, setIncludeUpscaler] = useState(false);
  const [items, setItems] = useState<TestItem[]>(emptyItems);
  const [running, setRunning] = useState(false);
  // Memory refusal can be overridden, the same "Load Anyway" the chat offers.
  const [canForce, setCanForce] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [diffusionStep, setDiffusionStep] = useState(0);
  const [runtime, setRuntime] = useState<NativeImageRuntimeStatus | null>(null);
  const [probingGpu, setProbingGpu] = useState(false);
  const [gpuDiagnostic, setGpuDiagnostic] = useState<{
    enumerated: boolean;
    androidVulkanFeature: boolean;
    backend: string;
    detail: string;
    nativeOutput: string;
  } | null>(null);
  const [gpuProbeError, setGpuProbeError] = useState<string | null>(null);
  const [cpuState, setCpuState] = useState<'active' | 'idle' | 'unknown'>('unknown');
  const previousTicks = useRef<number | null>(null);
  const [result, setResult] = useState<GeneratedImage | null>(null);
  const [decision, setDecision] = useState<'engine' | 'review' | 'pass' | 'wrong' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const started = useRef(0);
  const inProgress = useRef(false);
  const generating = useRef(false);
  const cancelRequested = useRef(false);
  const gone = useRef(false);

  useEffect(() => () => {
    gone.current = true;
    cancelRequested.current = true;
    if (generating.current) void localDreamGeneratorService.cancelGeneration().catch(() => {});
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running || model?.backend !== 'sdcpp') return;
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling || !generating.current || cancelRequested.current) return;
      polling = true;
      try {
        const status = await localDreamGeneratorService.getNativeImageRuntimeStatus();
        if (disposed || gone.current || !generating.current || !status) return;
        setRuntime(status);
        if (status.step > 0) setDiffusionStep(prev => Math.max(prev, status.step));
        if (status.cpuTicks >= 0) {
          const previous = previousTicks.current;
          if (previous !== null) setCpuState(status.cpuTicks > previous ? 'active' : 'idle');
          previousTicks.current = status.cpuTicks;
        } else {
          setCpuState('unknown');
        }
      } finally { polling = false; }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 12000);
    return () => { disposed = true; clearInterval(timer); };
  }, [running, model?.backend]);

  const checkGpu = async () => {
    if (running || probingGpu || gone.current) return;
    setProbingGpu(true);
    setGpuDiagnostic(null);
    setGpuProbeError(null);
    try {
      const diagnostic = await localDreamGeneratorService.getNativeImageGpuDiagnostics();
      if (!gone.current) setGpuDiagnostic(diagnostic);
    } catch (error: any) {
      if (!gone.current) setGpuProbeError(error?.message || String(error));
    } finally {
      if (!gone.current) setProbingGpu(false);
    }
  };

  const update = (key: string, status: Status, detail: string) => {
    if (!gone.current) setItems(prev => prev.map(item => item.key === key ? { ...item, status, detail } : item));
  };
  const doTest = async (force = false) => {
    if (!model || inProgress.current) return;
    inProgress.current = true;
    setCanForce(false);
    cancelRequested.current = false;
    started.current = Date.now();
    setItems(emptyItems());
    setFailure(null);
    setDecision(null);
    setResult(null);
    setElapsed(0);
    setDiffusionStep(0);
    setRuntime(null);
    setCpuState('unknown');
    previousTicks.current = null;
    setRunning(true);
    const cfg = settingsFor(model, testMode);
    try {
      if (imageGenerationService.getState().isGenerating || await localDreamGeneratorService.isGenerating()) {
        throw new Error('An image is already being generated. Finish or cancel it first.');
      }
      update('files', 'run', 'Checking model family and attached components...');
      if (!isRunnableNativeModel(model)) {
        throw new Error(`Unsupported architecture: ${imageFamilyDisplay(model.nativeImageFamily)}`);
      }
      const missing = getMissingImageSupportGuides(model);
      if (missing.length) {
        throw new Error(`${imageFamilyDisplay(model.nativeImageFamily) 
          } needs: ${missing.map(item => item.label).join(', ') 
          }. Open My models for direct links and attachment controls.`);
      }
      update('files', model.nativeImageFamily === 'unknown' ? 'warn' : 'ok',
        `${(model.nativeImageFamily || model.backend || 'image').toUpperCase() 
        } family. LoRAs ${includeLoRA ? 'on' : 'off' 
        }; upscaler ${includeUpscaler ? 'on' : 'off'}.`);
      if (cancelRequested.current) return;

      update('ram', 'run', 'Checking available RAM...');
      const mem = await activeModelService.checkMemoryForModel(model.id, 'image');
      if (!mem.canLoad && !force) { setCanForce(true); throw new Error('The model exceeds the safe memory budget. Free RAM, choose a smaller model, or tap Load anyway.'); }
      update('ram', !mem.canLoad || mem.severity === 'warning' ? 'warn' : 'ok', `${!mem.canLoad ? 'Forced. ' : '' 
        }Estimated ${mem.requiredMemoryGB.toFixed(1)} GB required, ${ 
        mem.availableMemoryGB.toFixed(1)} GB usable.`);
      if (cancelRequested.current) return;

      update('engine', 'run', 'Selecting and checking image accelerator...');
      const imageDecision = await selectImageAccelerator(
        model.backend || 'mnn', imageComputeMode(useAppStore.getState().settings), {
          vulkan: () => localDreamGeneratorService.getNativeImageGpuDiagnostics(),
          sdOpencl: () => localDreamGeneratorService.getNativeImageGpuDiagnostics('opencl'),
          opencl: () => hardwareService.getOpenCLCapability(),
          npu: async () => (await hardwareService.getSoCInfo()).hasNPU,
        },
      );
      if (cancelRequested.current) return;
      update('engine', 'run', `${imageDecision.note}. Loading model...`);
      const t0 = Date.now();
      await activeModelService.loadImageModel(model.id, undefined, force ? { override: true } : undefined);
      if (cancelRequested.current) return;
      if (!await localDreamGeneratorService.isModelLoaded()) throw new Error('The image engine did not report a loaded model.');
      const backend = await localDreamGeneratorService.getLoadedBackend();
      update('engine', 'ok', `${(backend || model.backend || 'unknown').toUpperCase() 
        } / ${imageDecision.selected.toUpperCase() 
        } selected in ${((Date.now() - t0) / 1000).toFixed(1) 
        }s. Loading alone does not prove that the checkpoint will render.`);

      update('diffusion', 'run', 'Initializing diffusion. The first step may take several minutes...');
      generating.current = true;
      const image = await localDreamGeneratorService.generateImage({
        ...cfg, prompt: SMILE, seed: 42,
        negativePrompt: model.nativeImageFamily === 'flux' ? '' : 'blurry, distorted, watermark, text',
        useOpenCL: imageDecision.useOpenCL,
        ...(imageDecision.computeBackend ? { computeBackend: imageDecision.computeBackend } : {}),
        previewInterval: 0,
        skipLoRA: !includeLoRA, skipUpscaler: !includeUpscaler,
        threads: useAppStore.getState().settings.imageThreads ?? 4,
      }, progress => {
        if (cancelRequested.current || gone.current) return;
        setDiffusionStep(progress.step);
        update('diffusion', 'run', `Step ${progress.step}/${ 
          progress.totalSteps || cfg.steps}; ${fmt(Math.floor((Date.now() - started.current) / 1000))}`);
      });
      generating.current = false;
      if (cancelRequested.current) return;
      if (!image?.imagePath) throw new Error('Diffusion finished without creating an image.');
      update('diffusion', 'ok', `${cfg.steps} diffusion steps requested and PNG output returned.`);

      update('output', 'run', 'Checking the generated image...');
      const filePath = image.imagePath.replace(/^file:\/\//, '');
      if (!await RNFS.exists(filePath)) throw new Error('The engine reported success, but the image file is missing.');
      const info = await RNFS.stat(filePath);
      const pngHeader = await RNFS.read(filePath, 8, 0, 'base64');
      if (Number(info.size) < 64 || pngHeader !== 'iVBORw0KGgo=') {
        throw new Error('The output is too small or does not contain a valid PNG header.');
      }
      if (!gone.current) { setResult(image); setDecision(testMode === 'smoke' ? 'engine' : 'review'); }
      update('output', testMode === 'smoke' ? 'ok' : 'warn',
        `${image.width}x${image.height} PNG (${ 
        Math.round(Number(info.size) / 1024)} KB). ${ 
        testMode === 'smoke' ? 'Native 1-step engine test passed; artistic quality was not tested.' :
          'Confirm the subject visually before marking success.'}`);
    } catch (err: any) {
      if (!cancelRequested.current && !gone.current) {
        const message = err?.message || String(err || 'Image generation failed');
        if (!force && isOverridableMemoryError(err)) setCanForce(true);
        setFailure(message);
        setItems(prev => {
          const current = prev.find(step => step.status === 'run');
          return current ? prev.map(step => step.key === current.key ?
            { ...step, status: 'fail', detail: message } : step) : prev;
        });
      }
    } finally {
      generating.current = false;
      inProgress.current = false;
      if (!gone.current) {
        setElapsed(Math.floor((Date.now() - started.current) / 1000));
        setRunning(false);
      }
    }
  };
  const stop = async () => {
    cancelRequested.current = true;
    update('diffusion', 'warn', 'Cancellation requested...');
    if (generating.current) await localDreamGeneratorService.cancelGeneration().catch(() => {});
  };

  const cfg = model ? settingsFor(model, testMode) : null;
  const card = { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10 };
  const bordered = (color: string) => ({
    borderColor: color, borderWidth: 1, borderRadius: 9, padding: 10, marginRight: 8,
  });
  const tone = (status: Status) => status === 'ok' ? (colors.success || '#299662') :
    status === 'fail' ? colors.error : status === 'warn' ? '#b78a26' :
    status === 'run' ? colors.primary : colors.textMuted;
  const imageUri = result?.imagePath ?
    (result.imagePath.startsWith('file://') ? result.imagePath : `file://${result.imagePath}`) : '';

  return (
    <SafeAreaView style={[literalStyles.s1, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={literalStyles.s2}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={literalStyles.s3}>
          <Icon name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[{ color: colors.text }, literalStyles.s4]}>Test image model</Text>
      </View>
      <ScrollView contentContainerStyle={literalStyles.s5}>
        {!model ? <Text style={{ color: colors.error }}>Image model not found.</Text> : <>
          <View style={card}>
            <Text style={[{ color: colors.text }, literalStyles.s6]}>{model.name}</Text>
            <Text style={[{ color: colors.textSecondary }, literalStyles.s7]}>Fixed test: yellow smiley face, seed 42, no LLM prompt rewriting.</Text>
            <View style={literalStyles.s8}>
              {([
                ['smoke', '1-step engine test'],
                ['quick', 'Short render'],
                ['quality', 'Quality render'],
              ] as const).map(([key, label]) => (
                <TouchableOpacity key={key} disabled={running}
                  onPress={() => setTestMode(key)}
                  style={bordered(testMode === key ? colors.primary : colors.border)}>
                  <Text style={{ color: testMode === key ? colors.primary : colors.textSecondary }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[{ color: colors.textMuted }, literalStyles.s9]}>
              {cfg?.width}x{cfg?.height} ? {cfg?.steps} steps ? CFG {cfg?.guidanceScale}
              {testMode === 'smoke' ? '. Only checks engine inference; image quality will be poor.' :
                testMode === 'quick' ? '. Low-step diagnostic; image quality is not representative.' :
                  '. Full quality uses much more RAM and may take a long time on CPU.'}
            </Text>
            {model.backend === 'sdcpp' && <>
              <View style={literalStyles.s10}>
                <Text style={[{ color: colors.text }, literalStyles.s1]}>Include style LoRAs</Text>
                <Switch disabled={running} value={includeLoRA} onValueChange={setIncludeLoRA} />
              </View>
              <View style={literalStyles.s11}>
                <Text style={[{ color: colors.text }, literalStyles.s1]}>Include ESRGAN upscaler</Text>
                <Switch disabled={running} value={includeUpscaler} onValueChange={setIncludeUpscaler} />
              </View>
              <Text style={[{ color: colors.textMuted }, literalStyles.s12]}>Both off by default. RealESRGAN_x4plus.pth is a 4x upscaler, not a style LoRA.</Text>
              <TouchableOpacity disabled={running || probingGpu} onPress={checkGpu}
                style={[bordered(colors.primary), literalStyles.s13]}>
                <Text style={[{ color: colors.primary }, literalStyles.s14]}>
                  {probingGpu ? 'Checking Vulkan hardware...' : 'Check GPU without loading Anima'}
                </Text>
              </TouchableOpacity>
              {gpuDiagnostic && (
                <View style={literalStyles.s15}>
                  <Text selectable style={[{ color: gpuDiagnostic.enumerated ? colors.text : colors.error }, literalStyles.s12]}>
                    {gpuDiagnostic.enumerated ? 'Vulkan device recognized.' : 'GPU probe inconclusive.'}
                    {' '}Android reports Vulkan: {gpuDiagnostic.androidVulkanFeature ? 'yes' : 'not advertised'}.
                    {' '}Backend: {gpuDiagnostic.backend}.
                    {' '}Native log: {gpuDiagnostic.nativeOutput}
                  </Text>
                  <TouchableOpacity onPress={() => {
                    void Share.share({ message:
                      `Atlas Vulkan probe - ${gpuDiagnostic.detail 
                      }\nDevice list: ${gpuDiagnostic.nativeOutput}` }).catch(() => {});
                  }} style={literalStyles.s16}>
                    <Text style={[{ color: colors.primary }, literalStyles.s12]}>Share GPU diagnostics</Text>
                  </TouchableOpacity>
                </View>
              )}
              {gpuProbeError && <Text selectable style={[{ color: colors.error }, literalStyles.s12]}>
                GPU check error: {gpuProbeError}
              </Text>}
            </>}
            <TouchableOpacity onPress={running ? stop : () => doTest()} style={[literalStyles.s17, { backgroundColor: running ? colors.error : colors.primary }, literalStyles.s18]}>
              <Text style={literalStyles.s19}>
                {running ? `Cancel test · ${fmt(elapsed)}` : decision || failure ? 'Test again' : 'Start test'}
              </Text>
            </TouchableOpacity>
            {canForce && !running && (
              <TouchableOpacity testID="model-test-load-anyway" onPress={() => doTest(true)} style={[literalStyles.s20, { borderColor: colors.error }, literalStyles.s21]}>
                <Text style={{ color: colors.error }}>Load anyway</Text>
                <Text style={[{ color: colors.textMuted }, literalStyles.s22]}>May close other apps or crash if memory runs out</Text>
              </TouchableOpacity>
            )}
            {model.backend === 'sdcpp' && running && elapsed >= 30 && (
              <View style={literalStyles.s23}>
                <Text selectable style={[{ color: colors.textSecondary }, literalStyles.s12]}>
                  Native process: {runtime?.running ? 'alive' : 'starting or unavailable'}.
                  {' '}Compute: {runtime?.computeBackend || 'detecting'}.
                  {' '}Precision: {runtime?.weightPrecision || 'detecting'}.
                  {' '}Stage: {runtime?.stage || 'awaiting diagnostics'}.
                  {' '}Step: {runtime?.step ?? diffusionStep}/{runtime?.totalSteps || cfg?.steps}.
                  {' '}Host CPU: {cpuState === 'active' ? 'active' :
                    cpuState === 'idle' ? 'no increase on last sample' : 'unavailable'}.
                  {' '}{runtime?.deviceLabel || ''}.
                  {runtime?.secondsSinceStep !== undefined && runtime.secondsSinceStep >= 0
                    ? ` Last completed step ${Math.round(runtime.secondsSinceStep)} seconds ago.`
                    : ' No completed diffusion step reported yet.'}
                  {runtime?.secondsSinceLog !== undefined && runtime.secondsSinceLog >= 0
                    ? ` Last engine output ${Math.round(runtime.secondsSinceLog)} seconds ago.` : ''}
                </Text>
                {elapsed >= 120 && (
                  <Text style={literalStyles.s24}>
                    {runtime?.computeBackend?.includes('Vulkan')
                      ? runtime.secondsSinceLog >= 60
                        ? 'Vulkan process has produced no recent output. GPU execution cannot be confirmed; it may be stalled. Try cancelling or switching to CPU explicitly.'
                        : 'Vulkan requested; recent native output is not proof of successful GPU compute. Check whether diffusion steps advance.'
                      : cpuState === 'active'
                        ? 'Native CPU use is increasing; it is computing, even if progress is unchanged.'
                        : 'Step progress has not advanced. This may be slow or stalled. Cancel and try the 1-step test or a smaller quantized model.'}
                  </Text>
                )}
              </View>
            )}
          </View>
          {items.map(item => <View key={item.key} style={[card, literalStyles.s25]}>
            {item.status === 'run' ?
              <ActivityIndicator size="small" color={colors.primary} style={literalStyles.s26} /> :
              <Icon name={item.status === 'ok' ? 'check-circle' : item.status === 'fail' ?
                'x-circle' : item.status === 'warn' ? 'alert-triangle' : 'circle'}
                size={20} color={tone(item.status)} />}
            <View style={literalStyles.s27}>
              <Text style={[{ color: colors.text }, literalStyles.s14]}>{item.title}</Text>
              {!!item.detail && <Text style={[{ color: colors.textSecondary }, literalStyles.s28]}>{item.detail}</Text>}
            </View>
          </View>)}
          {!!failure && <View style={card}><Text style={{ color: colors.error }}>Test failed: {failure}</Text></View>}
          {!!result && <View style={card}>
            <Text style={[{ color: colors.text }, literalStyles.s29]}>Generated image · {fmt(elapsed)}</Text>
            <Image source={{ uri: imageUri }} resizeMode="contain"
              style={[literalStyles.s30, { backgroundColor: colors.background }, literalStyles.s9]} />
            <Text style={[{ color: colors.textSecondary }, literalStyles.s9]}>{SMILE}</Text>
            {decision === 'engine' && <Text style={[{ color: colors.success || '#299662' }, literalStyles.s9]}>
              Native engine completed one diffusion step and saved a PNG. This does not
              test prompt accuracy; select Short render or Quality render for that.
            </Text>}
            {decision === 'review' && <Text style={[{ color: colors.text }, literalStyles.s31]}>
              Does it actually show a yellow smiley face?
            </Text>}
            {decision === 'pass' && <Text style={[{ color: colors.success || '#299662' }, literalStyles.s9]}>
              Visual test passed. The prompt was followed.
            </Text>}
            {decision === 'wrong' && <Text style={[{ color: colors.error }, literalStyles.s9]}>
              PNG is valid but prompt accuracy failed. Try quality mode without LoRAs or upscaling.
              The model architecture and text conditioning may need investigation.
            </Text>}
            {decision === 'review' && <View style={literalStyles.s32}>
              <TouchableOpacity onPress={() => {
                setDecision('pass'); update('output', 'ok', 'PNG valid; user confirmed the subject.');
              }} style={bordered(colors.primary)}>
                <Text style={{ color: colors.primary }}>Looks correct</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => {
                setDecision('wrong'); update('output', 'fail', 'PNG valid but prompt not followed.');
              }} style={bordered(colors.error)}>
                <Text style={{ color: colors.error }}>Wrong image</Text>
              </TouchableOpacity>
            </View>}
          </View>}
        </>}
      </ScrollView>
    </SafeAreaView>
  );
};