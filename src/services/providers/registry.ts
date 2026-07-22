/**
 * Provider Registry
 *
 * Singleton registry that manages LLM providers and routes requests
 * to the correct provider based on provider ID.
 */

import type { LLMProvider } from './types';
import { localProvider } from './localProvider';
import logger from '../../utils/logger';

type ProviderChangeListener = (providerId: string | null) => void;

class ProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();
  private activeProviderId: string = 'local';
  private listeners: Set<ProviderChangeListener> = new Set();

  constructor() {
    // Register the local provider by default
    this.registerProvider('local', localProvider);
  }

  /**
   * Register a new provider
   */
  registerProvider(id: string, provider: LLMProvider): void {
    this.providers.set(id, provider);
    logger.log('[ProviderRegistry] Registered provider:', id);
  }

  /**
   * Unregister a provider
   */
  unregisterProvider(id: string): void {
    if (id === 'local') {
      logger.warn('[ProviderRegistry] Cannot unregister local provider');
      return;
    }

    this.providers.delete(id);
    logger.log('[ProviderRegistry] Unregistered provider:', id);

    // If this was the active provider, switch back to local
    if (this.activeProviderId === id) {
      this.activeProviderId = 'local';
      this.notifyListeners();
    }
  }

  /**
   * Get a provider by ID
   */
  getProvider(id: string): LLMProvider | undefined {
    const provider = this.providers.get(id);
    logger.log(
      '[ProviderRegistry] getProvider:',
      id,
      'found:',
      !!provider,
      'providerIds:',
      this.getProviderIds(),
    );
    return provider;
  }

  /**
   * Get the currently active provider
   */
  getActiveProvider(): LLMProvider {
    const provider = this.providers.get(this.activeProviderId);
    if (!provider) {
      logger.warn(
        '[ProviderRegistry] Active provider not found, falling back to local',
      );
      return localProvider;
    }
    return provider;
  }

  /**
   * Get the active provider ID
   */
  getActiveProviderId(): string {
    return this.activeProviderId;
  }

  /**
   * Set the active provider by ID
   */
  setActiveProvider(id: string): boolean {
    if (!this.providers.has(id)) {
      logger.warn('[ProviderRegistry] Provider not found:', id);
      return false;
    }

    this.activeProviderId = id;
    this.notifyListeners();
    logger.log('[ProviderRegistry] Active provider set to:', id);
    return true;
  }

  /**
   * Check if a provider exists
   */
  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  /**
   * Get all registered provider IDs
   */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Subscribe to provider changes
   */
  subscribe(listener: ProviderChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify listeners of provider change
   */
  private notifyListeners(): void {
    const providerId =
      this.activeProviderId === 'local' ? null : this.activeProviderId;
    this.listeners.forEach(listener => listener(providerId));
  }

  /**
   * Clear all providers except local
   */
  clear(): void {
    // Keep only local provider
    const localProv = this.providers.get('local');
    this.providers.clear();
    if (localProv) {
      this.providers.set('local', localProv);
    }
    this.activeProviderId = 'local';
    this.notifyListeners();
  }
}

/** Singleton instance */
export const providerRegistry = new ProviderRegistry();
