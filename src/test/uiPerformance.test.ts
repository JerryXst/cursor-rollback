// Using global mocha functions
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConversationTreeProvider } from '../cursor-companion/ui/conversationTreeProvider';
import { SearchFilterProvider } from '../cursor-companion/ui/searchFilterProvider';
import { IDataStorage } from '../cursor-companion/services/interfaces';
import { Conversation, Message } from '../cursor-companion/models';

// Mock implementations
class MockDataStorage implements IDataStorage {
  private conversations: Conversation[] = [];
  private messages: Map<string, Message[]> = new Map();

  async initialize(): Promise<void> {}

  async saveConversation(conversation: Conversation): Promise<void> {
    this.conversations.push(conversation);
  }

  async getConversations(filter?: any): Promise<Conversation[]> {
    let result = [...this.conversations];
    
    if (filter?.status && filter.status !== 'all') {
      result = result.filter(c => c.status === filter.status);
    }
    
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return this.conversations.find(c => c.id === id) || null;
  }

  async deleteConversation(id: string): Promise<void> {
    this.conversations = this.conversations.filter(c => c.id !== id);
    this.messages.delete(id);
  }

  async archiveConversation(id: string): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (conversation) {
      conversation.status = 'archived';
    }
  }

  async saveMessage(message: Message): Promise<void> {
    if (!this.messages.has(message.conversationId)) {
      this.messages.set(message.conversationId, []);
    }
    this.messages.get(message.conversationId)!.push(message);
  }

  async getMessages(conversationId: string, filter?: any): Promise<Message[]> {
    const messages = this.messages.get(conversationId) || [];
    
    if (filter?.searchQuery) {
      return messages.filter(m => 
        m.content.toLowerCase().includes(filter.searchQuery.toLowerCase())
      );
    }
    
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }

  async getMessage(id: string): Promise<Message | null> {
    for (const messages of this.messages.values()) {
      const message = messages.find(m => m.id === id);
      if (message) return message;
    }
    return null;
  }

  async saveSnapshot(): Promise<void> {}
  async getSnapshot(): Promise<any> { return null; }
  async cleanup(): Promise<void> {}
  async migrateData(): Promise<any> { return { success: true }; }
  async verifyDataIntegrity(): Promise<any> { 
    return { totalChecked: 0, corruptedItems: 0, errors: [] }; 
  }
  async repairConversationData(): Promise<any> { 
    return { success: true, repairedFields: [], errors: [] }; 
  }
  async createBackup(): Promise<string> { return 'backup-id'; }

  // Add performance manager mock
  performanceManager = {
    getConversationsPaginated: async (page: number, pageSize: number, filter?: any) => {
      const allConversations = await this.getConversations(filter);
      const startIndex = page * pageSize;
      const endIndex = Math.min(startIndex + pageSize, allConversations.length);
      
      return {
        items: allConversations.slice(startIndex, endIndex),
        totalCount: allConversations.length,
        page,
        pageSize,
        hasMore: endIndex < allConversations.length
      };
    },
    
    getMessagesLazy: async (conversationId: string, offset: number, limit: number) => {
      const allMessages = await this.getMessages(conversationId);
      const items = allMessages.slice(offset, offset + limit);
      
      return {
        items,
        offset,
        limit,
        totalCount: allMessages.length,
        hasMore: offset + limit < allMessages.length
      };
    }
  };
}

