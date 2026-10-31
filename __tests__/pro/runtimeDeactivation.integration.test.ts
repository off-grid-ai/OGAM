const mockClipboardEntitlement = jest.fn();
const mockEmailCalendarEntitlement = jest.fn();
const mockDisconnectServer = jest.fn();
const mockAudioCleanup = jest.fn();
const mockGrantCleanup = jest.fn();
const mockGrantRefreshCleanup = jest.fn();
const mockCompanionTaskCleanup = jest.fn();
const mockReconcileCleanup = jest.fn();
let mockLicenseInfoListener: ((info: { isPro: boolean }) => void) | undefined;

jest.mock('@offgrid/core/bootstrap/slotRegistry', () => ({
  SLOTS: {
    appRoot: 'app.root',
    homeSyncCard: 'home.syncCard',
    homeNotificationsButton: 'home.notificationsButton',
    taskToolDetail: 'message.taskToolDetail',
    autoSetupVoiceIndicator: 'autoSetup.voiceIndicator',
  },
}));
jest.mock('@offgrid/core/bootstrap/hookRegistry', () => ({
  HOOKS: {
    onboardingAdditionalSlides: 'onboarding.additionalSlides',
    clipboardRecordLocalText: 'clipboard.recordLocalText',
  },
}));

jest.mock('../../pro/mcp/McpToolExtension', () => ({
  McpToolExtension: { id: 'mcp' },
}));
jest.mock('../../pro/tools/EmailCalendarExtension', () => ({
  EmailCalendarExtension: { id: 'email-calendar' },
  setEmailCalendarEntitlementActive: mockEmailCalendarEntitlement,
}));
jest.mock('../../pro/audio', () => ({
  activateAudio: (options: {
    registerScreen: (screen: {
      name: string;
      component: () => null;
    }) => () => void;
    registerSlot: (name: string, component: () => null) => () => void;
    registerHook: (name: string, hook: () => void) => () => void;
  }) => {
    const disposeScreen = options.registerScreen({
      name: 'AudioSettings',
      component: () => null,
    });
    const disposeSlot = options.registerSlot('audio.slot', () => null);
    const disposeHook = options.registerHook('audio.hook', () => undefined);
    return () => {
      disposeHook();
      disposeSlot();
      disposeScreen();
      mockAudioCleanup();
    };
  },
}));

for (const modulePath of [
  '../../pro/ui/AutoSetupVoiceIndicator',
  '../../pro/ui/McpServersScreen',
  '../../pro/ui/McpToolsScreen',
  '../../pro/ui/McpGuideScreen',
  '../../pro/ui/SyncScreen',
  '../../pro/ui/SyncScreen/SyncSharingSettingsScreen',
  '../../pro/ui/SyncScreen/SyncActivityScreen',
  '../../pro/ui/SyncScreen/SyncFilesScreen',
  '../../pro/ui/ClipboardScreen',
  '../../pro/ui/SyncHomeCard',
  '../../pro/ui/HomeNotificationsButton',
  '../../pro/ui/SyncNotificationsScreen',
  '../../pro/ui/ProRoot',
]) {
  jest.mock(modulePath, () => new Proxy({}, { get: () => () => null }));
}

jest.mock('../../pro/mcp/mcpStore', () => ({
  useMcpStore: {
    getState: () => ({ servers: [{ id: 'server-1' }] }),
    persist: { hasHydrated: () => true, onFinishHydration: jest.fn() },
  },
}));
jest.mock('../../pro/mcp/mcpService', () => ({
  disconnectServer: mockDisconnectServer,
  reconnectSavedServers: jest.fn(async () => undefined),
}));
jest.mock('../../pro/mcp/mcpToolGrantService', () => ({
  initConnectedToolGrantRefresh: () => mockGrantRefreshCleanup,
  initMcpToolGrants: () => mockGrantCleanup,
  initToolGrantReconcile: () => mockReconcileCleanup,
}));
jest.mock('../../pro/mcp/companionTaskMesh', () => ({
  initCompanionTaskMesh: () => mockCompanionTaskCleanup,
}));

