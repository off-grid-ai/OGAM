/**
 * StorageSettingsScreen Tests
 *
 * Tests for the storage settings screen including:
 * - Title display
 * - Back button navigation
 * - Storage info rendering
 * - Breakdown section with model counts
 * - Model category summary
 * - Orphaned files section
 * - Stale downloads section
 * - Delete orphaned file flow
 * - Conversation count display
 *
 * Everything that is ours runs for real: the screen and its components (Card, Button, CustomAlert),
 * the real app, chat and download stores, the real modelManager scanning the disk for orphaned files,
 * and a real React Navigation stack (the screen is opened from Settings). State reaches the stores
 * through their own actions.
 *
 * Faked: only the device disk (react-native-fs over an in-memory file system).
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { StorageSettingsScreen } from '../../../src/screens/StorageSettingsScreen';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { withNavigatorRoutes } from '../../harness/realNavigation';
import { defaultNativeFileSystemBoundary as disk } from '../../harness/nativeFileSystem';
import { createDownloadedModel, createONNXImageModel } from '../../utils/factories';

jest.unmock('@react-navigation/native');

jest.mock('react-native-fs', () => {
  const { defaultNativeFileSystemBoundary: boundary } = require('../../harness/nativeFileSystem');
  return { __esModule: true, default: boundary.module, ...boundary.module };
});

const MODELS_DIR = `${disk.DocumentDirectoryPath}/models`;

/** A download-store entry missing the fields needed to show or finish it. */
const staleEntry = (modelKey: string, downloadId: string, fileName = '') =>
  ({ modelKey, downloadId, modelId: '', fileName, combinedTotalBytes: 0, status: 'failed' }) as any;

const renderStorage = () =>
  render(withNavigatorRoutes(<StorageSettingsScreen />, { openedFrom: 'Settings' }));

/** Let the first orphan scan of the disk finish. */
const scanned = async (view: ReturnType<typeof renderStorage>) => {
  await waitFor(() => expect(view.queryByText('Looking')).toBeNull());
};

