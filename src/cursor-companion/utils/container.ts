/**
 * Simple service container for Cursor Companion
 */
export class ServiceContainer {
  private services = new Map<string, any>();

  constructor(private context: any) {}

  /**
   * Register a service instance
   */
  register<T>(name: string, instance: T): void {
    this.services.set(name, instance);
  }

  /**
   * Get a service instance
   */
  get<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service '${name}' not found in container`);
    }
    return service;
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Get the extension context
   */
  getContext(): any {
    return this.context;
  }

  /**
   * Clear all services
   */
  clear(): void {
    this.services.clear();
  }
}