jest.mock('../../pro/sync/syncService', () => ({
  syncService: {
    prepareActivation: jest.fn(async () => undefined),
    start: jest.fn(async () => undefined),
    onAppMessage: jest.fn(() => jest.fn()),
    onDisconnected: jest.fn(() => jest.fn()),
    connectedDeviceIds: jest.fn(() => []),
    thisDeviceId: jest.fn(() => undefined),
    sendApp: jest.fn(() => false),
  },
}));
jest.mock('../../pro/sync/modelTransferService', () => ({
  modelTransferService: { start: jest.fn() },
}));
jest.mock('../../pro/sync/stateSyncService', () => ({
  stateSyncService: {
    start: jest.fn(async () => undefined),
    recordMutation: jest.fn(),
    stageMutation: jest.fn(),
    sendSharedFileRecord: jest.fn(),
  },
}));
jest.mock('../../pro/sync/clipboardSyncService', () => ({
  clipboardSyncService: {
    start: jest.fn(async () => undefined),
    setEntitlementActive: mockClipboardEntitlement,
    recordLocalText: jest.fn(async () => undefined),
  },
}));
jest.mock('../../pro/sync/chatStreamService', () => ({
  chatStreamService: {
    start: jest.fn(async () => undefined),
    discardConversation: jest.fn(),
  },
}));
jest.mock('../../pro/sync/knowledgeDocumentSyncService', () => ({
  knowledgeDocumentSyncService: {
    start: jest.fn(),
    handleLocalMutation: jest.fn(async () => undefined),
  },
}));
jest.mock('../../pro/sync/sharedFileSyncService', () => ({
  sharedFileSyncService: { start: jest.fn(async () => undefined) },
}));
jest.mock('../../pro/sync/fileTransferService', () => ({
  fileTransferService: { loadHistory: jest.fn(async () => undefined) },
}));
jest.mock('../../pro/sync/fileCompletionNotificationService', () => ({
  fileCompletionNotificationService: { start: jest.fn(async () => undefined) },
}));
jest.mock('../../pro/sync/entitlementActivation', () => ({
  setEntitlementImportedHandler: jest.fn(),
}));
jest.mock('../../pro/licensing/proLicenseProvider', () => ({
  proLicenseProvider: {},
  onProLicenseInfoChanged: jest.fn(
    (listener: (info: { isPro: boolean }) => void) => {
      mockLicenseInfoListener = listener;
      return jest.fn();
    },
  ),
}));

describe('the paid mobile runtime after live entitlement loss', () => {
  it('removes paid surfaces and stops paid work in the same process', async () => {
    const disposeByScreen = new Map<string, jest.Mock>();
    const disposeBySlot = new Map<string, jest.Mock>();
    const disposeByHook = new Map<string, jest.Mock>();
    const toolDisposers: jest.Mock[] = [];
    const options = {
      registerToolExtension: jest.fn(() => {
        const dispose = jest.fn();
        toolDisposers.push(dispose);
        return dispose;
      }),
      registerScreen: jest.fn((screen: { name: string }) => {
        const dispose = jest.fn();
        disposeByScreen.set(screen.name, dispose);
        return dispose;
      }),
      registerSettingsSection: jest.fn(() => jest.fn()),
      registerSlot: jest.fn((name: string) => {
        const dispose = jest.fn();
        disposeBySlot.set(name, dispose);
        return dispose;
      }),
      registerHook: jest.fn((name: string) => {
        const dispose = jest.fn();
        disposeByHook.set(name, dispose);
        return dispose;
      }),
    };
    const pro = require('../../pro') as typeof import('../../pro');

    pro.configureProEntitlementProvider(jest.fn());
    expect(options.registerSlot).not.toHaveBeenCalledWith(
      'autoSetup.voiceIndicator',
      expect.anything(),
    );
    pro.activate(options as Parameters<typeof pro.activate>[0]);
    expect(options.registerSlot).toHaveBeenCalledWith(
      'message.taskToolDetail',
      expect.any(Function),
    );
    expect(options.registerSlot).toHaveBeenCalledWith(
      'autoSetup.voiceIndicator',
      expect.any(Function),
    );
    expect(mockClipboardEntitlement).toHaveBeenLastCalledWith(true);
    expect(mockEmailCalendarEntitlement).toHaveBeenLastCalledWith(true);

    mockLicenseInfoListener?.({ isPro: false });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(mockClipboardEntitlement).toHaveBeenLastCalledWith(false);
    expect(mockEmailCalendarEntitlement).toHaveBeenLastCalledWith(false);
    expect(toolDisposers).toHaveLength(2);
    expect(
      toolDisposers.every(dispose => dispose.mock.calls.length === 1),
    ).toBe(true);
    expect(disposeByScreen.get('McpServers')).toHaveBeenCalledTimes(1);
    expect(disposeByScreen.get('McpTools')).toHaveBeenCalledTimes(1);
    expect(disposeByScreen.get('McpGuide')).toHaveBeenCalledTimes(1);
    expect(disposeByScreen.get('AudioSettings')).toHaveBeenCalledTimes(1);
    expect(disposeBySlot.get('app.root')).toHaveBeenCalledTimes(1);
    expect(disposeBySlot.get('autoSetup.voiceIndicator')).toHaveBeenCalledTimes(
      1,
    );
    expect(disposeBySlot.get('audio.slot')).toHaveBeenCalledTimes(1);
    expect(disposeByHook.get('audio.hook')).toHaveBeenCalledTimes(1);
    expect(mockAudioCleanup).toHaveBeenCalledTimes(1);
    expect(mockGrantCleanup).toHaveBeenCalledTimes(1);
    expect(mockGrantRefreshCleanup).toHaveBeenCalledTimes(1);
    expect(mockCompanionTaskCleanup).toHaveBeenCalledTimes(1);
    expect(mockReconcileCleanup).toHaveBeenCalledTimes(1);
    expect(mockDisconnectServer).toHaveBeenCalledWith('server-1');

    // Entitlement-recovery Sync stays registered so the user can reactivate.
    expect(disposeByScreen.get('Sync')).not.toHaveBeenCalled();
  });
});
