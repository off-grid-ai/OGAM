import { useEffect, useState } from 'react';
import { CATALOG, mtpHeadForPrimaryFile, parseMoeParams } from '@offgrid/models';
import { modelSupportsMtp } from '../../services/mtpDetection';
import logger from '../../utils/logger';
import type { DownloadedModel } from '../../types';
import type { ModelCardCapabilities } from '../ModelCardContent';

type SpeedBadges = Pick<ModelCardCapabilities, 'moeActiveB' | 'mtp'>;

/** A downloaded model's active size: the catalog's for its repo, else read from an "A3B" name. */
function moeActiveB(model: DownloadedModel): number | undefined {
  const repo = model.id.split('/').slice(0, 2).join('/');
  return CATALOG.find(entry => entry.id === repo)?.activeParams
    ?? parseMoeParams(model.name)?.activeParams
    ?? parseMoeParams(model.fileName)?.activeParams;
}

/**
 * The MoE and MTP badges for downloaded chat models. MTP is what the engine will use: draft layers the
 * file declares in its header (read once and cached, as the "reply faster" card does), or a published
 * MTP head for this file.
 */
export function useDownloadedSpeedBadges(models: readonly DownloadedModel[]): Record<string, SpeedBadges> {
  const [badges, setBadges] = useState<Record<string, SpeedBadges>>({});
  useEffect(() => {
    let current = true;
    Promise.all(models.map(async model => {
      const mtp = model.engine === 'llama'
        && (!!mtpHeadForPrimaryFile(model.fileName) || await modelSupportsMtp(model.filePath));
      const active = moeActiveB(model);
      return [model.id, { ...(active ? { moeActiveB: active } : {}), ...(mtp ? { mtp: true } : {}) }] as const;
    })).then(entries => {
      if (current) setBadges(Object.fromEntries(entries));
    }).catch(error => {
      // Badges only add information: a header that cannot be read leaves the rows without them.
      logger.warn('[ModelSelector] could not read speed badges:', error);
    });
    return () => { current = false; };
  }, [models]);
  return badges;
}
