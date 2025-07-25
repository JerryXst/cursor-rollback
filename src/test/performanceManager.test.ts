// Using global mocha functions
import * as assert from 'assert';
import * as vscode from 'vscode';
import { PerformanceManager } from '../cursor-companion/services/performanceManager';
import { ConfigurationManager } from '../cursor-companion/services/configurationManager';
import { IDataStorage } from '../cursor-companion/services/interfaces';

// Mock implementations
class MockDataStorage implements IDataStorage {
  private conversations: any[] = [];
  private messages: any[] = [];
  private snapshots: any[] = [];

  async initialize(): Promise<void> {}

  async saveConversation(conversation: any): Promise<void> {
    this.conversations.push(conversation);
  }

  async getConversations(filter?: any): Promise<any[]> {
    let result = [...this.conversations];
    
    if (filter?.status) {
      result = result.filter(c => c.status === filter.status);
    }
    
    if (filter?.search) {
      result = result.filter(c => 
        c.title?.toLowerCase().includes(filter.search.toLowerCase())
      );
    }
    
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getConversation(id: string): Promise<any | null> {
    return this.conversations.find(c => c.id === id) || null;
  }

  async deleteConversation(id: string): Promise<void> {
    this.conversations = this.conversations.filter(c => c.id !== id);
  }

  async archiveConversation(id: string): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (conversation) {
      conversation.status = 'archived';
    }
  }

  async saveMessage(message: any): Promise<void> {
    this.messages.push(message);
  }

