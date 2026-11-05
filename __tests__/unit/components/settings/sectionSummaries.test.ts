import { Platform } from 'react-native';
import { renderHook, act } from '@testing-library/react-native';
import { resetStores } from '../../../utils/testHelpers';
import { createDownloadedModel } from '../../../utils/factories';
import { useAppStore } from '../../../../src/stores/appStore';
import { useSectionSummaries } from '../../../../src/components/settings/sectionSummaries';

const summaries = () => renderHook(() => useSectionSummaries()).result.current;
const settings = (patch: Record<string, unknown>) =>
  act(() => {
    useAppStore.getState().updateSettings(patch as never);
  });

describe('useSectionSummaries: what a closed settings section shows', () => {
  const os = Platform.OS;
  beforeEach(() => resetStores());
  afterEach(() => {
    Platform.OS = os;
  });

  it('shows the llama text values: temperature, context and tokens', () => {
    settings({ temperature: 0.7, contextLength: 4096, maxTokens: 1024 });
    expect(summaries().text).toMatch(/^Temperature 0\.70 · .+ context · .+ tokens$/);
  });

  it('shows only temperature and tokens for a LiteRT model, and its own hardware', () => {
    act(() => {
      useAppStore.setState({
        downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' } as never)],
        activeModelId: 'lrt',
      });
    });
    settings({ liteRTBackend: 'cpu' });
    const s = summaries();
    expect(s.text).toMatch(/^Temperature .+ · .+ tokens$/);
    expect(s.text).not.toMatch(/context/);
    expect(s.general).toBe('CPU · Balanced loading');
    settings({ liteRTBackend: 'gpu' });
    expect(summaries().general).toBe('GPU · Balanced loading');
  });

  it.each([
    ['metal', 'GPU'],
    ['opencl', 'GPU'],
    ['htp', 'NPU'],
    ['cpu', 'CPU'],
    ['something-new', 'CPU'],
  ])('names %s hardware as %s', (backend, label) => {
    settings({ inferenceBackend: backend });
    expect(summaries().general).toBe(`${label} · Balanced loading`);
  });

  it('falls back to the platform default hardware when none is chosen', () => {
    settings({ inferenceBackend: undefined });
    Platform.OS = 'ios';
    expect(summaries().general).toBe('GPU · Balanced loading');
    Platform.OS = 'android';
    expect(summaries().general).toBe('CPU · Balanced loading');
  });

  it('names the loading mode, and reads the old aggressive flag when no mode is set', () => {
    settings({ inferenceBackend: 'cpu', modelLoadingMode: 'conservative' });
    expect(summaries().general).toBe('CPU · Lean loading');
    settings({ modelLoadingMode: 'aggressive' });
    expect(summaries().general).toBe('CPU · Aggressive loading');
    settings({ modelLoadingMode: undefined, aggressiveModelLoading: true });
    expect(summaries().general).toBe('CPU · Aggressive loading');
    settings({ aggressiveModelLoading: false });
    expect(summaries().general).toBe('CPU · Balanced loading');
  });

  it('shows the first line of the system prompt', () => {
    settings({ systemPrompt: '  Be brief.\nAnswer in French.' });
    expect(summaries().prompt).toBe('Be brief.');
  });

  it.each([[''], ['   '], [undefined]])('says "Built-in prompt" when the prompt is %p, since chat sends the built-in one', value => {
    settings({ systemPrompt: value });
    expect(summaries().prompt).toBe('Built-in prompt');
  });

  it('names the transcription model, or says none is set', () => {
    expect(typeof summaries().transcription).toBe('string');
    expect(summaries().transcription.length).toBeGreaterThan(0);
  });

  it('shows the image steps, guidance and size', () => {
    expect(summaries().image).toMatch(/^\d+ steps · guidance [\d.]+ · \d+px$/);
  });
});
