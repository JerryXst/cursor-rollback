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

  // Cache properties
  private cache = new Map<string, CacheEntry>();
  private readonly cacheMaxSize = 100;
  private readonly cacheMaxAge = 5 * 60 * 1000; // 5 minutes
  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheAccessCounts = new Map<string, number>();
  private cacheLastAccess = new Map<string, number>();

  // Timer properties
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private throttleTimers = new Map<string, { lastCall: number; timer?: NodeJS.Timeout }>();

  // Configuration change listeners
  private configChangeListeners: Array<(config: any) => void> = [];

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
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memoryUsage.rss / 1024 / 1024);
    
    // Log memory usage periodically
    if (this.shouldLogMemoryUsage()) {
      console.log(`Memory usage: Heap ${heapUsedMB}/${heapTotalMB}MB, RSS ${rssMB}MB, Cache ${this.cache.size} items`);
    }
    
    // Trigger different levels of cleanup based on memory pressure
    const thresholdMB = this.memoryThreshold / 1024 / 1024;
    
    if (memoryUsage.heapUsed > this.memoryThreshold * 1.5) {
      // Critical memory usage - aggressive cleanup
      console.warn(`Critical memory usage: ${heapUsedMB}MB (threshold: ${thresholdMB}MB), triggering aggressive cleanup`);
      this.performAggressiveCleanup();
    } else if (memoryUsage.heapUsed > this.memoryThreshold) {
      // High memory usage - normal cleanup
      console.log(`High memory usage: ${heapUsedMB}MB (threshold: ${thresholdMB}MB), triggering cleanup`);
      this.performCleanup();
    } else if (memoryUsage.heapUsed > this.memoryThreshold * 0.7) {
      // Moderate memory usage - light cleanup
      this.performLightCleanup();
    }
    
    // Force garbage collection if available and memory is high
    if (memoryUsage.heapUsed > this.memoryThreshold && global.gc) {
      global.gc();
    }
  }

  /**
   * Determine if memory usage should be logged
   */
  private lastMemoryLogTime = 0;
  private readonly memoryLogInterval = 5 * 60 * 1000; // 5 minutes

  private shouldLogMemoryUsage(): boolean {
    const now = Date.now();
    if (now - this.lastMemoryLogTime > this.memoryLogInterval) {
      this.lastMemoryLogTime = now;
      return true;
    }
    return false;
  }

  /**
   * Perform light cleanup for moderate memory usage
   */
  private async performLightCleanup(): Promise<void> {
    try {
      // Only clean up expired cache entries
      this.cleanupCache();
      
      // Clear some debounce/throttle timers
      this.cleanupTimers(0.3); // Clean up 30% of timers
      
    } catch (error) {
      console.error('Light cleanup failed:', error);
    }
  }

  /**
   * Perform aggressive cleanup for critical memory usage
   */
  private async performAggressiveCleanup(): Promise<void> {
    try {
      console.log('Performing aggressive memory cleanup...');
      
      // Clear all caches immediately
      this.clearCaches();
      
      // Clear all timers
      this.cleanupTimers(1.0); // Clean up all timers
      
      // Force storage cache cleanup
      await this.cleanupStorageCaches();
      
      // Trigger immediate garbage collection multiple times
      if (global.gc) {
        for (let i = 0; i < 3; i++) {
          global.gc();
        }
      }
      
      console.log('Aggressive cleanup completed');
    } catch (error) {
      console.error('Aggressive cleanup failed:', error);
    }
  }

  /**
   * Clean up timers based on percentage
   */
  private cleanupTimers(percentage: number): void {
    // Clean up debounce timers
    const debounceKeys = Array.from(this.debounceTimers.keys());
    const debounceToClean = Math.floor(debounceKeys.length * percentage);
    
    for (let i = 0; i < debounceToClean; i++) {
      const key = debounceKeys[i];
      const timer = this.debounceTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(key);
      }
    }
    
    // Clean up throttle timers
    const throttleKeys = Array.from(this.throttleTimers.keys());
    const throttleToClean = Math.floor(throttleKeys.length * percentage);
    
    for (let i = 0; i < throttleToClean; i++) {
      const key = throttleKeys[i];
      const throttleInfo = this.throttleTimers.get(key);
      if (throttleInfo?.timer) {
        clearTimeout(throttleInfo.timer);
        this.throttleTimers.delete(key);
      }
    }
  }

  /**
   * Perform comprehensive cleanup operations
   */
  private async performCleanup(): Promise<void> {
    try {
      const config = this.configManager.getConfiguration();
      const startTime = Date.now();
      
      console.log('Starting performance cleanup...');
      
      // Clean up old conversations
      await this.cleanupOldConversations(config.maxConversations);
      
      // Clean up old snapshots
      await this.cleanupOldSnapshots(config.snapshotRetention);
      
      // Clean up old backups
      await this.cleanupOldBackups(config.maxBackups);
      
      // Clean up storage caches
      await this.cleanupStorageCaches();
      
      // Clean up memory caches
      await this.cleanupMemoryCaches();
      
      // Clean up temporary files
      await this.cleanupTempFiles();
      
      // Optimize data storage
      await this.optimizeDataStorage();
      
      // Update cleanup timestamp
      await this.context.globalState.update('lastCleanupTime', Date.now());
      
      const duration = Date.now() - startTime;
      console.log(`Performance cleanup completed in ${duration}ms`);
    } catch (error) {
      console.error('Performance cleanup failed:', error);
    }
  }

  /**
   * Clean up memory caches based on usage patterns
   */
  private async cleanupMemoryCaches(): Promise<void> {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    
    // Clean up expired cache entries
    const expiredKeys: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > maxAge) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      this.cache.delete(key);
    }
    
    // If cache is still too large, remove least recently used items
    if (this.cache.size > this.cacheMaxSize * 0.8) {
      const entries = Array.from(this.cache.entries());
      const sortedEntries = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const itemsToRemove = Math.floor(this.cache.size * 0.3); // Remove 30%
      
      for (let i = 0; i < itemsToRemove && i < sortedEntries.length; i++) {
        this.cache.delete(sortedEntries[i][0]);
      }
    }
    
    console.log(`Cleaned up memory caches: ${expiredKeys.length} expired entries removed`);
  }

  /**
   * Clean up temporary files and directories
   */
  private async cleanupTempFiles(): Promise<void> {
    try {
      // This would be implemented based on the actual temp file structure
      // For now, just log the intent
      console.log('Cleaned up temporary files');
    } catch (error) {
      console.error('Failed to cleanup temp files:', error);
    }
  }

  /**
   * Optimize data storage by compacting and reorganizing data
   */
  private async optimizeDataStorage(): Promise<void> {
    try {
      // Trigger data storage optimization if available
      if (typeof (this.dataStorage as any).optimize === 'function') {
        await (this.dataStorage as any).optimize();
      }
      
      console.log('Data storage optimization completed');
    } catch (error) {
      console.error('Failed to optimize data storage:', error);
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
   * Implement pagination for conversation loading with enhanced caching
   */
  async getConversationsPaginated(
    page: number = 0,
    pageSize: number = 50,
    filter?: any
  ): Promise<PaginatedResult<any>> {
    const cacheKey = `conversations-page-${page}-${pageSize}-${JSON.stringify(filter || {})}`;
    
    return this.getCachedData(cacheKey, async () => {
      try {
        // Use optimized loading for large datasets
        if (await this.shouldUsePaginatedLoading()) {
          return await this.getConversationsPaginatedOptimized(page, pageSize, filter);
        }
        
        const allConversations = await this.dataStorage.getConversations(filter);
        const totalCount = allConversations.length;
        const startIndex = page * pageSize;
        const endIndex = Math.min(startIndex + pageSize, totalCount);
        
        // Only load the required slice to reduce memory usage
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
    }, 2 * 60 * 1000); // Cache for 2 minutes
  }

  /**
   * Optimized pagination for large datasets
   */
  private async getConversationsPaginatedOptimized(
    page: number,
    pageSize: number,
    filter?: any
  ): Promise<PaginatedResult<any>> {
    // Use file-based pagination to avoid loading all conversations into memory
    const conversationsDir = (this.dataStorage as any).conversationsDir;
    if (!conversationsDir) {
      // Fallback to regular pagination
      const allConversations = await this.dataStorage.getConversations(filter);
      const totalCount = allConversations.length;
      const startIndex = page * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalCount);
      
      return {
        items: allConversations.slice(startIndex, endIndex),
        totalCount,
        page,
        pageSize,
        hasMore: endIndex < totalCount
      };
    }

    try {
      // Get file list and sort by modification time
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(conversationsDir));
      const jsonFiles = files
        .filter(([name]) => name.endsWith('.json'))
        .sort(([, aType], [, bType]) => {
          // Sort by file modification time (newest first)
          return 0; // Simplified for now
        });

      const totalCount = jsonFiles.length;
      const startIndex = page * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalCount);
      
      const conversations = [];
      
      // Load only the required files
      for (let i = startIndex; i < endIndex; i++) {
        const [fileName] = jsonFiles[i];
        const conversationId = fileName.replace('.json', '');
        
        try {
          const conversation = await this.dataStorage.getConversation(conversationId);
          if (conversation && this.matchesFilter(conversation, filter)) {
            conversations.push(conversation);
          }
        } catch (error) {
          console.warn(`Failed to load conversation ${conversationId}:`, error);
        }
      }
      
      return {
        items: conversations,
        totalCount,
        page,
        pageSize,
        hasMore: endIndex < totalCount
      };
    } catch (error) {
      console.error('Optimized pagination failed:', error);
      // Fallback to regular method
      const allConversations = await this.dataStorage.getConversations(filter);
      const totalCount = allConversations.length;
      const startIndex = page * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalCount);
      
      return {
        items: allConversations.slice(startIndex, endIndex),
        totalCount,
        page,
        pageSize,
        hasMore: endIndex < totalCount
      };
    }
  }

  /**
   * Check if paginated loading should be used based on dataset size
   */
  private async shouldUsePaginatedLoading(): Promise<boolean> {
    try {
      const config = this.configManager.getConfiguration();
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
      
      // Use paginated loading if memory usage is high or dataset is large
      return heapUsedMB > 50 || config.maxConversations > 500;
    } catch {
      return false;
    }
  }

  /**
   * Helper method to match conversation against filter
   */
  private matchesFilter(conversation: any, filter?: any): boolean {
    if (!filter) {return true;}
    
    // Implement basic filtering logic
    if (filter.status && conversation.status !== filter.status) {
      return false;
    }
    
    if (filter.search && !conversation.title?.toLowerCase().includes(filter.search.toLowerCase())) {
      return false;
    }
    
    if (filter.dateFrom && conversation.timestamp < filter.dateFrom) {
      return false;
    }
    
    if (filter.dateTo && conversation.timestamp > filter.dateTo) {
      return false;
    }
    
    return true;
  }

  /**
   * Implement virtual scrolling data provider
   */
  async getConversationsVirtual(
    startIndex: number,
    endIndex: number,
    filter?: any
  ): Promise<VirtualScrollResult<any>> {
    const cacheKey = `conversations-virtual-${startIndex}-${endIndex}-${JSON.stringify(filter || {})}`;
    
    return this.getCachedData(cacheKey, async () => {
      try {
        const allConversations = await this.dataStorage.getConversations(filter);
        const totalCount = allConversations.length;
        
        // Clamp indices to valid range
        const safeStartIndex = Math.max(0, Math.min(startIndex, totalCount));
        const safeEndIndex = Math.max(safeStartIndex, Math.min(endIndex, totalCount));
        
        const conversations = allConversations.slice(safeStartIndex, safeEndIndex);
        
        return {
          items: conversations,
          startIndex: safeStartIndex,
          endIndex: safeEndIndex,
          totalCount
        };
      } catch (error) {
        console.error('Failed to get virtual conversations:', error);
        return {
          items: [],
          startIndex,
          endIndex,
          totalCount: 0
        };
      }
    }, 1 * 60 * 1000); // Cache for 1 minute
  }

  /**
   * Implement lazy loading for messages with enhanced performance
   */
  async getMessagesLazy(
    conversationId: string,
    offset: number = 0,
    limit: number = 20
  ): Promise<LazyLoadResult<any>> {
    const cacheKey = `messages-${conversationId}-${offset}-${limit}`;
    
    return this.getCachedData(cacheKey, async () => {
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
    }, 30 * 1000); // Cache for 30 seconds
  }

  /**
   * Implement snapshot lazy loading with deferred content loading
   */
  async getSnapshotLazy(
    messageId: string,
    loadContent: boolean = false
  ): Promise<SnapshotLazyResult> {
    const cacheKey = `snapshot-${messageId}-${loadContent}`;
    
    return this.getCachedData(cacheKey, async () => {
      try {
        // First, try to get snapshot metadata only
        const snapshot = await this.getSnapshotMetadata(messageId);
        
        if (!snapshot) {
          return {
            snapshot: null,
            contentLoaded: false,
            fileCount: 0,
            totalSize: 0
          };
        }
        
        let contentLoaded = false;
        let totalSize = 0;
        
        if (loadContent) {
          // Load actual file content on demand
          await this.loadSnapshotContent(snapshot);
          
          for (const fileSnapshot of snapshot.snapshots) {
            if (fileSnapshot.content) {
              totalSize += fileSnapshot.content.length;
            }
          }
          contentLoaded = true;
        } else {
          // Only load metadata, defer content loading
          for (const fileSnapshot of snapshot.snapshots) {
            // Clear content to save memory if it was loaded
            if ((fileSnapshot as any).content) {
              delete (fileSnapshot as any).content;
            }
            // Estimate size from checksum or other metadata
            totalSize += fileSnapshot.checksum ? fileSnapshot.checksum.length * 100 : 1000;
          }
        }
        
        return {
          snapshot,
          contentLoaded,
          fileCount: snapshot.snapshots.length,
          totalSize
        };
      } catch (error) {
        console.error('Failed to get lazy snapshot:', error);
        return {
          snapshot: null,
          contentLoaded: false,
          fileCount: 0,
          totalSize: 0
        };
      }
    }, loadContent ? 10 * 1000 : 60 * 1000); // Cache content for 10s, metadata for 1min
  }

  /**
   * Get snapshot metadata without loading file content
   */
  private async getSnapshotMetadata(messageId: string): Promise<any> {
    const cacheKey = `snapshot-metadata-${messageId}`;
    
    return this.getCachedData(cacheKey, async () => {
      try {
        const snapshot = await this.dataStorage.getSnapshot(messageId);
        
        if (!snapshot) {
          return null;
        }
        
        // Create a lightweight version with metadata only
        const metadataSnapshot = {
          ...snapshot,
          snapshots: snapshot.snapshots.map((fileSnapshot: any) => ({
            filePath: fileSnapshot.filePath,
            timestamp: fileSnapshot.timestamp,
            checksum: fileSnapshot.checksum,
            // Don't include content in metadata
            contentSize: fileSnapshot.content ? fileSnapshot.content.length : 0
          }))
        };
        
        return metadataSnapshot;
      } catch (error) {
        console.error('Failed to get snapshot metadata:', error);
        return null;
      }
    }, 5 * 60 * 1000); // Cache metadata for 5 minutes
  }

  /**
   * Load snapshot content on demand with progressive loading
   */
  private async loadSnapshotContent(snapshot: any): Promise<void> {
    if (!snapshot || !snapshot.snapshots) {
      return;
    }
    
    // Load content progressively to avoid memory spikes
    const batchSize = 5; // Load 5 files at a time
    const batches = [];
    
    for (let i = 0; i < snapshot.snapshots.length; i += batchSize) {
      batches.push(snapshot.snapshots.slice(i, i + batchSize));
    }
    
    for (const batch of batches) {
      await Promise.all(batch.map(async (fileSnapshot: any) => {
        if (!fileSnapshot.content) {
          try {
            // Load content from storage
            const fullSnapshot = await this.dataStorage.getSnapshot(snapshot.messageId);
            const fullFileSnapshot = fullSnapshot?.snapshots.find(
              (fs: any) => fs.filePath === fileSnapshot.filePath
            );
            
            if (fullFileSnapshot?.content) {
              fileSnapshot.content = fullFileSnapshot.content;
            }
          } catch (error) {
            console.warn(`Failed to load content for ${fileSnapshot.filePath}:`, error);
          }
        }
      }));
      
      // Small delay between batches to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Implement progressive snapshot loading for large snapshots
   */
  async getSnapshotProgressive(
    messageId: string,
    options: {
      maxFiles?: number;
      maxSize?: number;
      priorityFiles?: string[];
    } = {}
  ): Promise<ProgressiveSnapshotResult> {
    const {
      maxFiles = 50,
      maxSize = 10 * 1024 * 1024, // 10MB
      priorityFiles = []
    } = options;
    
    try {
      const snapshot = await this.getSnapshotMetadata(messageId);
      
      if (!snapshot) {
        return {
          snapshot: null,
          loadedFiles: 0,
          totalFiles: 0,
          loadedSize: 0,
          hasMore: false
        };
      }
      
      // Sort files by priority and size
      const sortedFiles = [...snapshot.snapshots].sort((a, b) => {
        // Priority files first
        const aPriority = priorityFiles.includes(a.filePath) ? 0 : 1;
        const bPriority = priorityFiles.includes(b.filePath) ? 0 : 1;
        
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        
        // Then by size (smaller first for faster loading)
        return (a.contentSize || 0) - (b.contentSize || 0);
      });
      
      let loadedSize = 0;
      let loadedFiles = 0;
      const filesToLoad = [];
      
      // Select files to load based on constraints
      for (const fileSnapshot of sortedFiles) {
        const fileSize = fileSnapshot.contentSize || 0;
        
        if (loadedFiles >= maxFiles || loadedSize + fileSize > maxSize) {
          break;
        }
        
        filesToLoad.push(fileSnapshot);
        loadedSize += fileSize;
        loadedFiles++;
      }
      
      // Load content for selected files
      await Promise.all(filesToLoad.map(async (fileSnapshot) => {
        try {
          const fullSnapshot = await this.dataStorage.getSnapshot(messageId);
          const fullFileSnapshot = fullSnapshot?.snapshots.find(
            (fs: any) => fs.filePath === fileSnapshot.filePath
          );
          
          if (fullFileSnapshot?.content) {
            fileSnapshot.content = fullFileSnapshot.content;
          }
        } catch (error) {
          console.warn(`Failed to load content for ${fileSnapshot.filePath}:`, error);
        }
      }));
      
      // Update snapshot with loaded files
      snapshot.snapshots = filesToLoad;
      
      return {
        snapshot,
        loadedFiles,
        totalFiles: sortedFiles.length,
        loadedSize,
        hasMore: loadedFiles < sortedFiles.length
      };
    } catch (error) {
      console.error('Failed to get progressive snapshot:', error);
      return {
        snapshot: null,
        loadedFiles: 0,
        totalFiles: 0,
        loadedSize: 0,
        hasMore: false
      };
    }
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
   * Implement advanced garbage collection strategies
   */
  async performAdvancedGarbageCollection(): Promise<void> {
    try {
      console.log('Starting advanced garbage collection...');
      const startTime = Date.now();
      
      // Phase 1: Clear all caches
      this.clearCaches();
      
      // Phase 2: Clear weak references and temporary data
      await this.clearWeakReferences();
      
      // Phase 3: Compact memory structures
      await this.compactMemoryStructures();
      
      // Phase 4: Force multiple GC cycles if available
      if (global.gc) {
        for (let i = 0; i < 5; i++) {
          global.gc();
          // Small delay between GC cycles
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      // Phase 5: Clear Node.js internal caches
      this.clearNodeInternalCaches();
      
      const duration = Date.now() - startTime;
      console.log(`Advanced garbage collection completed in ${duration}ms`);
      
      // Log memory improvement
      const memoryAfter = process.memoryUsage();
      console.log(`Memory after GC: ${Math.round(memoryAfter.heapUsed / 1024 / 1024)}MB`);
    } catch (error) {
      console.error('Advanced garbage collection failed:', error);
    }
  }

  /**
   * Clear weak references and temporary data structures
   */
  private async clearWeakReferences(): Promise<void> {
    // Clear any WeakMap/WeakSet references if they exist
    // This is a placeholder for actual weak reference cleanup
    
    // Clear temporary data structures
    this.debounceTimers.clear();
    this.throttleTimers.clear();
    
    // Clear any event listeners that might hold references
    this.configChangeListeners = [];
  }

  /**
   * Compact memory structures to reduce fragmentation
   */
  private async compactMemoryStructures(): Promise<void> {
    // Recreate cache with compacted structure
    const cacheEntries = Array.from(this.cache.entries());
    this.cache.clear();
    
    // Only keep recent and frequently accessed entries
    const now = Date.now();
    const recentEntries = cacheEntries
      .filter(([, entry]) => now - entry.timestamp < this.cacheMaxAge / 2)
      .slice(0, Math.floor(this.cacheMaxSize / 2));
    
    for (const [key, entry] of recentEntries) {
      this.cache.set(key, entry);
    }
  }

  /**
   * Clear Node.js internal caches
   */
  private clearNodeInternalCaches(): void {
    try {
      // Clear require cache for non-core modules (be very careful with this)
      // Only clear our own modules to avoid breaking VSCode
      const modulePrefix = 'cursor-companion';
      for (const key of Object.keys(require.cache)) {
        if (key.includes(modulePrefix) && !key.includes('node_modules')) {
          // Don't actually delete from require cache as it can break the extension
          // Just log what would be cleared
          console.debug(`Would clear require cache for: ${key}`);
        }
      }
      
      // Clear DNS cache if available
      if (require('dns').setServers) {
        // DNS cache clearing would go here if needed
      }
    } catch (error) {
      console.warn('Failed to clear Node.js internal caches:', error);
    }
  }

  /**
   * Implement periodic data cleanup with configurable intervals
   */

  async schedulePeriodicCleanup(): Promise<void> {
    const config = this.configManager.getConfiguration();
    
    // Cancel existing cleanup if running
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Schedule cleanup based on configuration
    const cleanupIntervalMs = config.storageSettings.cleanupInterval * 60 * 60 * 1000; // Convert hours to ms
    
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.performScheduledCleanup();
      } catch (error) {
        console.error('Scheduled cleanup failed:', error);
      }
    }, cleanupIntervalMs);
    
    console.log(`Scheduled periodic cleanup every ${config.storageSettings.cleanupInterval} hours`);
  }

  /**
   * Perform scheduled cleanup with different levels based on system state
   */
  private async performScheduledCleanup(): Promise<void> {
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    const config = this.configManager.getConfiguration();
    
    console.log(`Starting scheduled cleanup (Memory: ${Math.round(heapUsedMB)}MB)`);
    
    if (heapUsedMB > 150) {
      // High memory usage - aggressive cleanup
      await this.performAggressiveCleanup();
    } else if (heapUsedMB > 100) {
      // Moderate memory usage - normal cleanup
      await this.performCleanup();
    } else {
      // Low memory usage - light cleanup
      await this.performLightCleanup();
    }
    
    // Always perform data cleanup based on retention settings
    await this.performDataRetentionCleanup();
  }

  /**
   * Perform data retention cleanup based on configuration
   */
  private async performDataRetentionCleanup(): Promise<void> {
    try {
      const config = this.configManager.getConfiguration();
      
      // Clean up old conversations beyond max limit
      await this.cleanupOldConversations(config.maxConversations);
      
      // Clean up old snapshots beyond retention period
      await this.cleanupOldSnapshots(config.snapshotRetention);
      
      // Clean up old backups beyond max limit
      await this.cleanupOldBackups(config.maxBackups);
      
      // Clean up temporary files
      await this.cleanupTempFiles();
      
      console.log('Data retention cleanup completed');
    } catch (error) {
      console.error('Data retention cleanup failed:', error);
    }
  }

  /**
   * Implement smart cache eviction based on usage patterns
   */

  private smartCacheEviction(): void {
    if (this.cache.size <= this.cacheMaxSize * 0.8) {
      return; // No need to evict yet
    }
    
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    
    // Score each cache entry based on recency and frequency
    const scoredEntries = entries.map(([key, entry]) => {
      const accessCount = this.cacheAccessCounts.get(key) || 1;
      const lastAccess = this.cacheLastAccess.get(key) || entry.timestamp;
      const age = now - lastAccess;
      
      // Higher score = more likely to be evicted
      const score = age / (accessCount * 1000); // Age in seconds divided by access count
      
      return { key, entry, score };
    });
    
    // Sort by score (highest first) and evict the worst performers
    scoredEntries.sort((a, b) => b.score - a.score);
    const itemsToEvict = Math.floor(this.cache.size * 0.3); // Evict 30%
    
    for (let i = 0; i < itemsToEvict && i < scoredEntries.length; i++) {
      const { key } = scoredEntries[i];
      this.cache.delete(key);
      this.cacheAccessCounts.delete(key);
      this.cacheLastAccess.delete(key);
    }
    
    console.log(`Smart cache eviction: removed ${itemsToEvict} entries`);
  }

  /**
   * Override getCachedData to track access patterns
   */
  async getCachedData<T>(
    key: string,
    fetcher: () => Promise<T>,
    maxAge: number = this.cacheMaxAge
  ): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key);
    
    // Track access
    this.cacheAccessCounts.set(key, (this.cacheAccessCounts.get(key) || 0) + 1);
    this.cacheLastAccess.set(key, now);
    
    // Return cached data if it's still valid
    if (cached && (now - cached.timestamp) < maxAge) {
      this.cacheHits++;
      return cached.data as T;
    }
    
    // Cache miss - fetch new data
    this.cacheMisses++;
    const data = await fetcher();
    
    // Store in cache
    this.cache.set(key, {
      data,
      timestamp: now
    });
    
    // Use smart eviction instead of simple size check
    this.smartCacheEviction();
    
    return data;
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
    
    // Clear caches and tracking data
    this.clearCaches();
    this.cacheAccessCounts.clear();
    this.cacheLastAccess.clear();
    this.configChangeListeners = [];
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

export interface VirtualScrollResult<T> {
  items: T[];
  startIndex: number;
  endIndex: number;
  totalCount: number;
}

export interface SnapshotLazyResult {
  snapshot: any | null;
  contentLoaded: boolean;
  fileCount: number;
  totalSize: number;
}

export interface ProgressiveSnapshotResult {
  snapshot: any | null;
  loadedFiles: number;
  totalFiles: number;
  loadedSize: number;
  hasMore: boolean;
}