import { useEffect, useState } from 'react';
import { embeddingProvider } from '../../services/modelDownloadService/providers/embeddingProvider';
import type { DownloadItem } from './items';

/** Search (embedding) models as Download Manager rows, from their provider. */
export function useSearchDownloadItems(): DownloadItem[] {
  const [searchItems, setSearchItems] = useState<DownloadItem[]>([]);
  useEffect(() => {
    let current = true;
    const refresh = () => {
      embeddingProvider
        .list()
        .then(rows => {
          if (!current) return;
          setSearchItems(
            rows.map(row => ({
              type: row.status === 'completed' ? ('completed' as const) : ('active' as const),
              modelType: 'embedding' as const,
              modelId: row.id.replace(/^embedding:/, ''),
              fileName: row.name,
              name: row.name,
              author: '',
              quantization: '',
              fileSize: row.sizeBytes,
              bytesDownloaded: row.bytesDownloaded,
              progress: row.progress,
              status: row.status === 'downloading' ? 'running' : row.status === 'error' ? 'failed' : 'completed',
              reason: row.error,
            })),
          );
        })
        .catch(() => undefined);
    };
    refresh();
    const unsubscribe = embeddingProvider.subscribe(refresh);
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  return searchItems;
}
