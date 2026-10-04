import RNFS from 'react-native-fs';
import type { TextLoadAdmissionService } from '@offgrid/models';
import { hardwareService } from './hardware';
import { statFile } from '../utils/fileStat';
import { validateModelFile } from './llmSafetyChecks';
import logger from '../utils/logger';

/** Filesystem, validation, and memory facts for text-load admission. Shared decides. */
export function mobileTextLoadAdmissionPorts(): ConstructorParameters<typeof TextLoadAdmissionService>[0] {
  return {
    exists: path => RNFS.exists(path),
    validate: path => validateModelFile(path),
    size: async path => (await statFile(path))?.size ?? 0,
    memory: async () => {
      const snapshot = await hardwareService.getAppMemoryUsage();
      return { availableBytes: snapshot.available, totalBytes: snapshot.total };
    },
    report: (event, detail) => logger.log(`[LLM][ADMISSION] ${event}`, detail ?? ''),
  };
}
