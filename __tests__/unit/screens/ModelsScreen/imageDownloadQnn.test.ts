import { getQnnWarningMessage, showQnnWarningAlert } from '../../../../src/services/imageDownloadQnn';
import { ImageModelDescriptor } from '../../../../src/screens/ModelsScreen/types';
import { makeImageDownloadDeps } from '../../../utils/factories';


function makeModel(overrides: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor {
  return {
    id: 'qnn-model',
    name: 'QNN Model',
    description: 'desc',
    downloadUrl: '',
    size: 1000000,
    style: 'creative',
    backend: 'qnn',
    ...overrides,
  };
}

describe('getQnnWarningMessage', () => {
  it('returns no-NPU message when device has no NPU', () => {
    const msg = getQnnWarningMessage(makeModel(), { hasNPU: false });
    expect(msg).toContain('does not have a compatible NPU');
  });

  it('returns null when model has no variant', () => {
    const msg = getQnnWarningMessage(makeModel(), { hasNPU: true, qnnVariant: '8gen2' });
    expect(msg).toBeNull();
  });

  it('returns null when socInfo has no qnnVariant', () => {
    const msg = getQnnWarningMessage(makeModel({ variant: '8gen2' }), { hasNPU: true });
    expect(msg).toBeNull();
  });

  it('returns null when model and device variants match exactly', () => {
    const msg = getQnnWarningMessage(makeModel({ variant: '8gen1' }), { hasNPU: true, qnnVariant: '8gen1' });
    expect(msg).toBeNull();
  });

  it('returns null when device is 8gen2 (flagship — always compatible)', () => {
    const msg = getQnnWarningMessage(makeModel({ variant: '8gen1' }), { hasNPU: true, qnnVariant: '8gen2' });
    expect(msg).toBeNull();
  });

  it('returns null when device is 8gen1 and model is not 8gen2', () => {
    const msg = getQnnWarningMessage(makeModel({ variant: '8gen1' }), { hasNPU: true, qnnVariant: '8gen1' });
    expect(msg).toBeNull();
  });

  it('returns incompatibility message when device is 8gen1 and model is 8gen2', () => {
    const msg = getQnnWarningMessage(makeModel({ variant: '8gen2' }), { hasNPU: true, qnnVariant: '8gen1' });
    expect(msg).toContain('flagship');
  });

  it('returns incompatibility message for non-flagship device with 8gen2 model variant', () => {
    const msg = getQnnWarningMessage(makeModel({ variant: '8gen2' }), { hasNPU: true, qnnVariant: 'min' });
    expect(msg).toContain('non-flagship');
  });

  it('returns incompatibility message mentioning device chip name', () => {
    const msg = getQnnWarningMessage(makeModel({ variant: '8gen2' }), { hasNPU: true, qnnVariant: '8gen1' });
    expect(msg).toContain('8gen1');
  });
});

describe('showQnnWarningAlert', () => {
  it('shows two-button alert with Download Anyway when device has NPU', () => {
    const deps = makeImageDownloadDeps();
    const onDownloadAnyway = jest.fn();
    showQnnWarningAlert(
      { warningMessage: 'some warning', hasNPU: true, modelInfo: makeModel(), onDownloadAnyway },
      deps,
    );
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
    const alert = (deps.setAlertState as jest.Mock).mock.calls[0][0];
    expect(alert.buttons).toHaveLength(2);
    expect(alert.buttons[1].text).toBe('Download Anyway');
  });

  it('calls onDownloadAnyway and hides alert when Download Anyway is pressed', () => {
    const deps = makeImageDownloadDeps();
    const onDownloadAnyway = jest.fn();
    showQnnWarningAlert(
      { warningMessage: 'some warning', hasNPU: true, modelInfo: makeModel(), onDownloadAnyway },
      deps,
    );
    const alert = (deps.setAlertState as jest.Mock).mock.calls[0][0];
    alert.buttons[1].onPress();
    expect(onDownloadAnyway).toHaveBeenCalled();
    expect(deps.setAlertState).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  });

  it('shows single OK button when device has no NPU', () => {
    const deps = makeImageDownloadDeps();
    showQnnWarningAlert(
      { warningMessage: 'no npu', hasNPU: false, modelInfo: makeModel(), onDownloadAnyway: jest.fn() },
      deps,
    );
    const alert = (deps.setAlertState as jest.Mock).mock.calls[0][0];
    expect(alert.buttons).toHaveLength(1);
    expect(alert.buttons[0].text).toBe('OK');
  });
});
