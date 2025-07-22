/**
 * Simple dependency injection container for Cursor Companion
 */

type Constructor<T = {}> = new (...args: any[]) => T;
type Factory<T> = () => T;
type ServiceDefinition<T> = Constructor<T> | Factory<T> | T;

export class Container {
  private services = new Map<string, any>();
  private singletons = new Map<string, any>();

  /**
   * Register a service with the container
   */
  register<T>(name: string, definition: ServiceDefinition<T>, singleton: boolean = true): void {
    this.services.set(name, { definition, singleton });
  }

  /**
   * Resolve a service from the container
   */
  resolve<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service '${name}' not found in container`);
    }

    // Return singleton instance if it exists
    if (service.singleton && this.singletons.has(name)) {
      return this.singletons.get(name);
    }

    let instance: T;

    if (typeof service.definition === 'function') {
      // Check if it's a constructor or factory function
      if (this.isConstructor(service.definition)) {
        instance = new (service.definition as Constructor<T>)();
      } else {
        instance = (service.definition as Factory<T>)();
      }
    } else {
      // Direct instance
      instance = service.definition;
    }

    // Store singleton instance
    if (service.singleton) {
      this.singletons.set(name, instance);
    }

    return instance;
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Remove a service from the container
   */
  unregister(name: string): void {
    this.services.delete(name);
    this.singletons.delete(name);
  }

  /**
   * Clear all services
   */
  clear(): void {
    this.services.clear();
    this.singletons.clear();
  }

  /**
   * Get all registered service names
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  private isConstructor(func: any): boolean {
    try {
      // Try to call with 'new' - if it throws, it's likely not a constructor
      const test = new func();
      return true;
    } catch (error) {
      // Check if the function has a prototype property (constructors do)
      return func.prototype !== undefined;
    }
  }
}

/**
 * Global container instance
 */
export const container = new Container();

/**
 * Decorator for registering services
 */
export function Injectable(name: string, singleton: boolean = true) {
  return function <T extends Constructor>(target: T) {
    container.register(name, target, singleton);
    return target;
  };
}

/**
 * Service registration helper
 */
export class ServiceRegistry {
  constructor(private container: Container) {}

  /**
   * Register all core services
   */
  registerCoreServices(context: any): void {
    // Register VSCode extension context
    this.container.register('context', context, true);
    
    // Register service factories - these will be instantiated when first requested
    this.registerServiceFactories();
  }

  /**
   * Register service factories for lazy initialization
   */
  private registerServiceFactories(): void {
    // Data Storage Service
    this.container.register('dataStorage', () => {
      const { DataStorage } = require('../services/dataStorage');
      return new DataStorage();
    }, true);

    // Conversation Tracker Service
    this.container.register('conversationTracker', () => {
      const { ConversationTracker } = require('../services/conversationTracker');
      const dataStorage = this.container.resolve('dataStorage');
      return new ConversationTracker(dataStorage);
    }, true);

    // Rollback Manager Service
    this.container.register('rollbackManager', () => {
      const { RollbackManager } = require('../services/rollbackManager');
      const dataStorage = this.container.resolve('dataStorage');
      return new RollbackManager(dataStorage);
    }, true);

    // UI Manager Service
    this.container.register('uiManager', () => {
      const { UIManager } = require('../ui/uiManager');
      const context = this.container.resolve('context');
      const conversationTracker = this.container.resolve('conversationTracker');
      const rollbackManager = this.container.resolve('rollbackManager');
      return new UIManager(context, conversationTracker, rollbackManager);
    }, true);
  }

  /**
   * Initialize all registered services
   */
  async initializeServices(): Promise<void> {
    const serviceNames = this.container.getServiceNames().filter(name => name !== 'context');
    
    // Initialize services in dependency order
    const initOrder = ['dataStorage', 'conversationTracker', 'rollbackManager', 'uiManager'];
    
    for (const serviceName of initOrder) {
      if (serviceNames.includes(serviceName)) {
        try {
          const service = this.container.resolve(serviceName) as any;
          
          // Call initialize method if it exists
          if (service && typeof service.initialize === 'function') {
            await service.initialize();
          }
        } catch (error) {
          console.error(`Failed to initialize service '${serviceName}':`, error);
          throw error; // Re-throw to prevent partial initialization
        }
      }
    }
  }

  /**
   * Cleanup all services
   */
  cleanup(): void {
    const serviceNames = this.container.getServiceNames().filter(name => name !== 'context');
    
    // Cleanup in reverse order
    const cleanupOrder = ['uiManager', 'rollbackManager', 'conversationTracker', 'dataStorage'];
    
    for (const serviceName of cleanupOrder) {
      if (serviceNames.includes(serviceName)) {
        try {
          const service = this.container.resolve(serviceName) as any;
          
          // Call cleanup/dispose method if it exists
          if (service && typeof service.dispose === 'function') {
            service.dispose();
          } else if (service && typeof service.cleanup === 'function') {
            service.cleanup();
          }
        } catch (error) {
          console.error(`Failed to cleanup service '${serviceName}':`, error);
        }
      }
    }
    
    this.container.clear();
  }

  /**
   * Get a service instance
   */
  getService<T>(name: string): T {
    return this.container.resolve<T>(name);
  }

  /**
   * Check if a service is registered
   */
  hasService(name: string): boolean {
    return this.container.has(name);
  }
}