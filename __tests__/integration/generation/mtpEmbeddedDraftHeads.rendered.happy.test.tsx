import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('embedded Multi-Token Prediction journey', () => {
  it('uses embedded MTP heads for chat when the experiment is enabled', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true, llamaMtpLayers: 3 },
      persistedAppState: {
        settings: { showGenerationDetails: true, experimentalMtp: true },
      },
    });

    boundary.llama!.scriptCompletion({
      text: 'MTP is active for this model.',
      completionMeta: {
        draft_tokens: 8,
        draft_tokens_accepted: 5,
      },
    });
    await openChatWithJourneyModel(rtl, view);
    sendChatMessage(rtl, view, 'Explain MTP briefly');

    await rtl.waitFor(() => {
      expect(view.getByText('MTP is active for this model.')).toBeTruthy();
      expect(view.getByText('MTP 5/8 accepted')).toBeTruthy();
    });
    expect(boundary.llama!.calls.completion[0][0]).toEqual(
      expect.objectContaining({
        speculative: { type: 'draft-mtp', n_max: 2 },
      }),
    );
  });

  it('keeps experimental MTP off by default', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true, llamaMtpLayers: 3 },
      persistedAppState: {
        settings: { showGenerationDetails: true },
      },
    });
    boundary.llama!.scriptCompletion({
      text: 'Standard decoding still works.',
    });

    await openChatWithJourneyModel(rtl, view);
    sendChatMessage(rtl, view, 'Say hello');

    await rtl.waitFor(() => {
      expect(view.getByText('Standard decoding still works.')).toBeTruthy();
      expect(view.queryByText(/^MTP /)).toBeNull();
    });
  });

  it('keeps standard decoding for an ordinary GGUF when the experiment is enabled', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true, llamaMtpLayers: 0 },
      persistedAppState: {
        settings: { showGenerationDetails: true, experimentalMtp: true },
      },
    });
    boundary.llama!.scriptCompletion({
      text: 'This ordinary model uses standard decoding.',
    });

    await openChatWithJourneyModel(rtl, view);
    sendChatMessage(rtl, view, 'Use the supported decoding path');

    await rtl.waitFor(() => {
      expect(
        view.getByText('This ordinary model uses standard decoding.'),
      ).toBeTruthy();
      expect(view.queryByText(/^MTP /)).toBeNull();
    });
    expect(boundary.llama!.calls.completion[0][0]).not.toHaveProperty(
      'speculative',
    );
  });

  it('retries once with standard decoding when the runtime rejects MTP', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true, llamaMtpLayers: 3 },
      persistedAppState: {
        settings: { showGenerationDetails: true, experimentalMtp: true },
      },
    });
    boundary.llama!.scriptCompletion({ text: 'The safe fallback completed.' });
    boundary.llama!.scriptMtpFailure();

    await openChatWithJourneyModel(rtl, view);
    sendChatMessage(rtl, view, 'Continue even if MTP is unavailable');

    await rtl.waitFor(() => {
      expect(view.getAllByText('The safe fallback completed.')).toHaveLength(1);
      expect(view.queryByText(/^MTP /)).toBeNull();
    });
    expect(boundary.llama!.calls.completion).toHaveLength(2);
    expect(boundary.llama!.calls.completion[1][0]).toEqual(
      expect.objectContaining({ speculative: false }),
    );
  });
});
