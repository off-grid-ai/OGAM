import { HFModelSearchResult, ModelInfo, ModelFile, ModelCredibility } from '../types';
import { HF_API, QUANTIZATION_INFO, LMSTUDIO_AUTHORS, OFFICIAL_MODEL_AUTHORS, VERIFIED_QUANTIZERS } from '../constants';

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

  private transformFileInfo(modelId: string, file: { rfilename: string; size?: number; lfs?: { size: number } }): ModelFile {
    const fileName = file.rfilename;
    const size = file.lfs?.size || file.size || 0;
    const quantization = this.extractQuantization(fileName);

    return {
      name: fileName,
      size,
      quantization,
      downloadUrl: this.getDownloadUrl(modelId, fileName),
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

  private isMMProjFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return lower.includes('mmproj') ||
           lower.includes('projector') ||
           (lower.includes('clip') && lower.endsWith('.gguf'));
  }

  private findMatchingMMProj(
    modelFileName: string,
    mmProjFiles: Array<{ path: string; size?: number; lfs?: { size: number } }>,
    modelId: string
  ): { name: string; size: number; downloadUrl: string } | undefined {
    if (mmProjFiles.length === 0) {
      return undefined;
    }

    // modelQuant intentionally unused; matching is done via modelLower below
    const modelLower = modelFileName.toLowerCase();

    // Try to match by quantization level
    for (const mmProj of mmProjFiles) {
      const mmProjQuant = this.extractQuantization(mmProj.path);
      // Match exact quantization or if model uses the mmproj's quantization variant
      if (mmProjQuant !== 'Unknown' && modelLower.includes(mmProjQuant.toLowerCase())) {
        return {
          name: mmProj.path,
          size: mmProj.lfs?.size || mmProj.size || 0,
          downloadUrl: this.getDownloadUrl(modelId, mmProj.path),
        };
      }
    }

    // Fallback: prefer f16 mmproj if available, otherwise use the first one
    // Match F16/FP16 but exclude BF16 — BF16 mmproj can be incompatible with some runtimes
    const f16MMProj = mmProjFiles.find(f => {
      const lower = f.path.toLowerCase();
      return (lower.includes('f16') || lower.includes('fp16')) && !lower.includes('bf16');
    });

    const selectedMMProj = f16MMProj || mmProjFiles[0];
    return {
      name: selectedMMProj.path,
      size: selectedMMProj.lfs?.size || selectedMMProj.size || 0,
      downloadUrl: this.getDownloadUrl(modelId, selectedMMProj.path),
    };
  }

  private detectModelType(name: string, tags: string[]): string {
    if (tags.some(t => t.includes('code')) || name.includes('code') || name.includes('coder'))
      return 'Code generation';
    if (tags.some(t => t.includes('vision') || t.includes('multimodal') || t.includes('image-text'))
      || name.includes('vision') || name.includes('vlm') || name.includes('llava'))
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

  /** Search HuggingFace for Whisper/ASR models (returns repos that may contain ggml .bin files). */
  async searchWhisperRepos(query: string, limit = 20): Promise<Array<{ id: string; author: string; downloads: number; lastModified?: string }>> {
    const params = new URLSearchParams({
      search: query || 'whisper',
      pipeline_tag: 'automatic-speech-recognition',
      sort: 'downloads',
      direction: '-1',
      limit: limit.toString(),
    });
    try {
      const results = await this.fetchJson<HFModelSearchResult[]>(`${this.apiUrl}/models?${params.toString()}`);
      return results.map(r => ({
        id: r.id,
        author: r.author || r.id.split('/')[0] || '',
        downloads: r.downloads || 0,
        lastModified: r.lastModified,
      }));
    } catch {
      return [];
    }
  }

  /** Fetch ggml-compatible .bin files from any HuggingFace model repo tree. */
  async getWhisperFiles(modelId: string): Promise<Array<{ name: string; downloadUrl: string; sizeMb: number }>> {
    try {
      const files: Array<{ type: string; path: string; size?: number; lfs?: { size: number } }> =
        await this.fetchJson(`${this.apiUrl}/models/${modelId}/tree/main`);
      return files
        .filter(f => f.type === 'file' && f.path.endsWith('.bin') && f.path.toLowerCase().includes('ggml'))
        .map(f => ({
          name: f.path.split('/').pop() || f.path,
          downloadUrl: `${this.baseUrl}/${modelId}/resolve/main/${f.path}`,
          sizeMb: Math.round((f.lfs?.size || f.size || 0) / (1024 * 1024)),
        }))
        .sort((a, b) => a.sizeMb - b.sizeMb);
    } catch {
      return [];
    }
  }

}

export const huggingFaceService = new HuggingFaceService();
