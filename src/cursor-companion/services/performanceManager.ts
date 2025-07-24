import * as vscode from 'vscode';
import { IDataStorage } from './interfaces';
import { ConfigurationManager } from './configurationManager';

/**
 * Manages performance optimization and resource management
 */
export class PerformanceManager {
  private static instance: PerformanceManager;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private memoryMonitorInterval: NodeJS.Timeout | null = null;
  private readonly memoryThreshold = 100 * 1024 * 1024; // 100MB
  private readonly cleanupIntervalMs = 60 * 60 * 1000; // 1 hour
  private readonly memoryCheckIntervalMs = 5 * 60 * 1000; // 5 minutes

  private constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage,
    private configManager: ConfigurationManager
  ) {
    this.startPerformanceMonitoring();
  }

  public static getInstance(
    context: vscode.ExtensionContext,
    dataStorage: IDataStorage,
    configManager: ConfigurationManager
  ): PerformanceManager {
    if (!PerformanceManager.instance) {
      PerformanceManager.instance = new PerformanceManager(context, dataStorage, configManager);
    }
    return PerformanceManager.instance;
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    const config = this.configManager.getConfiguration();
    
    if (config.performanceMonitoring) {
      // Start memory monitoring
      this.memoryMonitorInterval = setInterval(() => {
        this.checkMemoryUsage();
      }, this.memoryCheckIntervalMs);

      // Start cleanup interval
      this.cleanupInterval = setInterval(() => {
        this.performCleanup();
      }, this.cleanupIntervalMs);

      // Listen for configuration changes
      this.configManager.onConfigurationChanged((newConfig) => {
        if (!newConfig.performanceMonitoring && this.memoryMonitorInterval) {
          clearInterval(this.memoryMonitorInterval);
          this.memoryMonitorInterval = null;
        } else if (newConfig.performanceMonitoring && !this.memoryMonitorInterval) {
          this.memoryMonitorInterval = setInterval(() => {
            this.checkMemoryUsage();
          }, this.memoryCheckIntervalMs);
        }
      });
    }
  }

  /**
   * Check memory usage and trigger cleanup if needed
   */
  private checkMemoryUsage(): void {
    const memoryUsage = process.memoryUsage();
    
    if (memoryUsage.heapUsed > this.memoryThreshold) {
      console.log(`Memory usage high: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB, triggering cleanup`);
      this.performCleanup();
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    }
  }

  /**
   * Perform cleanup operations
   */
  private async performCleanup(): Promise<void> {
    try {
      const config = this.configManager.getConfiguration();
      
      // Clean up old conversations
      await this.cleanupOldConversations(config.maxConversations);
      
      // Clean up old snapshots
      await this.cleanupOldSnapshots(config.snapshotRetention);
      
      // Clean up old backups
      await this.cleanupOldBackups(config.maxBackups);
      
      // Clean up storage caches
      await this.cleanupStorageCaches();
      
      console.log('Performance cleanup completed');
    } catch (error) {
      console.error('Performance cleanup failed:', error);
    }
  }

  /**
   * Clean up old conversations
   */
  private async cleanupOldConversations(maxConversations: number): Promise<void> {
    try {
      const conversations = await this.dataStorage.getConversations();
      
      if (conversations.length > maxConversations) {
        // Sort by timestamp and keep only the most recent
        const sortedConversations = conversations.sort((a, b) => b.timestamp - a.timestamp);
        const conversationsToDelete = sortedConversations.slice(maxConversations);
        
        for (const conversation of conversationsToDelete) {
          if (conversation.status !== 'archived') {
            await this.dataStorage.archiveConversation(conversation.id);
          }
        }
        
        console.log(`Archived ${conversationsToDelete.length} old conversations`);
      }
    } catch (error) {
      console.error('Failed to cleanup old conversations:', error);
    }
  }

  /**
   * Clean up old snapshots
   */
  private async cleanupOldSnapshots(retentionDays: number): Promise<void> {
    try {
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      await this.dataStorage.cleanup(retentionDays);
      console.log(`Cleaned up snapshots older than ${retentionDays} days`);
    } catch (error) {
      console.error('Failed to cleanup old snapshots:', error);
    }
  }

  /**
   * Clean up old backups
   */
  private async cleanupOldBackups(maxBackups: number): Promise<void> {
    // This would need to be implemented in the backup manager
    // For now, just log the intent
    console.log(`Would cleanup old backups, keeping ${maxBackups} most recent`);
  }

  /**
   * Clean up storage caches
   */
  private async cleanupStorageCaches(): Promise<void> {
    try {
      // Clear any in-memory caches in the storage layer
      if (typeof (this.dataStorage as any).clearCaches === 'function') {
        await (this.dataStorage as any).clearCaches();
      }
    } catch (error) {
      console.error('Failed to cleanup storage caches:', error);
    }
  }

  /**
   * Implement pagination for conversation loading
   */
  async getConversationsPaginated(
    page: number = 0,
    pageSize: number = 50,
    filter?: any
  ): Promise<PaginatedResult<any>> {
    try {
      const allConversations = await this.dataStorage.getConversations(filter);
      const totalCount = allConversations.length;
      const startIndex = page * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalCount);
      
      const conversations = allConversations.slice(startIndex, endIndex);
      
      return {
        items: conversations,
        totalCount,
        page,
        pageSize,
        hasMore: endIndex < totalCount
      };
    } catch (error) {
      console.error('Failed to get paginated conversations:', error);
      return {
        items: [],
        totalCount: 0,
        page,
        pageSize,
        hasMore: false
      };
    }
  }

  /**
   * Implement lazy loading for messages
   */
  async getMessagesLazy(
    conversationId: string,
    offset: number = 0,
    limit: number = 20
  ): Promise<LazyLoadResult<any>> {
    try {
      const allMessages = await this.dataStorage.getMessages(conversationId);
      const totalCount = allMessages.length;
      
      // Sort messages by timestamp
      const sortedMessages = allMessages.sort((a, b) => a.timestamp - b.timestamp);
      
      // Get the requested slice
      const messages = sortedMessages.slice(offset, offset + limit);
      
      return {
        items: messages,
        offset,
        limit,
        totalCount,
        hasMore: offset + limit < totalCount
      };
    } catch (error) {
      console.error('Failed to get lazy loaded messages:', error);
      return {
        items: [],
        offset,
        limit,
        totalCount: 0,
        hasMore: false
      };
    }
  }

  /**
   * Implement caching for frequently accessed data
   */
  private cache = new Map<string, CacheEntry>();
  private readonly cacheMaxSize = 100;
  private readonly cacheMaxAge = 5 * 60 * 1000; // 5 minutes

  async getCachedData<T>(
    key: string,
    fetcher: () => Promise<T>,
    maxAge: number = this.cacheMaxAge
  ): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key);
    
    // Return cached data if it's still valid
    if (cached && (now - cached.timestamp) < maxAge) {
      return cached.data as T;
    }
    
    // Fetch new data
    const data = await fetcher();
    
    // Store in cache
    this.cache.set(key, {
      data,
      timestamp: now
    });
    
    // Clean up cache if it's too large
    if (this.cache.size > this.cacheMaxSize) {
      this.cleanupCache();
    }
    
    return data;
  }

  /**
   * Clean up cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    
    // Remove expired entries
    for (const [key, entry] of entries) {
      if (now - entry.timestamp > this.cacheMaxAge) {
        this.cache.delete(key);
      }
    }
    
    // If still too large, remove oldest entries
    if (this.cache.size > this.cacheMaxSize) {
      const sortedEntries = entries
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, this.cache.size - this.cacheMaxSize);
      
      for (const [key] of sortedEntries) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Implement debounced operations
   */
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  debounce<T extends (...args: any[]) => any>(
    key: string,
    func: T,
    delay: number = 300
  ): (...args: Parameters<T>) => void {
    return (...args: Parameters<T>) => {
      // Clear existing timer
      const existingTimer = this.debounceTimers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      
      // Set new timer
      const timer = setTimeout(() => {
        func(...args);
        this.debounceTimers.delete(key);
      }, delay);
      
      this.debounceTimers.set(key, timer);
    };
  }

  /**
   * Implement throttled operations
   */
  private throttleTimers = new Map<string, { lastCall: number; timer?: NodeJS.Timeout }>();

  throttle<T extends (...args: any[]) => any>(
    key: string,
    func: T,
    delay: number = 1000
  ): (...args: Parameters<T>) => void {
    return (...args: Parameters<T>) => {
      const now = Date.now();
      const throttleInfo = this.throttleTimers.get(key);
      
      if (!throttleInfo || now - throttleInfo.lastCall >= delay) {
        // Execute immediately
        func(...args);
        this.throttleTimers.set(key, { lastCall: now });
      } else {
        // Schedule for later
        if (throttleInfo.timer) {
          clearTimeout(throttleInfo.timer);
        }
        
        const remainingDelay = delay - (now - throttleInfo.lastCall);
        throttleInfo.timer = setTimeout(() => {
          func(...args);
          this.throttleTimers.set(key, { lastCall: Date.now() });
        }, remainingDelay);
      }
    };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const memoryUsage = process.memoryUsage();
    
    return {
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss
      },
      cache: {
        size: this.cache.size,
        maxSize: this.cacheMaxSize,
        hitRate: this.calculateCacheHitRate()
      },
      cleanup: {
        lastCleanup: this.getLastCleanupTime(),
        nextCleanup: this.getNextCleanupTime()
      }
    };
  }

  /**
   * Calculate cache hit rate
   */
  private cacheHits = 0;
  private cacheMisses = 0;

  private calculateCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total > 0 ? this.cacheHits / total : 0;
  }

  /**
   * Get last cleanup time
   */
  private getLastCleanupTime(): number {
    return this.context.globalState.get('lastCleanupTime', 0);
  }

  /**
   * Get next cleanup time
   */
  private getNextCleanupTime(): number {
    const lastCleanup = this.getLastCleanupTime();
    return lastCleanup + this.cleanupIntervalMs;
  }

  /**
   * Force cleanup
   */
  async forceCleanup(): Promise<void> {
    await this.performCleanup();
    await this.context.globalState.update('lastCleanupTime', Date.now());
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
      this.memoryMonitorInterval = null;
    }
    
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    // Clear all throttle timers
    for (const throttleInfo of this.throttleTimers.values()) {
      if (throttleInfo.timer) {
        clearTimeout(throttleInfo.timer);
      }
    }
    this.throttleTimers.clear();
    
    this.clearCaches();
  }
}

// Types and interfaces

export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface LazyLoadResult<T> {
  items: T[];
  offset: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
}

export interface CacheEntry {
  data: any;
  timestamp: number;
}

export interface PerformanceMetrics {
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cache: {
    size: number;
    maxSize: number;
    hitRate: number;
  };
  cleanup: {
    lastCleanup: number;
    nextCleanup: number;
  };
}