suite('UI Performance Tests', () => {
  let mockContext: vscode.ExtensionContext;
  let mockDataStorage: MockDataStorage;
  let treeProvider: ConversationTreeProvider;
  let searchProvider: SearchFilterProvider;

  setup(async () => {
    // Create mock context
    mockContext = {
      subscriptions: [],
      globalState: {
        get: () => [],
        update: async () => {},
        keys: () => []
      },
      globalStorageUri: vscode.Uri.file('/tmp/test-storage')
    } as any;

    mockDataStorage = new MockDataStorage();
    treeProvider = new ConversationTreeProvider(mockDataStorage);
    searchProvider = new SearchFilterProvider(mockContext, mockDataStorage);
  });

  teardown(() => {
    treeProvider.dispose();
    searchProvider.dispose();
  });

  test('should handle virtual scrolling for large conversation lists', async () => {
    // Create a large number of conversations
    const conversations: Conversation[] = [];
    for (let i = 0; i < 200; i++) {
      conversations.push({
        id: `conv-${i}`,
        title: `Conversation ${i}`,
        timestamp: Date.now() - (i * 1000),
        status: i % 2 === 0 ? 'active' : 'archived',
        messages: []
      });
    }

    // Add conversations to mock storage
    for (const conv of conversations) {
      await mockDataStorage.saveConversation(conv);
    }

    // Load conversations with virtual scrolling
    await treeProvider.loadConversations(false, true);
    
    // Should load only the first page
    const children = await treeProvider.getChildren();
    
    // Should have page size + "Load More" item
    assert.strictEqual(children.length <= 51, true); // 50 items + load more
    
    // Load more conversations
    await treeProvider.loadMoreConversations();
    
    const childrenAfterLoadMore = await treeProvider.getChildren();
    assert.strictEqual(childrenAfterLoadMore.length > children.length, true);
  });

  test('should implement lazy loading for messages', async () => {
    const conversationId = 'test-conv';
    const conversation: Conversation = {
      id: conversationId,
      title: 'Test Conversation',
      timestamp: Date.now(),
      status: 'active',
      messages: []
    };

    await mockDataStorage.saveConversation(conversation);

    // Create many messages
    const messages: Message[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push({
        id: `msg-${i}`,
        conversationId,
        content: `Message ${i}`,
        timestamp: Date.now() - (i * 1000),
        sender: i % 2 === 0 ? 'user' : 'ai',
        codeChanges: [],
        snapshot: []
      });
    }

    for (const msg of messages) {
      await mockDataStorage.saveMessage(msg);
    }

    // Load conversations
    await treeProvider.loadConversations(false, true);
    const conversationItems = await treeProvider.getChildren();
    
    // Expand the conversation to load messages
    const conversationItem = conversationItems[0];
    await treeProvider.expandConversation(conversationId);
    
    // Get messages - should be lazy loaded
    const messageItems = await treeProvider.getChildren(conversationItem);
    
    // Should load only first batch + "Load More" item
    assert.strictEqual(messageItems.length <= 21, true); // 20 messages + load more
  });

  test('should debounce search operations', async () => {
    // Setup test data
    const conversations: Conversation[] = [];
    for (let i = 0; i < 50; i++) {
      conversations.push({
        id: `conv-${i}`,
        title: `Test Conversation ${i}`,
        timestamp: Date.now() - (i * 1000),
        status: 'active',
        messages: []
      });
    }

    for (const conv of conversations) {
      await mockDataStorage.saveConversation(conv);
    }

    let searchCallCount = 0;
    searchProvider.onSearchResults(() => {
      searchCallCount++;
    });

    // Perform multiple rapid searches
    searchProvider.search('test');
    searchProvider.search('test conv');
    searchProvider.search('test conversation');

    // Wait for debounce delay
    await new Promise(resolve => setTimeout(resolve, 400));

    // Should have been called only once due to debouncing
    assert.strictEqual(searchCallCount, 1);
  });

  test('should handle search cancellation', async () => {
    // Setup test data
    const conversations: Conversation[] = [];
    for (let i = 0; i < 100; i++) {
      conversations.push({
        id: `conv-${i}`,
        title: `Test Conversation ${i}`,
        timestamp: Date.now() - (i * 1000),
        status: 'active',
        messages: []
      });
    }

    for (const conv of conversations) {
      await mockDataStorage.saveConversation(conv);
    }

    let searchResults: any[] = [];
    searchProvider.onSearchResults((results) => {
      searchResults = results;
    });

    // Start a search
    searchProvider.search('test');
    
    // Immediately start another search (should cancel the first)
    searchProvider.search('conversation');

    // Wait for search to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Should have results for the second search only
    assert.strictEqual(searchResults.length > 0, true);
    assert.strictEqual(searchResults[0].matchText.includes('conversation'), true);
  });

  test('should provide adaptive search delay', async () => {
    const provider = searchProvider as any;
    
    // Short queries should have longer delay
    const shortDelay = provider.calculateSearchDelay('ab');
    const normalDelay = provider.calculateSearchDelay('test query');
    const longDelay = provider.calculateSearchDelay('this is a very long search query');

    assert.strictEqual(shortDelay > normalDelay, true);
    assert.strictEqual(longDelay < normalDelay, true);
  });

  test('should cache conversation tree items', async () => {
    const conversation: Conversation = {
      id: 'test-conv',
      title: 'Test Conversation',
      timestamp: Date.now(),
      status: 'active',
      messages: []
    };

    await mockDataStorage.saveConversation(conversation);
    await treeProvider.loadConversations(false, true);

    // Get children twice
    const children1 = await treeProvider.getChildren();
    const children2 = await treeProvider.getChildren();

    // Should return the same cached items
    assert.strictEqual(children1.length, children2.length);
    assert.strictEqual(children1[0], children2[0]); // Same object reference due to caching
  });

  test('should handle batch processing in search', async () => {
    // Create a large number of conversations
    const conversations: Conversation[] = [];
    for (let i = 0; i < 100; i++) {
      conversations.push({
        id: `conv-${i}`,
        title: `Conversation ${i}`,
        timestamp: Date.now() - (i * 1000),
        status: 'active',
        messages: []
      });
    }

    for (const conv of conversations) {
      await mockDataStorage.saveConversation(conv);
    }

    const startTime = Date.now();
    
    // Perform search
    const results = await searchProvider.searchImmediate('conversation');
    
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should complete in reasonable time (batch processing prevents blocking)
    assert.strictEqual(duration < 5000, true); // Less than 5 seconds
    assert.strictEqual(results.length > 0, true);
  });

  test('should limit search results to prevent UI overload', async () => {
    // Create many conversations with matching titles
    const conversations: Conversation[] = [];
    for (let i = 0; i < 200; i++) {
      conversations.push({
        id: `conv-${i}`,
        title: `Test Conversation ${i}`,
        timestamp: Date.now() - (i * 1000),
        status: 'active',
        messages: []
      });
    }

    for (const conv of conversations) {
      await mockDataStorage.saveConversation(conv);
    }

    // Search for common term
    const results = await searchProvider.searchImmediate('test');

    // Should limit results to prevent UI overload
    assert.strictEqual(results.length <= 100, true);
  });

  test('should handle message filtering efficiently', async () => {
    const conversationId = 'test-conv';
    const conversation: Conversation = {
      id: conversationId,
      title: 'Test Conversation',
      timestamp: Date.now(),
      status: 'active',
      messages: []
    };

    await mockDataStorage.saveConversation(conversation);

    // Create messages with different senders and code changes
    const messages: Message[] = [];
    for (let i = 0; i < 50; i++) {
      messages.push({
        id: `msg-${i}`,
        conversationId,
        content: `Message ${i}`,
        timestamp: Date.now() - (i * 1000),
        sender: i % 2 === 0 ? 'user' : 'ai',
        codeChanges: i % 3 === 0 ? [{ filePath: 'test.ts', changeType: 'modify' }] : [],
        snapshot: []
      });
    }

    for (const msg of messages) {
      await mockDataStorage.saveMessage(msg);
    }

    // Search with sender filter
    const userResults = await searchProvider.searchImmediate('message', { sender: 'user' });
    const aiResults = await searchProvider.searchImmediate('message', { sender: 'ai' });

    // Should filter correctly
    assert.strictEqual(userResults.length > 0, true);
    assert.strictEqual(aiResults.length > 0, true);
    assert.strictEqual(userResults.length !== aiResults.length, true);

    // Search with code changes filter
    const codeResults = await searchProvider.searchImmediate('message', { hasCodeChanges: true });
    assert.strictEqual(codeResults.length > 0, true);
    assert.strictEqual(codeResults.length < userResults.length + aiResults.length, true);
  });
});