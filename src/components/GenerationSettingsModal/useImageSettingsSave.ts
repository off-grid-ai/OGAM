import React, { useRef, useState } from 'react';
import {
  Text,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import {
  modelsFailureMessage,
  type ModelSettingsRecord,
} from '@offgrid/application';
import { applicationFacade } from '../../services/applicationFacade';

export interface ImageSettingsSaveNotice {
  message: string;
  warning: boolean;
}

export interface ImageSettingsSaveState {
  pending: boolean;
  notice: ImageSettingsSaveNotice | null;
  save: (patch: ModelSettingsRecord) => Promise<void>;
}

/** One local-origin command lifecycle for image settings on either modal section. */
export function useImageSettingsSave(): ImageSettingsSaveState {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ImageSettingsSaveNotice | null>(null);
  const pendingRef = useRef(false);
  const save = async (patch: ModelSettingsRecord): Promise<void> => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setNotice(null);
    try {
      const outcome = await applicationFacade().models.settings.save({ origin: 'local', patch });
      if (!outcome.ok) {
        setNotice({ message: modelsFailureMessage(outcome.failure), warning: false });
      } else if (outcome.value.syncFailure) {
        setNotice({
          message: `Saved on this device. ${modelsFailureMessage(outcome.value.syncFailure)}`,
          warning: true,
        });
      }
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : String(error), warning: false });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return { pending, notice, save };
}

export function ImageSettingsSaveNoticeText(props: {
  pending: boolean;
  notice: ImageSettingsSaveNotice | null;
  warningStyle: StyleProp<TextStyle>;
  errorStyle: StyleProp<TextStyle>;
}): React.ReactElement | null {
  if (!props.pending && !props.notice) return null;
  return React.createElement(
    Text,
    {
      style: props.notice?.warning === false ? props.errorStyle : props.warningStyle,
      accessibilityLiveRegion: 'polite',
    },
    props.pending ? 'Saving settings...' : props.notice?.message,
  );
}
