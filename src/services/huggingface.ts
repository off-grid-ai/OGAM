import { HFModelSearchResult, ModelInfo, ModelFile, ModelCredibility } from '../types';
import { HF_API, QUANTIZATION_INFO, LMSTUDIO_AUTHORS, OFFICIAL_MODEL_AUTHORS, VERIFIED_QUANTIZERS } from '../constants';
import { looksLikeVisionModel } from '../utils/visionModel';
import { isMMProjFile } from './mmproj';

class HuggingFaceService {
  private baseUrl = HF_API.baseUrl;
  private apiUrl = HF_API.apiUrl;

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json() as Promise<T>;
  }

  async searchModels(
    query: string = '',
    options: { limit?: number; sort?: string; direction?: string; pipelineTag?: string } = {}
  ): Promise<ModelInfo[]> {
    const { limit = 30, sort = 'downloads', direction = '-1', pipelineTag } = options;
    const params = new URLSearchParams({ filter: 'gguf', sort, direction, limit: limit.toString() });
    if (query) params.append('search', query);
    if (pipelineTag) params.append('pipeline_tag', pipelineTag);
    const results = await this.fetchJson<HFModelSearchResult[]>(`${this.apiUrl}/models?${params.toString()}`);
    return results.map(this.transformModelResult);
  }

  async getModelDetails(modelId: string): Promise<ModelInfo> {
    const result = await this.fetchJson<HFModelSearchResult>(`${this.apiUrl}/models/${modelId}`);
    return this.transformModelResult(result);
  }

  async getModelFiles(modelId: string): Promise<ModelFile[]> {
    try {
      const response = await fetch(`${this.apiUrl}/models/${modelId}/tree/main`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return this.getModelFilesFromSiblings(modelId);
      const files: Array<{ type: string; path: string; size?: number; lfs?: { size: number } }> = await response.json();
      const allGguf = files.filter(f => f.type === 'file' && f.path.endsWith('.gguf'));
      const mmProjFiles = allGguf.filter(f => this.isMMProjFile(f.path));
      const modelFiles = allGguf.filter(f => !this.isMMProjFile(f.path));
      return modelFiles
        .map(file => ({
          name: file.path,
          size: file.lfs?.size || file.size || 0,
          quantization: this.extractQuantization(file.path),
          downloadUrl: this.getDownloadUrl(modelId, file.path),
          mmProjFile: this.findMatchingMMProj(file.path, mmProjFiles, modelId),
        }))
        .sort((a, b) => a.size - b.size);
    } catch {
      return this.getModelFilesFromSiblings(modelId);
    }
  }

  private async getModelFilesFromSiblings(modelId: string): Promise<ModelFile[]> {
    const result = await this.fetchJson<HFModelSearchResult>(`${this.apiUrl}/models/${modelId}`);
    if (!result.siblings) return [];
    const allGguf = result.siblings.filter(f => f.rfilename.endsWith('.gguf'));
    const mmProjFiles = allGguf.filter(f => this.isMMProjFile(f.rfilename));
    const modelFiles = allGguf.filter(f => !this.isMMProjFile(f.rfilename));
    const mmProjForMatch = mmProjFiles.map(f => ({ path: f.rfilename, size: f.size, lfs: f.lfs }));
    return modelFiles
      .map(file => ({ ...this.transformFileInfo(modelId, file), mmProjFile: this.findMatchingMMProj(file.rfilename, mmProjForMatch, modelId) }))
      .sort((a, b) => a.size - b.size);
  }

  getDownloadUrl(modelId: string, fileName: string, revision: string = 'main'): string {
    return `${this.baseUrl}/${modelId}/resolve/${revision}/${fileName}`;
  }

  private determineCredibility(author: string): ModelCredibility {
    if (LMSTUDIO_AUTHORS.includes(author))
      return { source: 'lmstudio', isOfficial: false, isVerifiedQuantizer: true, verifiedBy: 'LM Studio' };
    if (OFFICIAL_MODEL_AUTHORS[author])
      return { source: 'official', isOfficial: true, isVerifiedQuantizer: false, verifiedBy: OFFICIAL_MODEL_AUTHORS[author] };
    if (VERIFIED_QUANTIZERS[author])
      return { source: 'verified-quantizer', isOfficial: false, isVerifiedQuantizer: true, verifiedBy: VERIFIED_QUANTIZERS[author] };
    return { source: 'community', isOfficial: false, isVerifiedQuantizer: false };
  }

  private transformModelResult = (result: HFModelSearchResult): ModelInfo => {
    const files = result.siblings
      ?.filter(file => file.rfilename.endsWith('.gguf'))
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

  private transformFileInfo(modelId: string, file: { rfilename: string; size?: number; lfs?: { size: number; sha256: string } }): ModelFile {
    const fileName = file.rfilename;
    const size = file.lfs?.size || file.size || 0;
    const quantization = this.extractQuantization(fileName);

    return {
      name: fileName,
      size,
      quantization,
      downloadUrl: this.getDownloadUrl(modelId, fileName),
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

  // Delegates to the single source of truth (src/services/mmproj.ts) so "is this a projector" is defined once.
  private isMMProjFile(fileName: string): boolean {
    return isMMProjFile(fileName);
  }

  private findMatchingMMProj(
    modelFileName: string,
    mmProjFiles: Array<{ path: string; size?: number; lfs?: { size: number } }>,
    modelId: string
  ): { name: string; size: number; downloadUrl: string } | undefined {
    if (mmProjFiles.length === 0) {
      return undefined;
    }

    const toResult = (f: { path: string; size?: number; lfs?: { size: number } }) => ({
      name: f.path,
      size: f.lfs?.size || f.size || 0,
      downloadUrl: this.getDownloadUrl(modelId, f.path),
    });

    // Exact symmetric match: model quant === mmproj quant
    const modelQuant = this.extractQuantization(modelFileName);
    if (modelQuant !== 'Unknown') {
      const exactMatch = mmProjFiles.find(f => this.extractQuantization(f.path) === modelQuant);
      if (exactMatch) return toResult(exactMatch);
    }

    // Fallback: prefer F16/FP16, exclude BF16 (can be incompatible with some runtimes)
    const f16 = mmProjFiles.find(f => {
      const lower = f.path.toLowerCase();
      return (lower.includes('f16') || lower.includes('fp16')) && !lower.includes('bf16');
    });

    return toResult(f16 ?? mmProjFiles[0]);
  }

  private detectModelType(name: string, tags: string[]): string {
    if (tags.some(t => t.includes('code')) || name.includes('code') || name.includes('coder'))
      return 'Code generation';
    // Single source of truth (utils/visionModel) — was a 3-keyword subset that missed Pixtral/
    // Moondream/InternVL etc. (DR2).
    if (looksLikeVisionModel({ name, tags }))
      return 'Vision';
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
    const licenseStr = license ? license.toUpperCase().replaceAll('-', ' ') : null;
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
    return QUANTIZATION_INFO[quantization] || {
      bitsPerWeight: 4.5,
      quality: 'Unknown',
      description: 'Unknown quantization level',
      recommended: false,
    };
  }

}

export const huggingFaceService = new HuggingFaceService();
