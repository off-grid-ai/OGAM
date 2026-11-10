import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useAppStore } from '../stores';
import { activeModelService } from '../services/activeModelService';
import { llmService } from '../services/llm';
import { vulkanEngine, describeVulkanStatus } from '../services/vulkanEngine';
import { describeOffload } from '../services/gpuOffload';
import { liteRTService } from '../services/litert';
import { hardwareService } from '../services/hardware';
import type { Message } from '../types';
import { useSpeedStats, estimateReply, fmtSec, speedHealthLabel } from '../atlasTools/speed';
import { localUniqueId } from '../utils/uniqueId';
import { ImageModelTestScreen } from './ImageModelTestScreen';
import { isOverridableMemoryError } from '../utils/modelLoadErrors';
import { cancelTuning, tuneDevice, type TuneOutcome, type TuneProgress } from '../services/deviceTuner';
const WHITE = '#ffffff';

type Status = 'wait' | 'run' | 'ok' | 'warn' | 'fail' | 'skip';
interface Step { key: string; title: string; status: Status; detail: string }

const STEPS: Array<Pick<Step, 'key' | 'title'>> = [
  { key: 'fit', title: 'Fits in memory' },
  { key: 'load', title: 'Loads' },
  { key: 'speed', title: 'Writing speed' },
  { key: 'read', title: 'Reading speed (long documents)' },
  { key: 'ctx', title: 'Memory size (context)' },
  { key: 'accel', title: 'GPU / NPU' },
  { key: 'extras', title: 'Abilities' },
];

const LONG_TEXT = Array.from({ length: 40 }, (_, i) =>
  `Section ${i + 1}. A traveller walked along the river, counting stones and noting the weather, the birds and the colour of the water before the evening rain.`,
).join(' ');

const msg = (content: string, role: Message['role'] = 'user'): Message => ({ id: localUniqueId('test'), role, content, timestamp: Date.now() });

const tps0 = (v: { text: string }) => /slow/i.test(v.text);
const speedWords = (tps: number) => {
  const health = speedHealthLabel(tps);
  if (health === 'slow') return 'slow - you will wait for each answer';
  if (health === 'usable') return 'about reading speed - fine for chatting';
  if (health === 'good') return 'good - faster than you can read';
  return health;
};

