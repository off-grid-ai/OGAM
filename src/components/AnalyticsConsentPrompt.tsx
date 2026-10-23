import React from 'react';
import { CenteredAlert } from './CenteredAlert';
import {
  closeConsentPrompt,
  useConsentPromptStore,
} from '../services/analytics/consentPrompt';
import { setAnalyticsConsent } from '../services/analytics/analytics';

const COPY = {
  failure: { title: 'Help us fix this?', source: 'failure_prompt' },
  first_chat: { title: 'Help us fix what breaks', source: 'first_chat_prompt' },
} as const;

const BODY = 'Send anonymous crash reports and usage. Your chats stay on this device.';

/** The one consent prompt shown outside Auto Setup. Mounted once at the app root. */
export const AnalyticsConsentPrompt: React.FC = () => {
  const kind = useConsentPromptStore(s => s.kind);
  if (!kind) return null;
  const copy = COPY[kind];
  return (
    <CenteredAlert
      visible
      title={copy.title}
      message={BODY}
      onClose={closeConsentPrompt}
      buttons={[
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Share',
          style: 'default',
          onPress: () => {
            setAnalyticsConsent({ usage: true, crashes: true }, copy.source);
          },
        },
      ]}
    />
  );
};
