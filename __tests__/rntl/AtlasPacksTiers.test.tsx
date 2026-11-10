import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockSave = jest.fn(async () => 'Atlas-Emergency-medium.zip');
jest.mock('../../src/atlasTools/atlasPacks', () => ({
  ...jest.requireActual('../../src/atlasTools/emergencyTiers'),
  listAtlasPacks: jest.fn(async () => ['01_Medical.zip', '02_Water.zip', '03_Food.zip', '06_Survival.zip', '09_Atlases.zip'].map((name) => ({ name, label: name, size: 50_000_000, url: 'u', updated: 't' }))),
  installAtlasPack: jest.fn(),
  saveTierToDrive: (...a: unknown[]) => (mockSave as any)(...a),
  atlasLibraryProjectId: () => 'p1',
}));
jest.mock('../../src/atlasTools/packImport', () => ({ importZipPack: jest.fn(async () => null) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) } }));

import { AtlasPacksSection } from '../../src/components/AtlasPacksSection';

it('shows how many packs and how big each package size is, and saves the chosen size to a drive', async () => {
  const view = render(<AtlasPacksSection />);
  await waitFor(() => expect(view.getByTestId('tier-size').props.children).toMatch(/3 packs, 150 MB/));
  fireEvent.press(view.getByTestId('tier-medium'));
  await waitFor(() => expect(view.getByTestId('tier-size').props.children).toMatch(/4 packs, 200 MB/));
  fireEvent.press(view.getByTestId('tier-full'));
  await waitFor(() => expect(view.getByTestId('tier-size').props.children).toMatch(/5 packs, 250 MB/));
  fireEvent.press(view.getByTestId('tier-medium'));
  fireEvent.press(view.getByTestId('tier-save'));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect((mockSave.mock.calls[0] as any)[0]).toBe('medium');
});
