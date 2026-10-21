import React from 'react';
import { MOBILE_MTP_DRAFT_TOKENS } from '@offgrid/models';
import { useAppStore } from '../../stores';
import { SliderSetting } from '../SliderSetting';
import { SegmentedRow, BOOL_OPTIONS } from './segmentedRow';
import { MtpHeadDownload } from './MtpHeadDownload';

/**
 * MTP speculative decoding. The model drafts several tokens per step and verifies them in a single
 * pass, so a turn finishes in fewer forward passes — the win is wall-clock, not quality: verified
 * tokens are exactly the tokens the model would have produced anyway.
 *
 * Only models shipped with MTP draft layers (or a downloaded MTP head) can do it. It stays off by
 * default: llama.rn reprocesses the whole prompt each turn while MTP shares the KV cache, so the
 * first token gets slower on long chats. Turned on, the draft length is the one other lever.
 */
export const SpeculativeDecodingToggle: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  return (
    <>
      <SegmentedRow<'off' | 'on'>
        label="Speculative Decoding (MTP)"
        description="Drafts several tokens per step and checks them together. Faster on models built with MTP layers; no effect on others. Requires model reload."
        options={BOOL_OPTIONS}
        current={settings.speculativeDecoding ? 'on' : 'off'}
        onSelect={(id) => updateSettings({ speculativeDecoding: id === 'on' })}
        testIdFor={(id) => `speculative-${id}-button`}
      />
      {settings.speculativeDecoding ? (
        <SliderSetting
          testID="speculative-draft-stepper"
          label="Draft Tokens"
          value={settings.speculativeDraftMax || MOBILE_MTP_DRAFT_TOKENS}
          min={1} max={8} step={1}
          onChange={(v) => updateSettings({ speculativeDraftMax: v })}
        />
      ) : null}
      <MtpHeadDownload />
    </>
  );
};
