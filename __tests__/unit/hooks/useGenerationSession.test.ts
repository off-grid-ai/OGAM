/**
 * useGeneratingConversationId — the reactive View projection of the GenerationSession
 * owner (slice 1). The View reads this via useSyncExternalStore and never writes the
 * session; this verifies begin/end/switch re-render the projection so the screen's
 * isGeneratingForThisConversation stays in sync without the old multi-writer ref.
 */
import { renderHook, act } from '@testing-library/react-native';
import { generationSession } from '../../../src/services/generationSession';
import { useGeneratingConversationId } from '../../../src/hooks/useGenerationSession';

jest.mock('../../../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

beforeEach(() => generationSession._reset());

describe('useGeneratingConversationId', () => {
  it('reflects begin / switch / end reactively', () => {
    const { result } = renderHook(() => useGeneratingConversationId());
    expect(result.current).toBeNull();

    act(() => { generationSession.begin('c1'); });
    expect(result.current).toBe('c1');

    act(() => { generationSession.begin('c2'); }); // switch owner
    expect(result.current).toBe('c2');

    act(() => { generationSession.end('done'); });
    expect(result.current).toBeNull();
  });

  it('does not re-render for an idempotent begin (same conversation)', () => {
    let renders = 0;
    const { result } = renderHook(() => { renders++; return useGeneratingConversationId(); });
    const baseline = renders;
    act(() => { generationSession.begin('c1'); });
    act(() => { generationSession.begin('c1'); }); // no-op — no notify
    expect(result.current).toBe('c1');
    expect(renders).toBe(baseline + 1); // exactly one re-render, not two
  });
});
