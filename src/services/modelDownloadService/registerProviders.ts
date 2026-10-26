/**
 * Register the core download providers (text / image / stt) with the single
 * ModelDownloadService. Called once at app boot. The tts and video providers live in pro and
 * register themselves via pro activation.
 */
import { modelDownloadService } from './index';
import { textProvider } from './providers/textProvider';
import { imageProvider } from './providers/imageProvider';
import { sttProvider } from './providers/sttProvider';

let registered = false;

export function registerCoreDownloadProviders(): void {
  if (registered) return;
  registered = true;
  modelDownloadService.register(textProvider);
  modelDownloadService.register(imageProvider);
  modelDownloadService.register(sttProvider);
}
