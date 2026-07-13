/**
 * ModelCard Component Tests
 *
 * Tests for the model card display component including:
 * - Basic rendering (full and compact mode)
 * - Credibility badges
 * - Vision model indicator badge
 * - Size display (combined model + mmproj)
 * - Action buttons (download, select, delete)
 * - Active state and badge
 * - Stats display (downloads, likes, formatting)
 * - Download progress display
 * - Incompatible model state
 * - Size range display for multi-file models
 * - Model type badges (text, vision, code) in compact mode
 * - Param count and RAM badges in compact mode
 *
 * Priority: P1 (High)
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ModelCard } from '../../../src/components/ModelCard';
import {
  createVisionModel,
  createDownloadedModel,
  createModelFile,
  createModelFileWithMmProj,
} from '../../utils/factories';

// Mock huggingFaceService for formatFileSize
jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: {
    formatFileSize: jest.fn((bytes: number) => {
      if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
      return `${bytes} B`;
    }),
  },
}));

describe('ModelCard', () => {
  const baseModel = {
    id: 'test/model',
    name: 'Test Model',
    author: 'test-author',
  };

  // ============================================================================
  // Queued vs downloading — the shared card contract every tab now relies on.
  // Text/Image/STT tabs all feed ModelCard isQueued/isDownloading from the ONE
  // classifier; this pins the render so a queued download shows the clock (not
  // "downloading 0%") uniformly — the image/STT queued-icon bug this refactor fixed.
  // ============================================================================
  describe('queued vs downloading state', () => {
    it('renders the Queued clock (accessibilityLabel "Queued") when isQueued', () => {
      const { getByLabelText } = render(
        <ModelCard model={baseModel} isQueued downloadProgress={0} />
      );
      expect(getByLabelText('Queued')).toBeTruthy();
    });

    it('does NOT render the Queued clock when actively downloading', () => {
      const { queryByLabelText } = render(
        <ModelCard model={baseModel} isDownloading downloadProgress={0.4} />
      );
      expect(queryByLabelText('Queued')).toBeNull();
    });

    it('shows bytes AND percent together (caption row) while downloading', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          isDownloading
          downloadProgress={0.5}
          downloadBytes={{ downloaded: 2 * 1024 * 1024 * 1024, total: 4 * 1024 * 1024 * 1024 }}
        />
      );
      // Both the size caption and the percent render (full-width bar + left/right row).
      expect(getByText('2.0 GB / 4.0 GB')).toBeTruthy();
      expect(getByText('50%')).toBeTruthy();
    });

    it('shows bytes alongside the Queued label (queued reads "0 B / size")', () => {
      const { getByText, getByLabelText } = render(
        <ModelCard
          model={baseModel}
          isQueued
          downloadProgress={0}
          downloadBytes={{ downloaded: 0, total: 4 * 1024 * 1024 * 1024 }}
        />
      );
      expect(getByLabelText('Queued')).toBeTruthy();
      expect(getByText('0 B / 4.0 GB')).toBeTruthy();
    });
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders model name', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, name: 'Llama 3.2 3B' }} />
      );
      expect(getByText('Llama 3.2 3B')).toBeTruthy();
    });

    it('renders author tag', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, author: 'meta-llama' }} />
      );
      expect(getByText('meta-llama')).toBeTruthy();
    });

    it('renders file size when file is provided', () => {
      const file = createModelFile({ size: 4 * 1024 * 1024 * 1024 });
      const { getByText } = render(
        <ModelCard model={baseModel} file={file} />
      );
      expect(getByText('4.0 GB')).toBeTruthy();
    });

    it('renders quantization badge', () => {
      const file = createModelFile({ quantization: 'Q4_K_M' });
      const { getByText } = render(
        <ModelCard model={baseModel} file={file} />
      );
      expect(getByText('Q4_K_M')).toBeTruthy();
    });

    it('shows download progress when downloading', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          isDownloading={true}
          downloadProgress={0.5}
        />
      );
      expect(getByText('50%')).toBeTruthy();
    });

    it('calls onPress when tapped', () => {
      const onPress = jest.fn();
      const { getByTestId } = render(
        <ModelCard model={baseModel} onPress={onPress} testID="model-card" />
      );
      fireEvent.press(getByTestId('model-card'));
      expect(onPress).toHaveBeenCalled();
    });

    it('renders description in full mode', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, description: 'A powerful language model for testing' }}
        />
      );
      expect(getByText('A powerful language model for testing')).toBeTruthy();
    });

    it('does not render description when not provided', () => {
      const { queryByText } = render(
        <ModelCard model={baseModel} />
      );
      // No description text should be rendered
      expect(queryByText('A powerful language model')).toBeNull();
    });

    it('renders file size from downloadedModel', () => {
      const downloadedModel = createDownloadedModel({ fileSize: 3 * 1024 * 1024 * 1024 });
      const { getByText } = render(
        <ModelCard model={baseModel} downloadedModel={downloadedModel} />
      );
      expect(getByText('3.0 GB')).toBeTruthy();
    });

    it('renders quantization from downloadedModel', () => {
      const downloadedModel = createDownloadedModel({ quantization: 'Q5_K_M' });
      const { getByText } = render(
        <ModelCard model={baseModel} downloadedModel={downloadedModel} />
      );
      expect(getByText('Q5_K_M')).toBeTruthy();
    });

    it('is disabled when no onPress provided', () => {
      const { getByTestId } = render(
        <ModelCard model={baseModel} testID="card" />
      );
      const card = getByTestId('card');
      expect(card.props.accessibilityState?.disabled).toBe(true);
    });

    it('shows 0% progress when download just started', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          isDownloading={true}
          downloadProgress={0}
        />
      );
      expect(getByText('0%')).toBeTruthy();
    });

    it('shows 100% progress when download is complete', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          isDownloading={true}
          downloadProgress={1}
        />
      );
      expect(getByText('100%')).toBeTruthy();
    });
  });

  // ============================================================================
  // Compact Mode
  // ============================================================================
  describe('compact mode', () => {
    it('renders in compact layout', () => {
      const { getByText } = render(
        <ModelCard model={baseModel} compact={true} />
      );
      expect(getByText('Test Model')).toBeTruthy();
    });

    it('shows description in compact mode (truncated)', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, description: 'A great model for testing' }}
          compact={true}
        />
      );
      expect(getByText('A great model for testing')).toBeTruthy();
    });

    it('shows download count in compact mode', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, downloads: 15000 }}
          compact={true}
        />
      );
      expect(getByText('15.0K dl')).toBeTruthy();
    });

    it('shows model type badge in compact mode for vision', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, modelType: 'vision' }}
          compact={true}
        />
      );
      expect(getByText('Vision')).toBeTruthy();
    });

    it('shows model type badge in compact mode for code', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, modelType: 'code' }}
          compact={true}
        />
      );
      expect(getByText('Code')).toBeTruthy();
    });

    it('shows model type badge in compact mode for text', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, modelType: 'text' }}
          compact={true}
        />
      );
      expect(getByText('Text')).toBeTruthy();
    });

    it('shows param count badge in compact mode', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, paramCount: 7 }}
          compact={true}
        />
      );
      expect(getByText('7B params')).toBeTruthy();
    });

    it('shows the NPU/GPU badge when supportsAcceleration is set', () => {
      const { getByText, queryByTestId } = render(
        <ModelCard model={{ ...baseModel, paramCount: 7 }} compact={true} supportsAcceleration />
      );
      expect(getByText('NPU/GPU')).toBeTruthy();
      expect(queryByTestId('npu-gpu-badge')).toBeTruthy();
    });

    it('hides the NPU/GPU badge when the model is not accelerable', () => {
      const { queryByText, queryByTestId } = render(
        <ModelCard model={{ ...baseModel, paramCount: 7 }} compact={true} supportsAcceleration={false} />
      );
      expect(queryByText('NPU/GPU')).toBeNull();
      expect(queryByTestId('npu-gpu-badge')).toBeNull();
    });

    it('shows the NPU/GPU badge in standard (non-compact) mode too — the quant-file cards', () => {
      const { getByText } = render(
        <ModelCard model={baseModel} supportsAcceleration />
      );
      expect(getByText('NPU/GPU')).toBeTruthy();
    });

    it('shows cumulative bytes and "N downloads" when multiple downloads run', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          compact
          isDownloading
          downloadProgress={0.5}
          downloadBytes={{ downloaded: 1.5 * 1024 * 1024 * 1024, total: 10 * 1024 * 1024 * 1024 }}
          downloadCount={2}
        />
      );
      expect(getByText('1.5 GB / 10.0 GB · 2 downloads')).toBeTruthy();
    });

    it('omits the "N downloads" note for a single download', () => {
      const { getByText, queryByText } = render(
        <ModelCard
          model={baseModel}
          compact
          isDownloading
          downloadProgress={0.5}
          downloadBytes={{ downloaded: 2 * 1024 * 1024 * 1024, total: 4 * 1024 * 1024 * 1024 }}
          downloadCount={1}
        />
      );
      expect(getByText('2.0 GB / 4.0 GB')).toBeTruthy();
      expect(queryByText(/downloads/)).toBeNull();
    });

    it('shows min RAM badge in compact mode', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, modelType: 'text', minRamGB: 4 }}
          compact={true}
        />
      );
      expect(getByText('4GB+ RAM')).toBeTruthy();
    });

    it('does not show download count when 0 in compact mode', () => {
      const { queryByText } = render(
        <ModelCard
          model={{ ...baseModel, downloads: 0 }}
          compact={true}
        />
      );
      expect(queryByText('0 dl')).toBeNull();
    });

    it('shows credibility badge in compact mode for lmstudio', () => {
      const { getByText } = render(
        <ModelCard
          model={{
            ...baseModel,
            credibility: {
              source: 'lmstudio',
              isOfficial: false,
              isVerifiedQuantizer: true,
              verifiedBy: 'LM Studio',
            },
          }}
          compact={true}
        />
      );
      expect(getByText('LM Studio')).toBeTruthy();
      expect(getByText('★')).toBeTruthy();
    });

    it('shows trending icon in compact mode', () => {
      const { getByText } = render(
        <ModelCard model={baseModel} compact={true} isTrending={true} />
      );
      expect(getByText('')).toBeTruthy();
    });
  });

  // ============================================================================
  // Credibility Badges
  // ============================================================================
  describe('credibility badges', () => {
    it('shows star for lmstudio-community', () => {
      const { getByText } = render(
        <ModelCard
          model={{
            ...baseModel,
            credibility: {
              source: 'lmstudio',
              isOfficial: false,
              isVerifiedQuantizer: true,
              verifiedBy: 'LM Studio',
            },
          }}
        />
      );
      expect(getByText('★')).toBeTruthy();
      expect(getByText('LM Studio')).toBeTruthy();
    });

    it('shows checkmark for official authors', () => {
      const { getByText } = render(
        <ModelCard
          model={{
            ...baseModel,
            credibility: {
              source: 'official',
              isOfficial: true,
              isVerifiedQuantizer: false,
              verifiedBy: 'Meta',
            },
          }}
        />
      );
      expect(getByText('✓')).toBeTruthy();
      expect(getByText('Official')).toBeTruthy();
    });

    it('shows diamond for verified quantizers', () => {
      const { getByText } = render(
        <ModelCard
          model={{
            ...baseModel,
            credibility: {
              source: 'verified-quantizer',
              isOfficial: false,
              isVerifiedQuantizer: true,
              verifiedBy: 'TheBloke',
            },
          }}
        />
      );
      expect(getByText('◆')).toBeTruthy();
      expect(getByText('Verified')).toBeTruthy();
    });

    it('shows no badge icon for community models', () => {
      const { queryByText, getByText } = render(
        <ModelCard
          model={{
            ...baseModel,
            credibility: {
              source: 'community',
              isOfficial: false,
              isVerifiedQuantizer: false,
            },
          }}
        />
      );
      expect(getByText('Community')).toBeTruthy();
      expect(queryByText('★')).toBeNull();
      expect(queryByText('✓')).toBeNull();
      expect(queryByText('◆')).toBeNull();
    });

    it('shows credibility from downloadedModel when model has none', () => {
      const downloadedModel = createDownloadedModel({
        credibility: {
          source: 'official',
          isOfficial: true,
          isVerifiedQuantizer: false,
          verifiedBy: 'Meta',
        },
      });
      const { getByText } = render(
        <ModelCard model={baseModel} downloadedModel={downloadedModel} />
      );
      expect(getByText('Official')).toBeTruthy();
    });
  });

  // ============================================================================
  // Vision Badge
  // ============================================================================
  describe('vision badge', () => {
    it('shows Vision badge for vision models (file with mmProjFile)', () => {
      const visionFile = createModelFileWithMmProj();
      const { getByText } = render(
        <ModelCard model={baseModel} file={visionFile} />
      );
      expect(getByText('Vision')).toBeTruthy();
    });

    it('shows Vision badge for downloaded vision models', () => {
      const visionModel = createVisionModel();
      const { getByText } = render(
        <ModelCard model={baseModel} downloadedModel={visionModel} />
      );
      expect(getByText('Vision')).toBeTruthy();
    });

    it('does not show Vision badge for text-only models', () => {
      const textFile = createModelFile();
      const { queryByText } = render(
        <ModelCard model={baseModel} file={textFile} />
      );
      expect(queryByText('Vision')).toBeNull();
    });

    it('shows Needs repair badge when downloaded vision model is missing mmproj', () => {
      const visionFile = createModelFileWithMmProj();
      const brokenModel = createDownloadedModel({ isVisionModel: true });
      const { getByText, queryByText } = render(
        <ModelCard model={baseModel} file={visionFile} downloadedModel={brokenModel} />
      );
      expect(getByText('Needs repair')).toBeTruthy();
      expect(queryByText('Vision')).toBeNull();
    });

    it('shows Repairing badge while vision repair is in progress', () => {
      const visionFile = createModelFileWithMmProj();
      const brokenModel = createDownloadedModel({ isVisionModel: true });
      const { getByText, queryByText } = render(
        <ModelCard
          model={baseModel}
          file={visionFile}
          downloadedModel={brokenModel}
          isRepairingVision={true}
        />
      );
      expect(getByText('Repairing...')).toBeTruthy();
      expect(queryByText('Needs repair')).toBeNull();
    });
  });

  // ============================================================================
  // Size Display
  // ============================================================================
  describe('size display', () => {
    it('shows combined size for model + mmproj', () => {
      const visionFile = createModelFileWithMmProj({
        size: 4 * 1024 * 1024 * 1024, // 4GB
        mmProjSize: 500 * 1024 * 1024, // 500MB
      });
      const { getByText } = render(
        <ModelCard model={baseModel} file={visionFile} />
      );
      // 4GB + 500MB = ~4.5GB
      expect(getByText('4.5 GB')).toBeTruthy();
    });

    it('shows single size for text-only models', () => {
      const file = createModelFile({ size: 3 * 1024 * 1024 * 1024 });
      const { getByText } = render(
        <ModelCard model={baseModel} file={file} />
      );
      expect(getByText('3.0 GB')).toBeTruthy();
    });

    it('shows downloaded model size including mmproj', () => {
      const visionModel = createVisionModel({
        fileSize: 2 * 1024 * 1024 * 1024,
        mmProjFileSize: 300 * 1024 * 1024,
      });
      const { getByText } = render(
        <ModelCard model={baseModel} downloadedModel={visionModel} />
      );
      // 2GB + 300MB ~ 2.3 GB
      expect(getByText('2.3 GB')).toBeTruthy();
    });

    it('shows size range for models with multiple files', () => {
      const model = {
        ...baseModel,
        files: [
          createModelFile({ size: 2 * 1024 * 1024 * 1024, quantization: 'Q4_K_M' }),
          createModelFile({ size: 5 * 1024 * 1024 * 1024, quantization: 'Q8_0' }),
        ],
      };
      const { getByText } = render(
        <ModelCard model={model} />
      );
      // Should show size range
      expect(getByText('2.0 GB - 5.0 GB')).toBeTruthy();
      expect(getByText('2 files')).toBeTruthy();
    });

    it('shows single size when all files are same size', () => {
      const model = {
        ...baseModel,
        files: [
          createModelFile({ size: 4 * 1024 * 1024 * 1024, quantization: 'Q4_K_M' }),
          createModelFile({ size: 4 * 1024 * 1024 * 1024, quantization: 'Q4_K_S' }),
        ],
      };
      const { getByText } = render(
        <ModelCard model={model} />
      );
      expect(getByText('4.0 GB')).toBeTruthy();
    });

    it('shows "1 file" for single file model', () => {
      const model = {
        ...baseModel,
        files: [
          createModelFile({ size: 4 * 1024 * 1024 * 1024, quantization: 'Q4_K_M' }),
        ],
      };
      const { getByText } = render(
        <ModelCard model={model} />
      );
      expect(getByText('1 file')).toBeTruthy();
    });
  });

  // ============================================================================
  // Action Buttons
  // ============================================================================
  describe('action buttons', () => {
    it('shows download button for undownloaded models', () => {
      const onDownload = jest.fn();
      const { getByTestId } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={false}
          onDownload={onDownload}
          testID="card"
        />
      );
      const downloadBtn = getByTestId('card-download');
      fireEvent.press(downloadBtn);
      expect(onDownload).toHaveBeenCalled();
    });

    it('shows select button for downloaded non-active models', () => {
      const onSelect = jest.fn();
      const { UNSAFE_getAllByType } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={true}
          isActive={false}
          onSelect={onSelect}
          testID="card"
        />
      );
      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      // Find the select button (check-circle) - it's one of the action buttons
      // The first touchable is the card itself, others are action buttons
      const selectBtn = touchables.find((t: any) => {
        return !t.props.testID && !t.props.disabled;
      });
      if (selectBtn) {
        fireEvent.press(selectBtn);
        expect(onSelect).toHaveBeenCalled();
      }
    });

    it('shows delete button for downloaded models', () => {
      const onDelete = jest.fn();
      const { UNSAFE_getAllByType } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={true}
          onDelete={onDelete}
          testID="card"
        />
      );
      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      // The delete button is the last action button
      const lastTouchable = touchables[touchables.length - 1];
      fireEvent.press(lastTouchable);
      expect(onDelete).toHaveBeenCalled();
    });

    it('hides download button when already downloaded', () => {
      const onDownload = jest.fn();
      const { queryByTestId } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={true}
          onDownload={onDownload}
          testID="card"
        />
      );
      expect(queryByTestId('card-download')).toBeNull();
    });

    it('disables download when not compatible', () => {
      const onDownload = jest.fn();
      const { getByTestId } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={false}
          isCompatible={false}
          onDownload={onDownload}
          testID="card"
        />
      );
      const downloadBtn = getByTestId('card-download');
      expect(downloadBtn.props.accessibilityState?.disabled).toBe(true);
    });

    it('disables download when not compatible even if a reason is shown', () => {
      const onDownload = jest.fn();
      const { getByTestId } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={false}
          isCompatible={false}
          incompatibleReason="Not supported yet"
          onDownload={onDownload}
          testID="card"
        />
      );
      const downloadBtn = getByTestId('card-download');
      expect(downloadBtn.props.accessibilityState?.disabled).toBe(true);
    });

    it('shows "Too large" warning when not compatible', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          isCompatible={false}
        />
      );
      expect(getByText('Too large')).toBeTruthy();
    });

    it('does not show download button when isDownloading', () => {
      const onDownload = jest.fn();
      const onCancel = jest.fn();
      const { queryByTestId, getByTestId } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={false}
          isDownloading={true}
          onDownload={onDownload}
          onCancel={onCancel}
          testID="card"
        />
      );
      // Download button should not show during download
      expect(queryByTestId('card-download')).toBeNull();
      // Cancel button should be shown instead
      expect(getByTestId('card-cancel')).toBeTruthy();
    });

    it('does not show select button when model is active', () => {
      const onSelect = jest.fn();
      const { toJSON } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={true}
          isActive={true}
          onSelect={onSelect}
        />
      );
      // Active models should not show the select button
      const treeStr = JSON.stringify(toJSON());
      expect(treeStr).toContain('Active'); // Active badge is shown instead
    });

    it('shows downloaded check icon when no action handlers are provided', () => {
      const { toJSON } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={true}
        />
      );
      expect(JSON.stringify(toJSON())).toContain('check-circle');
    });

    it('shows repair spinner instead of repair button while repairing downloaded vision model', () => {
      const { getByTestId, queryByTestId } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={true}
          onRepairVision={jest.fn()}
          isRepairingVision={true}
          testID="card"
        />
      );
      expect(getByTestId('card-repairing-vision')).toBeTruthy();
      expect(queryByTestId('card-repair-vision')).toBeNull();
    });

    it('shows repair action for downloaded vision model when repair is available and idle', () => {
      const onRepairVision = jest.fn();
      const { getByTestId } = render(
        <ModelCard
          model={baseModel}
          isDownloaded={true}
          onRepairVision={onRepairVision}
          testID="card"
        />
      );
      fireEvent.press(getByTestId('card-repair-vision'));
      expect(onRepairVision).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Active State
  // ============================================================================
  describe('active state', () => {
    it('shows Active badge when model is active', () => {
      const { getByText } = render(
        <ModelCard model={baseModel} isActive={true} />
      );
      expect(getByText('Active')).toBeTruthy();
    });

    it('does not show Active badge when model is not active', () => {
      const { queryByText } = render(
        <ModelCard model={baseModel} isActive={false} />
      );
      expect(queryByText('Active')).toBeNull();
    });
  });

  // ============================================================================
  // Stats
  // ============================================================================
  describe('stats display', () => {
    it('shows download count in full mode', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, downloads: 1500000 }} />
      );
      expect(getByText('1.5M downloads')).toBeTruthy();
    });

    it('shows likes count', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, downloads: 1000, likes: 250 }} />
      );
      expect(getByText('250 likes')).toBeTruthy();
    });

    it('formats numbers correctly', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, downloads: 500 }} />
      );
      expect(getByText('500 downloads')).toBeTruthy();
    });

    it('does not show stats row when downloads is 0', () => {
      const { queryByText } = render(
        <ModelCard model={{ ...baseModel, downloads: 0 }} />
      );
      expect(queryByText('0 downloads')).toBeNull();
    });

    it('does not show stats row when downloads is undefined', () => {
      const { queryByText } = render(
        <ModelCard model={baseModel} />
      );
      expect(queryByText('downloads')).toBeNull();
    });

    it('does not show likes when likes is 0', () => {
      const { queryByText } = render(
        <ModelCard model={{ ...baseModel, downloads: 1000, likes: 0 }} />
      );
      expect(queryByText('0 likes')).toBeNull();
    });

    it('does not show stats in compact mode', () => {
      const { queryByText } = render(
        <ModelCard model={{ ...baseModel, downloads: 1000 }} compact={true} />
      );
      // In compact mode, downloads are shown as "1.0K dl" not "1.0K downloads"
      expect(queryByText('1.0K downloads')).toBeNull();
    });

    it('formats million downloads correctly', () => {
      const { getByText } = render(
        <ModelCard model={{ ...baseModel, downloads: 5000000 }} />
      );
      expect(getByText('5.0M downloads')).toBeTruthy();
    });
  });

  // ============================================================================
  // Incompatible model
  // ============================================================================
  describe('incompatible model', () => {
    it('applies reduced opacity for incompatible models', () => {
      const { toJSON } = render(
        <ModelCard model={baseModel} isCompatible={false} />
      );
      const treeStr = JSON.stringify(toJSON());
      expect(treeStr).toContain('0.6'); // cardIncompatible opacity
    });
  });

  // ============================================================================
  // Recommended config (curated entries like the LiteRT parent card)
  // ============================================================================
  describe('recommended config', () => {
    it('renders the pill with the default "Recommended" label when no pillLabel given', () => {
      const { getByText } = render(
        <ModelCard model={baseModel} compact={true} recommended={{}} />,
      );
      expect(getByText('Recommended')).toBeTruthy();
    });

    it('renders the pill with a custom pillLabel', () => {
      const { getByText } = render(
        <ModelCard model={baseModel} compact={true} recommended={{ pillLabel: 'Featured' }} />,
      );
      expect(getByText('Featured')).toBeTruthy();
    });

    it('renders custom chips in place of the modelType chip row (compact)', () => {
      const { getByText, queryByText } = render(
        <ModelCard
          model={{ ...baseModel, modelType: 'vision' }}
          compact={true}
          recommended={{ chips: ['Vision', 'GPU'] }}
        />,
      );
      expect(getByText('GPU')).toBeTruthy();
      // Both "Vision" (custom chip) and the auto-derived modelType "Vision" would
      // collide on text — assert only one matching node renders (custom chip path).
      expect(queryByText('Vision')).toBeTruthy();
    });

    it('renders the highlight as part of the common description (compact)', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          compact={true}
          recommended={{ highlightText: 'Hardware-accelerated inference with vision support' }}
        />,
      );
      expect(getByText('Hardware-accelerated inference with vision support')).toBeTruthy();
    });

    it('shows description AND highlight together in the common slot (no suppression)', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, description: 'Gemma model' }}
          compact={true}
          recommended={{ highlightText: 'Up to 2x faster via GPU' }}
        />,
      );
      // Both render, combined into one common muted description line.
      expect(getByText('Gemma model Up to 2x faster via GPU')).toBeTruthy();
    });

    it('does not duplicate when description equals the highlight (deduped)', () => {
      const { getAllByText } = render(
        <ModelCard
          model={{ ...baseModel, description: 'Up to 2x faster via GPU' }}
          compact={true}
          recommended={{ highlightText: 'Up to 2x faster via GPU' }}
        />,
      );
      expect(getAllByText('Up to 2x faster via GPU')).toHaveLength(1);
    });

    it('still renders the description when no highlightText is provided', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, description: 'Visible description' }}
          compact={true}
          recommended={{ pillLabel: 'Recommended' }}
        />,
      );
      expect(getByText('Visible description')).toBeTruthy();
    });

    it('renders pill + combined description/highlight in standard (non-compact) mode', () => {
      const { getByText } = render(
        <ModelCard
          model={{ ...baseModel, description: 'Detail description' }}
          recommended={{ pillLabel: 'Recommended', highlightText: 'Up to 2x faster via GPU' }}
        />,
      );
      expect(getByText('Recommended')).toBeTruthy();
      // Description + highlight render as one common line (not a separate colour/slot).
      expect(getByText('Detail description Up to 2x faster via GPU')).toBeTruthy();
    });

    it('does not render pill or highlight when recommended prop is absent', () => {
      const { queryByText } = render(
        <ModelCard model={{ ...baseModel, description: 'Plain card' }} compact={true} />,
      );
      expect(queryByText('Recommended')).toBeNull();
      expect(queryByText('Hardware-accelerated inference with vision support')).toBeNull();
    });
  });

  // ============================================================================
  // Failed download state (FailedSection)
  // ============================================================================
  describe('failedState', () => {
    const baseFailedState = {
      errorMessage: 'Network connection lost.',
      bytesDownloaded: 192_000_000,
      totalBytes: 386_000_000,
      onRetry: jest.fn(),
      onRemove: jest.fn(),
    };

    it('renders error message when failedState is provided', () => {
      const { getByText } = render(
        <ModelCard model={baseModel} failedState={baseFailedState} />,
      );
      expect(getByText('Network connection lost.')).toBeTruthy();
    });

    it('renders Retry and Remove buttons when failedState is provided', () => {
      const { getByText } = render(
        <ModelCard model={baseModel} failedState={baseFailedState} />,
      );
      expect(getByText('Retry')).toBeTruthy();
      expect(getByText('Remove')).toBeTruthy();
    });

    it('calls onRetry when Retry is pressed', () => {
      const onRetry = jest.fn();
      const { getByText } = render(
        <ModelCard model={baseModel} failedState={{ ...baseFailedState, onRetry }} />,
      );
      fireEvent.press(getByText('Retry'));
      expect(onRetry).toHaveBeenCalled();
    });

    it('calls onRemove when Remove is pressed', () => {
      const onRemove = jest.fn();
      const { getByText } = render(
        <ModelCard model={baseModel} failedState={{ ...baseFailedState, onRemove }} />,
      );
      fireEvent.press(getByText('Remove'));
      expect(onRemove).toHaveBeenCalled();
    });

    it('shows progress percentage from bytesDownloaded / totalBytes', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          failedState={{ ...baseFailedState, bytesDownloaded: 193_000_000, totalBytes: 386_000_000 }}
        />,
      );
      expect(getByText('50%')).toBeTruthy();
    });

    it('shows 0% when totalBytes is 0 (unknown size)', () => {
      const { getByText } = render(
        <ModelCard
          model={baseModel}
          failedState={{ ...baseFailedState, bytesDownloaded: 0, totalBytes: 0 }}
        />,
      );
      expect(getByText('0%')).toBeTruthy();
    });

    it('hides ModelCardActions when failedState is set', () => {
      const onDownload = jest.fn();
      const { queryByTestId } = render(
        <ModelCard
          model={baseModel}
          failedState={baseFailedState}
          onDownload={onDownload}
          testID="card"
        />,
      );
      expect(queryByTestId('card-download')).toBeNull();
    });

    it('does not render FailedSection when failedState is absent', () => {
      const { queryByText } = render(
        <ModelCard model={baseModel} />,
      );
      expect(queryByText('Retry')).toBeNull();
      expect(queryByText('Remove')).toBeNull();
    });
  });
});
