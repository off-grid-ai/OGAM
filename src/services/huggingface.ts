import { huggingFaceRepositoryQuery, isGgufFile } from '@offgrid/models';
import {
  HFModelSearchResult,
  ModelInfo,
  ModelFile,
  ModelCredibility,
} from '../types';
import {
  HF_API,
  LMSTUDIO_AUTHORS,
  OFFICIAL_MODEL_AUTHORS,
  VERIFIED_QUANTIZERS,
} from '../constants';
import { looksLikeVisionModel } from '../utils/visionModel';
import { huggingFaceRevisionPath } from '../utils/modelOrigin';
import {
  QUANTIZATION_INFO,
  isAuxiliaryModelFile,
  isModelProjectorFile as isMMProjFile,
  pickProjectorForDownload as pickMmProjForDownload,
} from '@offgrid/models';

class HuggingFaceService {
  private baseUrl = HF_API.baseUrl;
  private apiUrl = HF_API.apiUrl;

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json() as Promise<T>;
  }

  async searchModels(
    query: string = '',
    options: {
      limit?: number;
      sort?: string;
      direction?: string;
      pipelineTag?: string;
    } = {},
  ): Promise<ModelInfo[]> {
    const {
      limit = 30,
      sort = 'downloads',
      direction = '-1',
      pipelineTag,
    } = options;
    const params = new URLSearchParams({
      filter: 'gguf',
      sort,
      direction,
      limit: limit.toString(),
    });
    if (query) params.append('search', query);
    if (pipelineTag) params.append('pipeline_tag', pipelineTag);
    const results = await this.fetchJson<HFModelSearchResult[]>(
      `${this.apiUrl}/models?${params.toString()}`,
    );
    return results.map(this.transformModelResult);
  }

  /**
   * Repos that publish a file of this name, each reduced to its file list with exact byte sizes.
   *
   * This is a CANDIDATE generator, not an identification: several repos publish the same file
   * name (`SmolVLM-500M-Instruct-GGUF` matches three, one an `i1` requantisation). The caller
   * decides which is ours by comparing sizes - see resolveVisionRepairSource.
   */
  async findReposPublishing(
    fileName: string,
    limit = 10,
  ): Promise<
    { repoId: string; files: { name: string; sizeBytes?: number }[] }[]
  > {
    // The repo is usually named after the model, so the file name minus its quant/extension is the
    // best query we have. `.gguf` and the trailing quant tag never appear in a repo id.
    const query = huggingFaceRepositoryQuery(fileName);
    const results = await this.searchModels(query, { limit });
    const listings = await Promise.all(
      results.map(async result => ({
        repoId: result.id,
        files: await this.listRepoFileSizes(result.id),
      })),
    );
    return listings.filter(listing => listing.files.length > 0);
  }

  /** Every file in a repo with its exact size - the only field that identifies a build. */
  private async listRepoFileSizes(
    modelId: string,
  ): Promise<{ name: string; sizeBytes?: number }[]> {
    try {
      const result = await this.fetchJson<{
        siblings?: {
          rfilename: string;
          size?: number;
          lfs?: { size?: number };
        }[];
      }>(`${this.apiUrl}/models/${modelId}?blobs=true`);
      return (result.siblings ?? []).map(sibling => ({
        name: sibling.rfilename,
        sizeBytes: sibling.lfs?.size ?? sibling.size,
      }));
    } catch {
      // An unreachable or private repo is simply not a candidate. HF answers an unknown repo with
      // 401, so a throw here means "cannot confirm", never "this is the one".
      return [];
    }
  }

  async getModelDetails(modelId: string): Promise<ModelInfo> {
    const result = await this.fetchJson<HFModelSearchResult>(
      `${this.apiUrl}/models/${modelId}`,
    );
    return this.transformModelResult(result);
  }

  async getModelFiles(
    modelId: string,
    revision = 'main',
  ): Promise<ModelFile[]> {
    try {
      const encodedRevision = encodeURIComponent(revision);
      const response = await fetch(
        `${this.apiUrl}/models/${modelId}/tree/${encodedRevision}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!response.ok)
        return this.getModelFilesFromSiblings(modelId, revision);
      const files: Array<{
        type: string;
        path: string;
        size?: number;
        lfs?: { size: number };
      }> = await response.json();
      const allGguf = files.filter(
        f => f.type === 'file' && isGgufFile(f.path),
      );
      const mmProjFiles = allGguf.filter(f => this.isMMProjFile(f.path));
      const modelFiles = allGguf.filter(
        f => !this.isMMProjFile(f.path) && !isAuxiliaryModelFile(f.path),
      );
      return modelFiles
        .map(file => ({
          name: file.path,
          size: file.lfs?.size || file.size || 0,
          quantization: this.extractQuantization(file.path),
          downloadUrl: this.getDownloadUrl(modelId, file.path, revision),
          mmProjFile: this.findMatchingMMProj(file.path, mmProjFiles, {
            modelId,
            revision,
          }),
        }))
        .sort((a, b) => a.size - b.size);
    } catch {
      return this.getModelFilesFromSiblings(modelId, revision);
    }
  }

  private async getModelFilesFromSiblings(
    modelId: string,
    revision = 'main',
  ): Promise<ModelFile[]> {
    const revisionPath =
      revision === 'main' ? '' : `/revision/${encodeURIComponent(revision)}`;
    const result = await this.fetchJson<HFModelSearchResult>(
      `${this.apiUrl}/models/${modelId}${revisionPath}`,
    );
    if (!result.siblings) return [];
    const allGguf = result.siblings.filter(f => isGgufFile(f.rfilename));
    const mmProjFiles = allGguf.filter(f => this.isMMProjFile(f.rfilename));
    const modelFiles = allGguf.filter(
      f => !this.isMMProjFile(f.rfilename) && !isAuxiliaryModelFile(f.rfilename),
    );
    const mmProjForMatch = mmProjFiles.map(f => ({
      path: f.rfilename,
      size: f.size,
      lfs: f.lfs,
    }));
    return modelFiles
      .map(file => ({
        ...this.transformFileInfo(modelId, file, revision),
        mmProjFile: this.findMatchingMMProj(file.rfilename, mmProjForMatch, {
          modelId,
          revision,
        }),
      }))
      .sort((a, b) => a.size - b.size);
  }

  getDownloadUrl(
    modelId: string,
    fileName: string,
    revision: string = 'main',
  ): string {
    return `${this.baseUrl}/${modelId}/resolve/${huggingFaceRevisionPath(
      revision,
    )}/${fileName}`;
  }

  private determineCredibility(author: string): ModelCredibility {
    if (LMSTUDIO_AUTHORS.includes(author))
      return {
        source: 'lmstudio',
        isOfficial: false,
        isVerifiedQuantizer: true,
        verifiedBy: 'LM Studio',
      };
    if (OFFICIAL_MODEL_AUTHORS[author])
      return {
        source: 'official',
        isOfficial: true,
        isVerifiedQuantizer: false,
        verifiedBy: OFFICIAL_MODEL_AUTHORS[author],
      };
    if (VERIFIED_QUANTIZERS[author])
      return {
        source: 'verified-quantizer',
        isOfficial: false,
        isVerifiedQuantizer: true,
        verifiedBy: VERIFIED_QUANTIZERS[author],
      };
    return {
      source: 'community',
      isOfficial: false,
      isVerifiedQuantizer: false,
    };
  }

  private transformModelResult = (result: HFModelSearchResult): ModelInfo => {
    const files =
      result.siblings
        ?.filter(file => isGgufFile(file.rfilename))
        .map(file => this.transformFileInfo(result.id, file)) || [];

    const author = result.author || result.id.split('/')[0] || 'Unknown';
    const credibility = this.determineCredibility(author);

    return {
      id: result.id,
      name: result.id.split('/').pop() || result.id,
      author,
      description: this.extractDescription(result),
      downloads: result.downloads || 0,
      likes: result.likes || 0,
      tags: result.tags || [],
      lastModified: result.lastModified,
      files,
      credibility,
    };
  };

  private transformFileInfo(
    modelId: string,
    file: {
      rfilename: string;
      size?: number;
      lfs?: { size: number; sha256: string };
    },
    revision = 'main',
  ): ModelFile {
    const fileName = file.rfilename;
    const size = file.lfs?.size || file.size || 0;
    const quantization = this.extractQuantization(fileName);

    return {
      name: fileName,
      size,
      quantization,
      downloadUrl: this.getDownloadUrl(modelId, fileName, revision),
      sha256: file.lfs?.sha256,
    };
  }

  private extractQuantization(fileName: string): string {
    const upperName = fileName.toUpperCase();

    // Check for known quantization patterns
    for (const quant of Object.keys(QUANTIZATION_INFO)) {
      if (upperName.includes(quant.replace('_', ''))) {
        return quant;
      }
      if (upperName.includes(quant)) {
        return quant;
      }
    }

    // Try to extract with regex
    const match = fileName.match(/[QqFf]\d+[_]?[KkMmSs]*/);
    if (match) {
      return match[0].toUpperCase();
    }

    return 'Unknown';
  }

  // Delegates to the shared projector policy so "is this a projector" is defined once.
  private isMMProjFile(fileName: string): boolean {
    return isMMProjFile(fileName);
  }

  // Routes through the shared projector-rule owner. Quant is NOT a matching
  // signal (one projector serves every quant of its model); a projector whose filename names a DIFFERENT
  // model+variant is the wrong architecture and is REFUSED, so the model downloads with its correct
  // projector or text-only rather than being mispaired (#510). See pickMmProjForDownload for the rule.
  private findMatchingMMProj(
    modelFileName: string,
    mmProjFiles: Array<{ path: string; size?: number; lfs?: { size: number } }>,
    source: string | { modelId: string; revision: string },
  ): { name: string; size: number; downloadUrl: string } | undefined {
    const chosen = pickMmProjForDownload(
      modelFileName,
      mmProjFiles.map(f => f.path),
    );
    if (!chosen) return undefined;

    const file = mmProjFiles.find(f => f.path === chosen);
    if (!file) return undefined;
    const modelId = typeof source === 'string' ? source : source.modelId;
    const revision = typeof source === 'string' ? 'main' : source.revision;
    return {
      name: file.path,
      size: file.lfs?.size || file.size || 0,
      downloadUrl: this.getDownloadUrl(modelId, file.path, revision),
    };
  }

  private detectModelType(name: string, tags: string[]): string {
    if (
      tags.some(t => t.includes('code')) ||
      name.includes('code') ||
      name.includes('coder')
    )
      return 'Code generation';
    // Single source of truth (utils/visionModel) — was a 3-keyword subset that missed Pixtral/
    // Moondream/InternVL etc. (DR2).
    if (looksLikeVisionModel({ name, tags })) return 'Vision';
    return 'Text generation';
  }

  private extractDescription(result: HFModelSearchResult): string {
    const name = (result.id.split('/').pop() || '').toLowerCase();
    const tags = result.tags?.map(t => t.toLowerCase()) || [];
    const author = result.author || result.id.split('/')[0] || '';
    const type = this.detectModelType(name, tags);
    const paramMatch = name.match(/(\d+\.?\d*)\s*b(?:\b|-)/);
    const paramStr = paramMatch ? `${paramMatch[1]}B` : null;
    const license = result.cardData?.license;
    const licenseStr = license
      ? license.toUpperCase().replaceAll('-', ' ')
      : null;
    const parts: string[] = [type];
    if (paramStr) parts.push(paramStr);
    if (licenseStr) parts.push(licenseStr);
    if (author) parts.push(`by ${author}`);
    return parts.join(' · ');
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }

  getQuantizationInfo(quantization: string) {
    return (
      QUANTIZATION_INFO[quantization] || {
        bitsPerWeight: 4.5,
        quality: 'Unknown',
        description: 'Unknown quantization level',
        recommended: false,
      }
    );
  }
}

export const huggingFaceService = new HuggingFaceService();