  async getMessages(conversationId: string, filter?: any): Promise<any[]> {
    return this.messages
      .filter(m => m.conversationId === conversationId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getMessage(id: string): Promise<any | null> {
    return this.messages.find(m => m.id === id) || null;
  }

  async saveSnapshot(snapshot: any): Promise<void> {
    this.snapshots.push(snapshot);
  }

  async getSnapshot(messageId: string): Promise<any | null> {
    return this.snapshots.find(s => s.messageId === messageId) || null;
  }

  async cleanup(olderThanDays: number): Promise<void> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    this.conversations = this.conversations.filter(c => c.timestamp > cutoffTime);
    this.messages = this.messages.filter(m => m.timestamp > cutoffTime);
    this.snapshots = this.snapshots.filter(s => s.timestamp > cutoffTime);
  }

  async migrateData(): Promise<any> {
    return { success: true };
  }

  async verifyDataIntegrity(): Promise<any> {
    return { totalChecked: 0, corruptedItems: 0, errors: [] };
  }

  async repairConversationData(): Promise<any> {
    return { success: true, repairedFields: [], errors: [] };
  }

  async createBackup(): Promise<string> {
    return 'backup-id';
  }
}

suite('PerformanceManager Tests', () => {
  let performanceManager: PerformanceManager;
  let mockContext: vscode.ExtensionContext;
  let mockDataStorage: MockDataStorage;
  let configManager: ConfigurationManager;

  setup(async () => {
    // Create mock context
    mockContext = {
      subscriptions: [],
      globalState: {
        get: () => undefined,
        update: async () => {},
        keys: () => []
      },
      globalStorageUri: vscode.Uri.file('/tmp/test-storage')
    } as any;

    mockDataStorage = new MockDataStorage();
    configManager = ConfigurationManager.getInstance(mockContext);
    
    performanceManager = PerformanceManager.getInstance(
      mockContext,
      mockDataStorage,
      configManager
    );
  });

  teardown(() => {
    performanceManager.dispose();
  });

  test('should implement pagination for conversations', async () => {
    // Setup test data
    const conversations = [];
    for (let i = 0; i < 100; i++) {
      conversations.push({
        id: `conv-${i}`,
        title: `Conversation ${i}`,
        timestamp: Date.now() - (i * 1000),
        status: i % 2 === 0 ? 'active' : 'archived'
      });
    }

    // Add conversations to mock storage
    for (const conv of conversations) {
      await mockDataStorage.saveConversation(conv);
    }

    // Test pagination
    const page1 = await performanceManager.getConversationsPaginated(0, 10);
    assert.strictEqual(page1.items.length, 10);
    assert.strictEqual(page1.totalCount, 100);
    assert.strictEqual(page1.page, 0);
    assert.strictEqual(page1.pageSize, 10);
    assert.strictEqual(page1.hasMore, true);

    const page2 = await performanceManager.getConversationsPaginated(1, 10);
    assert.strictEqual(page2.items.length, 10);
    assert.strictEqual(page2.page, 1);
    assert.strictEqual(page2.hasMore, true);

    // Test last page
    const lastPage = await performanceManager.getConversationsPaginated(9, 10);
    assert.strictEqual(lastPage.items.length, 10);
    assert.strictEqual(lastPage.hasMore, false);
  });

  test('should implement virtual scrolling', async () => {
    // Setup test data
    const conversations = [];
    for (let i = 0; i < 50; i++) {
      conversations.push({
        id: `conv-${i}`,
        title: `Conversation ${i}`,
        timestamp: Date.now() - (i * 1000),
        status: 'active'
      });
    }

    for (const conv of conversations) {
      await mockDataStorage.saveConversation(conv);
    }

    // Test virtual scrolling
    const result = await performanceManager.getConversationsVirtual(10, 20);
    assert.strictEqual(result.items.length, 10);
    assert.strictEqual(result.startIndex, 10);
    assert.strictEqual(result.endIndex, 20);
    assert.strictEqual(result.totalCount, 50);
  });

  test('should implement lazy loading for messages', async () => {
    const conversationId = 'test-conv';
    
    // Setup test messages
    const messages = [];
    for (let i = 0; i < 100; i++) {
      messages.push({
        id: `msg-${i}`,
        conversationId,
        content: `Message ${i}`,
        timestamp: Date.now() - (i * 1000),
        sender: i % 2 === 0 ? 'user' : 'ai'
      });
    }

    for (const msg of messages) {
      await mockDataStorage.saveMessage(msg);
    }

    // Test lazy loading
    const result = await performanceManager.getMessagesLazy(conversationId, 0, 20);
    assert.strictEqual(result.items.length, 20);
    assert.strictEqual(result.offset, 0);
    assert.strictEqual(result.limit, 20);
    assert.strictEqual(result.totalCount, 100);
    assert.strictEqual(result.hasMore, true);

    // Test next batch
    const result2 = await performanceManager.getMessagesLazy(conversationId, 20, 20);
    assert.strictEqual(result2.items.length, 20);
    assert.strictEqual(result2.offset, 20);
    assert.strictEqual(result2.hasMore, true);
  });

  test('should implement snapshot lazy loading', async () => {
    const messageId = 'test-message';
    const snapshot = {
      id: 'snapshot-1',
      messageId,
      timestamp: Date.now(),
      snapshots: [
        {
          filePath: '/test/file1.ts',
          content: 'console.log("test1");',
          timestamp: Date.now(),
          checksum: 'checksum1'
        },
        {
          filePath: '/test/file2.ts',
          content: 'console.log("test2");',
          timestamp: Date.now(),
          checksum: 'checksum2'
        }
      ]
    };

    await mockDataStorage.saveSnapshot(snapshot);

    // Test lazy loading without content
    const result1 = await performanceManager.getSnapshotLazy(messageId, false);
    assert.strictEqual(result1.snapshot !== null, true);
    assert.strictEqual(result1.contentLoaded, false);
    assert.strictEqual(result1.fileCount, 2);

    // Test lazy loading with content
    const result2 = await performanceManager.getSnapshotLazy(messageId, true);
    assert.strictEqual(result2.snapshot !== null, true);
    assert.strictEqual(result2.contentLoaded, true);
    assert.strictEqual(result2.fileCount, 2);
    assert.strictEqual(result2.totalSize > 0, true);
  });

  test('should implement caching with hit rate tracking', async () => {
    const testKey = 'test-cache-key';
    let fetchCount = 0;
    
    const fetcher = async () => {
      fetchCount++;
      return { data: 'test-data', timestamp: Date.now() };
    };

    // First call should fetch
    const result1 = await performanceManager.getCachedData(testKey, fetcher);
    assert.strictEqual(fetchCount, 1);
    assert.strictEqual(result1.data, 'test-data');

    // Second call should use cache
    const result2 = await performanceManager.getCachedData(testKey, fetcher);
    assert.strictEqual(fetchCount, 1); // Should not fetch again
    assert.strictEqual(result2.data, 'test-data');

    // Check performance metrics
    const metrics = performanceManager.getPerformanceMetrics();
    assert.strictEqual(metrics.cache.size > 0, true);
    assert.strictEqual(metrics.cache.hitRate > 0, true);
  });

  test('should implement debouncing', async () => {
    let callCount = 0;
    const testFunction = () => {
      callCount++;
    };

    const debouncedFunction = performanceManager.debounce('test-debounce', testFunction, 100);

    // Call multiple times quickly
    debouncedFunction();
    debouncedFunction();
    debouncedFunction();

    // Should not have been called yet
    assert.strictEqual(callCount, 0);

    // Wait for debounce delay
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should have been called only once
    assert.strictEqual(callCount, 1);
  });

  test('should implement throttling', async () => {
    let callCount = 0;
    const testFunction = () => {
      callCount++;
    };

    const throttledFunction = performanceManager.throttle('test-throttle', testFunction, 100);

    // First call should execute immediately
    throttledFunction();
    assert.strictEqual(callCount, 1);

    // Subsequent calls should be throttled
    throttledFunction();
    throttledFunction();
    assert.strictEqual(callCount, 1);

    // Wait for throttle delay
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should allow another call
    throttledFunction();
    assert.strictEqual(callCount, 2);
  });

  test('should perform memory cleanup', async () => {
    // Fill cache with test data
    for (let i = 0; i < 50; i++) {
      await performanceManager.getCachedData(`test-key-${i}`, async () => ({
        data: `test-data-${i}`,
        size: 1000
      }));
    }

    const metricsBefore = performanceManager.getPerformanceMetrics();
    const cacheSizeBefore = metricsBefore.cache.size;

    // Force cleanup
    await performanceManager.forceCleanup();

    const metricsAfter = performanceManager.getPerformanceMetrics();
    
    // Cache should be cleared or reduced
    assert.strictEqual(metricsAfter.cache.size <= cacheSizeBefore, true);
  });

  test('should handle progressive snapshot loading', async () => {
    const messageId = 'test-progressive';
    const snapshot = {
      id: 'snapshot-progressive',
      messageId,
      timestamp: Date.now(),
      snapshots: Array.from({ length: 100 }, (_, i) => ({
        filePath: `/test/file${i}.ts`,
        content: `console.log("test${i}");`.repeat(100), // Make files larger
        timestamp: Date.now(),
        checksum: `checksum${i}`,
        contentSize: `console.log("test${i}");`.repeat(100).length
      }))
    };

    await mockDataStorage.saveSnapshot(snapshot);

    // Test progressive loading with limits
    const result = await performanceManager.getSnapshotProgressive(messageId, {
      maxFiles: 10,
      maxSize: 5000
    });

    assert.strictEqual(result.snapshot !== null, true);
    assert.strictEqual(result.loadedFiles <= 10, true);
    assert.strictEqual(result.totalFiles, 100);
    assert.strictEqual(result.hasMore, true);
  });
});