describe('StorageSettingsScreen', () => {
  beforeEach(() => {
    disk.reset();
    const app = useAppStore.getState();
    app.setDownloadedModels([]);
    app.setDownloadedImageModels([]);
    for (const c of useChatStore.getState().conversations) useChatStore.getState().deleteConversation(c.id);
    for (const key of Object.keys(useDownloadStore.getState().downloads)) useDownloadStore.getState().remove(key);
  });

  // ---- Rendering tests ----

  it('renders "Storage" title', () => {
    const { getByText } = renderStorage();
    expect(getByText('Storage')).toBeTruthy();
  });

  it('back button returns to the screen it was opened from', async () => {
    const view = renderStorage();
    fireEvent.press(view.UNSAFE_getByProps({ name: 'arrow-left' }));
    await waitFor(() => expect(view.queryByText('Space on this phone')).toBeNull());
  });

  it('shows storage info sections', () => {
    const { getByText } = renderStorage();
    expect(getByText('Space on this phone')).toBeTruthy();
    expect(getByText('What uses it')).toBeTruthy();
  });

  it('shows hint text at the bottom', () => {
    const { getByText } = renderStorage();
    expect(getByText(/To get more space back/)).toBeTruthy();
  });

  // ---- Breakdown section tests ----

  it('does not count the intent classifier as one of your chat models', () => {
    useAppStore.getState().setDownloadedModels([
      createDownloadedModel({ id: 'm1', name: 'Model 1', fileSize: 1024, quantization: 'Q4' }),
      createDownloadedModel({ id: 'bartowski/SmolLM2-135M-Instruct-GGUF/smol.gguf', name: 'SmolLM2', fileSize: 1024, quantization: 'Q8' }),
    ]);

    const { getAllByText, queryByText } = renderStorage();
    expect(getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(queryByText('2')).toBeNull();
  });

  it('shows the chat models count in the breakdown', () => {
    useAppStore.getState().setDownloadedModels([
      createDownloadedModel({ id: 'm1', name: 'Model 1', fileSize: 1024, quantization: 'Q4' }),
      createDownloadedModel({ id: 'm2', name: 'Model 2', fileSize: 2048, quantization: 'Q8' }),
    ]);

    const { getAllByText } = renderStorage();
    // "Chat models" appears in breakdown AND section title
    expect(getAllByText('Chat models').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Image Models count in breakdown', () => {
    useAppStore.getState().setDownloadedImageModels([
      createONNXImageModel({ id: 'i1', name: 'Img Model', size: 1024, style: 'creative', backend: 'mnn' } as any),
    ]);

    const { getAllByText } = renderStorage();
    // "Image models" appears in breakdown AND section title
    expect(getAllByText('Image models').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Conversations count in breakdown', () => {
    for (let i = 0; i < 3; i++) useChatStore.getState().createConversation('m1');

    const { getByText } = renderStorage();
    expect(getByText('Conversations')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });

  it('shows the models line in what uses the space', () => {
    const { getByText } = renderStorage();
    expect(getByText('All models')).toBeTruthy();
  });

  // ---- Model summary tests ----

  it('does not show a chat models section when there are none', () => {
    const { queryAllByText } = renderStorage();
    // "Chat models" appears once in breakdown
    const llmTexts = queryAllByText('Chat models');
    expect(llmTexts.length).toBe(1); // Only breakdown, no separate section
  });

  it('says None beside Leftover files after the scan finds nothing', async () => {
    const view = renderStorage();
    await scanned(view);
    expect(view.getByText('None')).toBeTruthy();
  });

  it('shows orphaned files when they exist', async () => {
    // A model file on disk that no downloaded model claims.
    disk.seedFile(`${MODELS_DIR}/stale-model.gguf`, 1024 * 1024);

    const view = renderStorage();

    expect(await view.findByText('stale-model.gguf')).toBeTruthy();
    expect(view.getByText('Delete all')).toBeTruthy();
  });

  it('shows warning text when orphaned files exist', async () => {
    disk.seedFile(`${MODELS_DIR}/orphan.gguf`, 512);

    const view = renderStorage();

    expect(await view.findByText(/No model uses these/)).toBeTruthy();
  });

  // ---- Stale downloads section tests ----

  it('shows stale downloads when they exist', () => {
    useDownloadStore.getState().add(staleEntry('stale-key-1', 'dl-123'));

    const { getByText } = renderStorage();
    expect(getByText('Unfinished downloads')).toBeTruthy();
    expect(getByText('Clear all')).toBeTruthy();
  });

  it('shows stale download with missing modelId', () => {
    useDownloadStore.getState().add(staleEntry('stale-key-456', 'dl-456', 'partial.gguf'));

    const { getByText } = renderStorage();
    expect(getByText('Unfinished downloads')).toBeTruthy();
    expect(getByText('partial.gguf')).toBeTruthy();
  });

  it('does not show stale downloads section when none exist', () => {
    const { queryByText } = renderStorage();
    expect(queryByText('Unfinished downloads')).toBeNull();
  });

  it('clearing a stale download removes it from the download store', async () => {
    useDownloadStore.getState().add(staleEntry('stale-key-789', 'dl-789'));

    const view = renderStorage();
    fireEvent.press(view.UNSAFE_getByProps({ name: 'x' }));

    expect(useDownloadStore.getState().downloads['stale-key-789']).toBeUndefined();
    await waitFor(() => expect(view.queryByText('Unfinished downloads')).toBeNull());
  });

  it('clear all stale downloads shows confirmation', () => {
    useDownloadStore.getState().add(staleEntry('stale-1', 'dl-100'));
    useDownloadStore.getState().add(staleEntry('stale-2', 'dl-200'));

    const { getByText } = renderStorage();
    fireEvent.press(getByText('Clear all'));

    expect(getByText('Clear unfinished downloads')).toBeTruthy();
    expect(getByText('Clear 2 downloads?')).toBeTruthy();
  });

  // ---- Storage legend tests ----

  it('shows Used and Free labels in storage legend', () => {
    const { getByText } = renderStorage();
    expect(getByText(/Used:/)).toBeTruthy();
    expect(getByText(/Free:/)).toBeTruthy();
  });

  it('Orphaned Files section has scan button', () => {
    const view = renderStorage();
    expect(view.getByText('Leftover files')).toBeTruthy();
  });

  // ---- Delete orphaned file flow ----

  /** Press the trash button on the one orphaned file row (not the Delete All button's icon). */
  const pressRowTrash = (view: ReturnType<typeof renderStorage>) => {
    const icons = view.UNSAFE_getAllByProps({ name: 'trash-2' });
    fireEvent.press(icons[0]);
  };

  it('shows delete confirmation when orphaned file delete pressed', async () => {
    disk.seedFile(`${MODELS_DIR}/orphan.gguf`, 1024 * 1024);

    const view = renderStorage();
    await view.findByText('orphan.gguf');

    pressRowTrash(view);

    expect(view.getByText('Delete leftover file')).toBeTruthy();
    expect(view.getByText(/^Delete "orphan\.gguf"\?/)).toBeTruthy();
  });

  it('deletes orphaned file when confirmed', async () => {
    disk.seedFile(`${MODELS_DIR}/orphan.gguf`, 1024 * 1024);

    const view = renderStorage();
    await view.findByText('orphan.gguf');
    pressRowTrash(view);

    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Delete' }));
    });

    // The file is gone from the disk, and from the list.
    await waitFor(() => expect(view.queryByText('orphan.gguf')).toBeNull());
    expect(await disk.exists(`${MODELS_DIR}/orphan.gguf`)).toBe(false);
  });

  it('handles delete orphaned file error', async () => {
    disk.seedFile(`${MODELS_DIR}/orphan.gguf`, 1024 * 1024);
    // The device refuses to delete the file.
    disk.module.unlink.mockRejectedValueOnce(new Error('Delete failed'));

    const view = renderStorage();
    await view.findByText('orphan.gguf');
    pressRowTrash(view);

    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Delete' }));
    });

    // Should show error alert
    expect(await view.findByText('Failed to delete file')).toBeTruthy();
    expect(view.getByText('Error')).toBeTruthy();
    expect(await disk.exists(`${MODELS_DIR}/orphan.gguf`)).toBe(true);
  });

  it('deletes all orphaned files when confirmed', async () => {
    disk.seedFile(`${MODELS_DIR}/orphan1.gguf`, 1024);
    disk.seedFile(`${MODELS_DIR}/orphan2.gguf`, 2048);

    const view = renderStorage();
    await view.findByText('orphan1.gguf');

    fireEvent.press(view.getByText('Delete all'));
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Delete All' }));
    });

    await waitFor(() => expect(view.getByText('None')).toBeTruthy());
    expect(await disk.exists(`${MODELS_DIR}/orphan1.gguf`)).toBe(false);
    expect(await disk.exists(`${MODELS_DIR}/orphan2.gguf`)).toBe(false);
  });

  it('does not show delete all alert when no orphaned files', () => {
    // handleDeleteAllOrphaned returns early if orphanedFiles.length === 0
    // Since orphanedFiles is initially empty, the button is not shown
    const { queryByText } = renderStorage();
    expect(queryByText('Delete all')).toBeNull();
  });

  it('handles error during scan for orphaned files', async () => {
    disk.seedFile(`${MODELS_DIR}/orphan.gguf`, 512);
    // The disk cannot be read during the scan.
    disk.module.readDir.mockRejectedValue(new Error('Scan failed'));

    const view = renderStorage();
    await scanned(view);

    // Should still render without crashing
    expect(view.getByText('None')).toBeTruthy();
    disk.module.readDir.mockReset();
  });

  it('clears all stale downloads when confirmed', async () => {
    useDownloadStore.getState().add(staleEntry('stale-1', 'dl-100'));
    useDownloadStore.getState().add(staleEntry('stale-2', 'dl-200'));

    const view = renderStorage();
    fireEvent.press(view.getByText('Clear all'));
    fireEvent.press(view.getByRole('button', { name: 'Clear all' }));

    expect(useDownloadStore.getState().downloads['stale-1']).toBeUndefined();
    expect(useDownloadStore.getState().downloads['stale-2']).toBeUndefined();
    await waitFor(() => expect(view.queryByText('Unfinished downloads')).toBeNull());
  });

  it('rescans for orphaned files when scan button pressed', async () => {
    const view = renderStorage();
    await scanned(view);
    expect(view.getByText('None')).toBeTruthy();

    // A file appears on disk after the first scan; the scan button finds it.
    disk.seedFile(`${MODELS_DIR}/late.gguf`, 1024);
    fireEvent.press(view.UNSAFE_getByProps({ name: 'refresh-cw' }));

    expect(await view.findByText('late.gguf')).toBeTruthy();
  });

  it('shows scanning text while scanning', async () => {
    // The disk read is slow to answer.
    let answerRead!: () => void;
    const read = disk.module.readDir.getMockImplementation()!;
    disk.module.readDir.mockImplementationOnce(async (dir: string) => {
      await new Promise<void>(resolve => { answerRead = resolve; });
      return read(dir);
    });

    const view = renderStorage();

    // While scanning, "Scanning..." should appear
    expect(await view.findByText(/Looking/)).toBeTruthy();

    await act(async () => { answerRead?.(); });
    await scanned(view);
  });
});
