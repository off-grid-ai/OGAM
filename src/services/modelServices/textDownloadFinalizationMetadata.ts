import { extractQuantization, type PersistedModelDownload } from '@offgrid/models';
import {
  mobileTextDownloadMetadata,
  type MobileTextDownloadMetadata,
} from './modelDownloadRequests';

/** Decode legacy metadata or derive Mobile file facts from Shared's canonical installation identity. */
export function textDownloadFinalizationMetadata(
  record: Readonly<PersistedModelDownload>,
): MobileTextDownloadMetadata | null {
  const legacy = mobileTextDownloadMetadata(
    record.manifest.metadata?.publicMetadataJson,
  );
  if (legacy) return legacy;
  const primary = record.manifest.artifacts.find(
    artifact => artifact.role === 'primary',
  );
  const installation = record.manifest.metadata?.installation;
  if (!primary || !installation) return null;
  const projector = record.manifest.artifacts.find(
    artifact => artifact.role === 'mmproj',
  );
  return {
    owner: 'mobile-text',
    repositoryId: installation.repositoryId,
    file: {
      name: primary.name,
      size: primary.sizeBytes ?? 0,
      quantization: extractQuantization(primary.name),
      downloadUrl: primary.url,
      sha256: primary.sha256,
      ...(projector
        ? {
            mmProjFile: {
              name: projector.name,
              size: projector.sizeBytes ?? 0,
              downloadUrl: projector.url,
              sha256: projector.sha256,
            },
          }
        : {}),
    },
  };
}
