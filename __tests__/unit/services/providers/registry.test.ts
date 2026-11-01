/**
 * ProviderRegistry — which provider answers a chat (the local model or a server's).
 *
 * Real: the registry, the local provider it starts with, the logger. The server providers registered here
 * are plain records: the registry only stores and hands them back, it never calls them.
 */
import { providerRegistry, getProviderForServer } from '../../../../src/services/providers/registry';
import { localProvider } from '../../../../src/services/providers/localProvider';

function makeProvider(id: string) {
  return { id, type: 'remote' as any };
}

describe('ProviderRegistry', () => {
  beforeEach(() => {
    // Reset to clean state: clear all non-local providers
    providerRegistry.clear();
  });

  describe('registerProvider / hasProvider / getProvider', () => {
    it('registers and retrieves a provider', () => {
      const p = makeProvider('server-1');
      providerRegistry.registerProvider('server-1', p as any);
      expect(providerRegistry.hasProvider('server-1')).toBe(true);
      expect(providerRegistry.getProvider('server-1')).toBe(p);
    });

    it('returns undefined for unknown provider', () => {
      expect(providerRegistry.getProvider('nonexistent')).toBeUndefined();
    });

    it('always has local provider after clear', () => {
      expect(providerRegistry.hasProvider('local')).toBe(true);
    });
  });

  describe('unregisterProvider', () => {
    it('removes a registered provider', () => {
      const p = makeProvider('server-2');
      providerRegistry.registerProvider('server-2', p as any);
      providerRegistry.unregisterProvider('server-2');
      expect(providerRegistry.hasProvider('server-2')).toBe(false);
    });

    it('does not remove local provider', () => {
      providerRegistry.unregisterProvider('local');
      expect(providerRegistry.hasProvider('local')).toBe(true);
    });

    it('resets active provider to local when active provider is unregistered', () => {
      const p = makeProvider('server-3');
      providerRegistry.registerProvider('server-3', p as any);
      providerRegistry.setActiveProvider('server-3');
      expect(providerRegistry.getActiveProviderId()).toBe('server-3');
      providerRegistry.unregisterProvider('server-3');
      expect(providerRegistry.getActiveProviderId()).toBe('local');
    });
  });

  describe('setActiveProvider / getActiveProvider', () => {
    it('sets active provider and returns it', () => {
      const p = makeProvider('server-4');
      providerRegistry.registerProvider('server-4', p as any);
      const success = providerRegistry.setActiveProvider('server-4');
      expect(success).toBe(true);
      expect(providerRegistry.getActiveProviderId()).toBe('server-4');
    });

    it('returns false when setting unknown provider as active', () => {
      const result = providerRegistry.setActiveProvider('nonexistent');
      expect(result).toBe(false);
    });

    it('falls back to localProvider when active provider is not found', () => {
      // Force an inconsistent state: activeProviderId points to a missing provider
      (providerRegistry as any).activeProviderId = 'missing-provider';
      const active = providerRegistry.getActiveProvider();
      expect(active).toBe(localProvider);
    });
  });

  describe('getProviderIds', () => {
    it('returns all registered provider IDs including local', () => {
      providerRegistry.registerProvider('server-5', makeProvider('server-5') as any);
      const ids = providerRegistry.getProviderIds();
      expect(ids).toContain('local');
      expect(ids).toContain('server-5');
    });
  });

  describe('subscribe / listeners', () => {
    it('notifies listeners when active provider changes', () => {
      const listener = jest.fn();
      const unsubscribe = providerRegistry.subscribe(listener);
      const p = makeProvider('server-6');
      providerRegistry.registerProvider('server-6', p as any);
      providerRegistry.setActiveProvider('server-6');
      expect(listener).toHaveBeenCalledWith('server-6');
      unsubscribe();
    });

    it('stops notifying after unsubscribe', () => {
      const listener = jest.fn();
      const unsubscribe = providerRegistry.subscribe(listener);
      unsubscribe();
      const p = makeProvider('server-7');
      providerRegistry.registerProvider('server-7', p as any);
      providerRegistry.setActiveProvider('server-7');
      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies with null when active provider is local', () => {
      const listener = jest.fn();
      providerRegistry.subscribe(listener);
      providerRegistry.clear(); // triggers notifyListeners with local active
      expect(listener).toHaveBeenCalledWith(null);
    });
  });

  describe('clear', () => {
    it('removes all non-local providers', () => {
      providerRegistry.registerProvider('a', makeProvider('a') as any);
      providerRegistry.registerProvider('b', makeProvider('b') as any);
      providerRegistry.clear();
      expect(providerRegistry.hasProvider('a')).toBe(false);
      expect(providerRegistry.hasProvider('b')).toBe(false);
      expect(providerRegistry.hasProvider('local')).toBe(true);
    });

    it('resets active provider to local', () => {
      const p = makeProvider('server-8');
      providerRegistry.registerProvider('server-8', p as any);
      providerRegistry.setActiveProvider('server-8');
      providerRegistry.clear();
      expect(providerRegistry.getActiveProviderId()).toBe('local');
    });
  });
});

describe('getProviderForServer', () => {
  beforeEach(() => {
    providerRegistry.clear();
  });

  it('returns localProvider when serverId is null', () => {
    expect(getProviderForServer(null)).toBe(localProvider);
  });

  it('returns registered provider when found', () => {
    const p = makeProvider('s1');
    providerRegistry.registerProvider('s1', p as any);
    expect(getProviderForServer('s1')).toBe(p);
  });

  it('falls back to localProvider when server has no registered provider', () => {
    expect(getProviderForServer('nonexistent-server')).toBe(localProvider);
  });
});