/** Runs a model through a quick check: will it fit, does it load, how fast it writes and reads, what it can do. */
const TextModelTestScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors } = useTheme();
  const modelId: string = route.params?.modelId;
  const model = useAppStore((s) => s.downloadedModels.find((m) => m.id === modelId));
  const [steps, setSteps] = useState<Step[]>(STEPS.map((s) => ({ ...s, status: 'wait', detail: '' })));
  const [running, setRunning] = useState(false);
  const [vulkanBusy, setVulkanBusy] = useState(false);
  const [vulkanResult, setVulkanResult] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ good: boolean; text: string } | null>(null);
  const [prevId, setPrevId] = useState<string | null>(null);
  const [faster, setFaster] = useState<string | null>(null);
  // Memory refusal can be overridden, the same "Load Anyway" the chat offers.
  const [canForce, setCanForce] = useState(false);
  const [tuneBusy, setTuneBusy] = useState(false);
  const [tune, setTune] = useState<TuneProgress | null>(null);
  const [tuned, setTuned] = useState<TuneOutcome | null>(null);
  const [tuneError, setTuneError] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const set = (key: string, status: Status, detail: string) =>
    setSteps((all) => all.map((s) => (s.key === key ? { ...s, status, detail } : s)));

  const run = async (force = false) => {
    if (!model || running) return;
    cancelled.current = false;
    setRunning(true);
    setCanForce(false);
    setVerdict(null);
    setFaster(null);
    setSteps(STEPS.map((s) => ({ ...s, status: 'wait', detail: '' })));
    const store = useAppStore.getState();
    const before = store.activeModelId;
    setPrevId(before && before !== model.id ? before : null);
    const isLite = model.engine === 'litert';
    let ok = true;
    let tps = 0;
    try {
      if (llmService.isCurrentlyGenerating()) {
        throw new Error('A chat answer is still being written. Wait for it to finish, then test again.');
      }
      // 1. Memory
      set('fit', 'run', 'Checking...');
      const mem = await activeModelService.checkMemoryForModel(model.id, 'text');
      const total = hardwareService.getTotalMemoryGB();
      const need = `needs about ${mem.requiredMemoryGB.toFixed(1)} GB; ${mem.availableMemoryGB.toFixed(1)} GB usable of ${total.toFixed(0)} GB`;
      if (!mem.canLoad && !force) { set('fit', 'fail', `Too big for this device (${need}). Try a smaller or more compressed version (Q4), or tap Load anyway.`); ok = false; setCanForce(true); throw new Error(''); }
      if (!mem.canLoad) set('fit', 'warn', `Forced (${need}). The app or other apps may be closed.`);
      else set('fit', mem.severity === 'warning' ? 'warn' : 'ok', mem.severity === 'warning' ? `Tight (${need}). Other apps may get closed.` : `Yes (${need})`);
      if (cancelled.current) return;

      // 2. Load
      set('load', 'run', before === model.id ? 'Already loaded' : 'Loading... (can take a minute)');
      const t0 = Date.now();
      await activeModelService.loadTextModel(model.id, undefined, force ? { override: true } : undefined);
      const loadS = (Date.now() - t0) / 1000;
      set('load', 'ok', before === model.id && loadS < 1 ? 'Already loaded' : `Loaded in ${loadS.toFixed(1)} s`);
      if (cancelled.current) return;

      // 3. Writing speed
      set('speed', 'run', 'Writing a short paragraph...');
      const keptOutLen = useSpeedStats.getState().byModel[model.id]?.outLen || 0; // the test paragraph isn't a typical answer
      let sample = '';
      if (isLite) {
        liteRTService.invalidateConversation();
        sample = await liteRTService.generateRaw('Write one short paragraph (about 60 words) about rivers. No title.');
        const st = liteRTService.getLastBenchmarkStats();
        tps = st?.decodeTokensPerSecond || 0;
      } else {
        sample = await llmService.generateResponse([msg('Write one short paragraph (about 60 words) about rivers. No title.')], { disableThinking: true });
        const st = llmService.getPerformanceStats();
        tps = st.lastDecodeTokensPerSecond || st.lastTokensPerSecond || 0;
      }
      if (keptOutLen) useSpeedStats.setState((st) => st.byModel[model.id] ? { byModel: { ...st.byModel, [model.id]: { ...st.byModel[model.id], outLen: keptOutLen } } } : st);
      if (!sample.trim()) { set('speed', 'fail', 'The model loaded but wrote nothing. The file may be damaged or not a chat model.'); ok = false; }
      else set('speed', tps < 3 ? 'warn' : 'ok', `${tps.toFixed(1)} word-pieces per second: ${speedWords(tps)}.\nSample: "${sample.trim().slice(0, 160)}${sample.length > 160 ? '...' : ''}"`);
      if (cancelled.current) return;

      // 4. Reading speed (prompt processing)
      set('read', 'run', 'Reading a long passage...');
      try {
        let readTps = 0;
        if (isLite) {
          liteRTService.invalidateConversation();
          await liteRTService.generateRaw(`${LONG_TEXT}\n\nIn one word, what was the traveller counting?`);
          const st = liteRTService.getLastBenchmarkStats();
          readTps = st?.prefillTokensPerSecond || 0;
        } else {
          await llmService.generateWithMaxTokens([msg(`${LONG_TEXT}\n\nIn one word, what was the traveller counting?`)], 4);
          // Native prefill timing is recorded by llama.rn; elapsed wall time also
          // includes generation and must never be presented as prompt tok/s.
          // The experimental Vulkan engine does not yet export native prefill timings.
          // Never show a previous llama.rn value as this Vulkan run's throughput.
          readTps = llmService.getGpuInfo().gpuBackend === 'Vulkan' ? 0 : (useSpeedStats.getState().byModel[model.id]?.prefill || 0);
        }
        const pageSec = readTps > 0 ? 500 / readTps : 0; // ~500 tokens per page
        set('read', readTps > 0 && readTps < 40 ? 'warn' : 'ok', readTps > 0
          ? `About ${Math.round(readTps)} pieces per second - roughly ${pageSec < 1 ? 'under a second' : `${pageSec.toFixed(0)} s`} per page of a document.`
          : 'Done (speed not reported by this engine).');
      } catch (e: any) { set('read', 'warn', `Could not measure: ${e?.message || e}`); }
      if (cancelled.current) return;

      // 5. Context
      const maxCtx = useAppStore.getState().modelMaxContext;
      const usedCtx = isLite ? liteRTService.getContextUsage().max : llmService.getPerformanceSettings().contextLength;
      const kWords = (n: number) => `${(n / 1024).toFixed(0)}K (about ${Math.round((n * 0.75) / 1000)} thousand words)`;
      set('ctx', 'ok', `Running with ${usedCtx ? kWords(usedCtx) : 'unknown'}${!isLite && maxCtx ? `; the model can go up to ${kWords(maxCtx)}` : ''}. Change it in Chat settings > Memory size. Bigger uses more RAM and gets slower.`);

      // 6. Acceleration
      if (isLite) {
        const be = liteRTService.getActiveBackend();
        set('accel', be === 'cpu' ? 'warn' : 'ok', be === 'npu' ? 'Running on the NPU' : be === 'gpu' ? 'Running on the GPU' : 'Running on the CPU only');
      } else {
        const g = llmService.getGpuInfo();
        let qualcomm = false;
        try { qualcomm = (await hardwareService.getSoCInfo()).vendor === 'qualcomm'; } catch { /* unknown */ }
        if (qualcomm && /q4_k/i.test(model.fileName || '') && !g.gpu) setFaster('Q4_K GPU acceleration depends on your installed OpenCL runtime; try a Q4_0 build if GPU loading fails.');
        // The NPU runs only Q4_0 / Q8_0 text models: point to the same model in that format.
        let hasNpu = false;
        try { hasNpu = (await hardwareService.getAccelerationCapability()).hasNpu; } catch { /* unknown */ }
        const npuFormat = /(?:^|[-_.])(q4_0|q8_0)(?:[-_.]|$)/i.test(model.fileName || '');
        const fileQuant = (model.fileName || '').match(/(?:^|[-_.])(i?q\d[\w]*?|f16|bf16)(?=\.gguf$|$)/i)?.[1]?.toUpperCase();
        if (hasNpu && !npuFormat && !llmService.supportsVision()) setFaster(`This phone has an NPU, but this file's format${fileQuant ? ` (${fileQuant})` : ''} cannot use it. Download the file ending in Q4_0.gguf (or Q8_0) of the same model to run it on the NPU, usually much faster.`);
        const quant = /q4_k/i.test(model.fileName || '') ? ' Q4_K GPU performance depends on native backend support.' : '';
        const note = llmService.getBackendFallbackNotice();
        if (llmService.isCpuForFileType()) set('accel', 'warn', 'CPU fallback: this model quantization is not eligible for the selected accelerator. OpenCL and Hexagon support different formats.');
        else set('accel', g.gpu ? 'ok' : 'warn', g.gpu ? `GPU (${g.gpuBackend || 'on'}), ${describeOffload(g.gpuLayers, g.totalLayers ?? -1)} on the accelerator.${g.reasonNoGPU ? ` ${g.reasonNoGPU}.` : ''}${quant}` : `CPU only.${note ? ` ${note}` : ' Turn on the GPU in Settings > Text generation.'}${quant}`);
      }

      // 7. Abilities
      const abil: string[] = [];
      if (isLite) { abil.push((model as any).liteRTVision ? 'sees pictures' : 'text only'); }
      else {
        abil.push(llmService.supportsVision() ? 'sees pictures' : 'text only');
        abil.push(llmService.supportsToolCalling() ? 'can use tools (search, files, notes)' : 'no tool use');
        abil.push(llmService.supportsThinking() ? 'can think step by step' : 'no thinking mode');
      }
      set('extras', 'ok', abil.join(' · '));

      const q = estimateReply(model.id, 40);
      const doc = estimateReply(model.id, 3000);
      const timing = q ? `\n\nA normal answer takes about ${fmtSec(q.totalSec)} (first words after ${fmtSec(q.firstWordsSec)}).${doc ? ` With a 6-page document attached, first words come after about ${fmtSec(doc.firstWordsSec)}.` : ''} Thinking makes answers take 2-4 times longer.` : '';
      setVerdict(ok
        ? { good: tps >= 3, text: (tps >= 3 ? 'This model works well on this device.' : 'This model works, but answers will be slow. A smaller model will feel much faster.') + timing }
        : { good: false, text: 'This model had a problem. See the red line above.' });
    } catch (e: any) {
      const m = e?.message || String(e || '');
      if (!force && isOverridableMemoryError(e)) setCanForce(true);
      setSteps((all) => {
        const cur = all.find((s) => s.status === 'run');
        return cur ? all.map((s) => (s === cur ? { ...s, status: 'fail', detail: m || 'Failed' } : s)) : all;
      });
      setVerdict({ good: false, text: m ? `Did not pass: ${m}` : 'Did not pass. See above.' });
    } finally {
      setRunning(false);
    }
  };

  const goBackToPrev = async () => {
    if (!prevId) return;
    try { await activeModelService.unloadTextModel(false); } catch { /* ignore */ }
    useAppStore.getState().setActiveModelId(prevId);
    setPrevId(null);
  };

  const runVulkan = async () => {
    if (!model || vulkanBusy || running || model.engine !== 'llama') return;
    setVulkanBusy(true);
    setVulkanResult('Checking Vulkan GPU availability...');
    try {
      const runtime = await vulkanEngine.runtimeStatus();
      if (runtime.status !== 'ok') throw new Error(describeVulkanStatus(runtime));
      if (llmService.isCurrentlyGenerating()) throw new Error('A chat answer is still running. Stop it before testing Vulkan.');
      // Release llama.rn weights before opening a second native GGUF runtime.
      await activeModelService.unloadTextModel(false);
      const requested = Math.max(1, useAppStore.getState().settings.gpuLayers || 99);
      const started = Date.now();
      const loaded = await vulkanEngine.loadModel(model.filePath, requested, 2048, 0);
      if (!/vulkan/i.test(loaded.backend)) throw new Error(`Model loaded without Vulkan offload (active: ${loaded.backend})`);
      if (loaded.offloadedGpuLayers === 0) throw new Error('Vulkan loaded the model with no GPU layers');
      let output = '';
      const prompt = await vulkanEngine.formatChat([{ role: 'user', content: 'Reply with the word OK.' }]);
      await vulkanEngine.generate(prompt, 24, text => { output += text; });
      const layers = loaded.offloadedGpuLayers > 0
        ? `${describeOffload(loaded.offloadedGpuLayers, loaded.totalLayers)} on the GPU`
        : `${requested} layers requested (model header unreadable, count unconfirmed)`;
      setVulkanResult(`${describeVulkanStatus(runtime)}. Backend: ${loaded.backend}. ${layers}. Load + reply: ${((Date.now() - started) / 1000).toFixed(1)}s. Reply: ${output.trim() || '(empty; check model template)'}`);
    } catch (e: any) {
      setVulkanResult('Vulkan test failed: ' + (e?.message || String(e)));
    } finally {
      try { await vulkanEngine.unload(); } catch { /* missing runtime is reported above */ }
      setVulkanBusy(false);
    }
  };

  const findBest = async () => {
    if (!model || tuneBusy || running || vulkanBusy) return;
    setTuneBusy(true); setTuned(null); setTuneError(null); setTune(null);
    try { setTuned(await tuneDevice(model.id, setTune)); }
    catch (e: any) { setTuneError(e?.message || String(e)); }
    finally { setTuneBusy(false); setTune(null); }
  };

  const icon = (s: Status) => ({ wait: ['circle', colors.textMuted], run: ['loader', colors.primary], ok: ['check-circle', colors.success ?? '#3a9d5d'], warn: ['alert-triangle', '#d4a017'], fail: ['x-circle', colors.error], skip: ['minus-circle', colors.textMuted] } as Record<Status, [string, string]>)[s];
  const card = { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10 };
  const prevName = useAppStore((s) => s.downloadedModels.find((m) => m.id === prevId)?.name);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 6 }}><Icon name="arrow-left" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700', fontFamily: 'serif', marginLeft: 8, flex: 1 }}>Test model</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60, width: '100%', maxWidth: 900, alignSelf: 'center' }}>
        {!model ? <Text style={{ color: colors.textMuted }}>Model not found.</Text> : (
          <>
            <View style={card}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{model.name}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{model.fileName} · {hardwareService.formatModelSize(model)}</Text>
              <Text style={{ color: colors.textSecondary, marginTop: 8 }}>Checks whether this model fits, loads, how fast it writes and reads, and what it can do. Takes about a minute. The model stays loaded afterwards.</Text>
              <TouchableOpacity onPress={() => run()} disabled={running} style={{ marginTop: 12, backgroundColor: running ? colors.border : colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}>
                {running ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{verdict ? 'Test again' : 'Start test'}</Text>}
              </TouchableOpacity>
              {canForce && !running && (
                <TouchableOpacity testID="model-test-load-anyway" onPress={() => run(true)} style={{ marginTop: 10, borderWidth: 1, borderColor: colors.error, borderRadius: 10, paddingVertical: 11, alignItems: 'center' }}>
                  <Text style={{ color: colors.error }}>Load anyway</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>May close other apps or crash if memory runs out</Text>
                </TouchableOpacity>
              )}
            </View>
            {model.engine === 'llama' && (
              <View style={card} testID="model-tune">
                <Text style={{ color: colors.text, fontWeight: '700' }}>Find the best settings</Text>
                <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Loads this model a few ways (automatic GPU or NPU, and the CPU with different thread counts), times a short reply each way and keeps the fastest. Takes a few minutes. Your chat is not touched.</Text>
                <TouchableOpacity onPress={findBest} disabled={running || vulkanBusy || tuneBusy} testID="model-tune-start" style={{ marginTop: 10, backgroundColor: tuneBusy ? colors.border : colors.primary, borderRadius: 10, padding: 11 }}>
                  <Text style={{ color: WHITE, fontWeight: '700', textAlign: 'center' }}>{tuneBusy ? `Trying ${tune?.step ?? 1} of ${tune?.steps ?? '...'}: ${tune?.label ?? ''}` : tuned ? 'Find again' : 'Find the best settings'}</Text>
                </TouchableOpacity>
                {tuneBusy && (
                  <TouchableOpacity onPress={cancelTuning} style={{ marginTop: 8 }} testID="model-tune-cancel"><Text style={{ color: colors.error }}>Stop and keep my settings</Text></TouchableOpacity>
                )}
                {!!tuneError && <Text style={{ color: colors.error, marginTop: 8 }}>{tuneError}</Text>}
                {tuned?.results.map((r) => (
                  <Text key={r.option.id} style={{ color: colors.textSecondary, marginTop: 6 }}>
                    {r.option.label}: {r.error ? `failed (${r.error})` : `${r.tps.toFixed(1)} tok/s, first words after ${r.firstWordSec.toFixed(1)} s`}
                  </Text>
                ))}
                {!!tuned && (
                  <Text style={{ color: colors.text, fontWeight: '600', marginTop: 8 }} testID="model-tune-result">
                    {tuned.best ? `Using ${tuned.best.option.label} (${tuned.best.tps.toFixed(1)} tok/s). Change it any time in Settings, Text generation.` : tuned.cancelled ? 'Stopped. Your settings are unchanged.' : 'None of the options worked, so your settings are unchanged.'}
                  </Text>
                )}
              </View>
            )}
            {model.engine === 'llama' && (
              <View style={card}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Vulkan GPU test</Text>
                <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Loads this model with your accelerator layer limit on the Vulkan engine and reports the layers actually placed on the GPU. This unloads the active text model to save memory.</Text>
                <TouchableOpacity onPress={runVulkan} disabled={running || vulkanBusy} style={{ marginTop: 10, backgroundColor: colors.primary, borderRadius: 10, padding: 11 }}>
                  <Text style={{ color: WHITE, fontWeight: '700', textAlign: 'center' }}>{vulkanBusy ? 'Testing Vulkan...' : 'Test Vulkan GPU'}</Text>
                </TouchableOpacity>
                {!!vulkanResult && <Text style={{ color: colors.textSecondary, marginTop: 8 }}>{vulkanResult}</Text>}
              </View>
            )}
            {steps.map((s) => {
              const [name, color] = icon(s.status);
              return (
                <View key={s.key} style={[card, { flexDirection: 'row' }]}>
                  {s.status === 'run' ? <ActivityIndicator size="small" color={colors.primary} style={{ width: 20 }} /> : <Icon name={name} size={20} color={color} />}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{s.title}</Text>
                    {!!s.detail && <Text style={{ color: colors.textSecondary, marginTop: 3 }}>{s.detail}</Text>}
                  </View>
                </View>
              );
            })}
            {!!verdict && (
              <View style={[card, { borderWidth: 1, borderColor: verdict.good ? (colors.success ?? '#3a9d5d') : ('#d4a017') }]}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{verdict.text}</Text>
                {!!faster && !running && (
                  <TouchableOpacity onPress={() => navigation.navigate('Main', { screen: 'ModelsTab', params: { initialTab: 'text', initialSearchQuery: `${model.name.replace(/[-_. ]?(i?q\d[\w]*|f16|bf16|gguf)$/gi, '').trim()}` } })} style={{ marginTop: 10 }} testID="model-test-find-faster">
                    <Text style={{ color: colors.primary }}>{faster} {/NPU/.test(faster) ? 'Get the NPU version' : 'Find it'}</Text>
                  </TouchableOpacity>
                )}
                {!!verdict && !verdict.good && tps0(verdict) && !running && (
                  <TouchableOpacity onPress={() => navigation.navigate('Main', { screen: 'ModelsTab', params: { initialTab: 'text' } })} style={{ marginTop: 10 }}>
                    <Text style={{ color: colors.primary }}>Browse smaller models</Text>
                  </TouchableOpacity>
                )}
                {!!prevId && !running && (
                  <TouchableOpacity onPress={goBackToPrev} style={{ marginTop: 10 }}>
                    <Text style={{ color: colors.primary }}>Switch back to {prevName || 'the previous model'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

/** Keep the existing navigation route, but route image models to a real image test. */
export const ModelTestScreen: React.FC = () => {
  const route = useRoute<any>();
  const id: string | undefined = route.params?.modelId;
  const imageMatch = useAppStore(s => s.downloadedImageModels.some(m => m.id === id));
  return route.params?.modelType === 'image' || (imageMatch && route.params?.modelType !== 'text')
    ? <ImageModelTestScreen /> : <TextModelTestScreen />;
};
