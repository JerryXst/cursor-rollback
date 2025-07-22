/**
 * Service locator pattern for easy access to services
 */

import { container, ServiceRegistry } from './container';
import { 
  IConversationTracker, 
  IDataStorage, 
  IRollbackManager, 
  IUIManager 
} from '../services/interfaces';
import { SERVICE_NAMES } from './constants';

/**
 * Service locator for accessing registered services
 */
export class ServiceLocator {
  private static registry: ServiceRegistry;

  /**
   * Initialize the service locator with a registry
   */
  static initialize(registry: ServiceRegistry): void {
    this.registry = registry;
  }

  /**
   * Get the data storage service
   */
  static getDataStorage(): IDataStorage {
    return this.registry.getService<IDataStorage>(SERVICE_NAMES.DATA_STORAGE);
  }

  /**
   * Get the conversation tracker service
   */
  static getConversationTracker(): IConversationTracker {
    return this.registry.getService<IConversationTracker>(SERVICE_NAMES.CONVERSATION_TRACKER);
  }

  /**
   * Get the rollback manager service
   */
  static getRollbackManager(): IRollbackManager {
    return this.registry.getService<IRollbackManager>(SERVICE_NAMES.ROLLBACK_MANAGER);
  }

  /**
   * Get the UI manager service
   */
  static getUIManager(): IUIManager {
    return this.registry.getService<IUIManager>(SERVICE_NAMES.UI_MANAGER);
  }

  /**
   * Get the VSCode extension context
   */
  static getContext(): any {
    return this.registry.getService(SERVICE_NAMES.CONTEXT);
  }

  /**
   * Check if a service is available
   */
  static hasService(serviceName: string): boolean {
    return this.registry.hasService(serviceName);
  }

  /**
   * Get any service by name
   */
  static getService<T>(serviceName: string): T {
    return this.registry.getService<T>(serviceName);
  }
}

/**
 * Convenience functions for accessing services
 */
export const Services = {
  get dataStorage(): IDataStorage {
    return ServiceLocator.getDataStorage();
  },

  get conversationTracker(): IConversationTracker {
    return ServiceLocator.getConversationTracker();
  },

  get rollbackManager(): IRollbackManager {
    return ServiceLocator.getRollbackManager();
  },

  get uiManager(): IUIManager {
    return ServiceLocator.getUIManager();
  },

  get context(): any {
    return ServiceLocator.getContext();
  }
};