import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { DataIndexer } from '../cursor-companion/services/dataIndexer';
import { LocalFileStorage } from '../cursor-companion/services/localFileStorage';
import { Conversation, Message } from '../cursor-companion/models';

suite('DataIndexer Tests', () => {
  let storage: LocalFileStorage;
  let indexer: DataIndexer;
  let mockContext: vscode.ExtensionContext;
  
  // Mock extension context
  const createMockContext = () => {
    const storageUri = vscode.Uri.file(path.join(__dirname, '..', '..', 'test-storage'));
    
    return {
      globalStorageUri: storageUri,
      extensionUri: vscode.Uri.file(path.join(__dirname, '..', '..')),
      subscriptions: [],
      workspaceState: {
        get: (key: string) => undefined,
        update: (key: string, value: any) => Promise.resolve()
      },
      globalState: {
        get: (key: string) => undefined,
        update: (key: string, value: any) => Promise.resolve(),
        setKeysForSync: (keys: string[]) => {}
      },
      extensionPath: path.join(__dirname, '..', '..'),
      asAbsolutePath: (relativePath: string) => path.join(__dirname, '..', '..', relativePath),
      storagePath: path.join(__dirname, '..', '..', 'test-storage'),
      globalStoragePath: path.join(__dirname, '..', '..', 'test-storage'),
      logPath: path.join(__dirname, '..', '..', 'test-logs'),
      extensionMode: vscode.ExtensionMode.Test,
      environmentVariableCollection: {} as any,
      storageUri: storageUri,
      logUri: vscode.Uri.file(path.join(__dirname, '..', '..', 'test-logs')),
      secrets: {
        get: (key: string) => Promise.resolve(undefined),
        store: (key: string, value: string) => Promise.resolve(),
        delete: (key: string) => Promise.resolve()
      },
      extension: {} as any
    } as vscode.ExtensionContext;
  };
  
  // Helper to create a test conversation
  const createTestConversation = (id: string, title: string): Conversation => {
    return {
      id,
      title,
      timestamp: Date.now(),
      messages: [],
      status: 'active',
      metadata: {
        messageCount: 0,
        lastActivity: Date.now(),
        tags: ['test']
      }
    };
  };
  
  // Helper to create a test message
  const createTestMessage = (id: string, conversationId: string, content: string, sender: 'user' | 'ai' = 'user'): Message => {
    return {
      id,
      conversationId,
      content,
      sender,
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: []
    };
  };
  
  // Setup test environment
  setup(async () => {
    mockContext = createMockContext();
    storage = new LocalFileStorage(mockContext);
    await storage.initialize();
    
    indexer = new DataIndexer(storage, mockContext);
    await indexer.initialize();
    
    // Create test data
    const conversation1 = createTestConversation('test-conv-1', 'JavaScript Performance Optimization');
    const conversation2 = createTestConversation('test-conv-2', 'React Component Architecture');
    const conversation3 = createTestConversation('test-conv-3', 'TypeScript Interface Design');
    
    await storage.saveConversation(conversation1);
    await storage.saveConversation(conversation2);
    await storage.saveConversation(conversation3);
    
    const message1 = createTestMessage('test-msg-1', 'test-conv-1', 'How can I optimize the performance of my JavaScript application?');
    const message2 = createTestMessage('test-msg-2', 'test-conv-1', 'You should consider using memoization and reducing DOM manipulations.', 'ai');
    const message3 = createTestMessage('test-msg-3', 'test-conv-2', 'What is the best way to structure React components?');
    const message4 = createTestMessage('test-msg-4', 'test-conv-2', 'You should follow the single responsibility principle and use composition.', 'ai');
    const message5 = createTestMessage('test-msg-5', 'test-conv-3', 'How should I design TypeScript interfaces for better maintainability?');
    const message6 = createTestMessage('test-msg-6', 'test-conv-3', 'Use composition over inheritance and keep interfaces focused on specific functionality.', 'ai');
    
    await storage.saveMessage(message1);
    await storage.saveMessage(message2);
    await storage.saveMessage(message3);
    await storage.saveMessage(message4);
    await storage.saveMessage(message5);
    await storage.saveMessage(message6);
    
    // Build index
    await indexer.buildIndex(true);
  });
  
  // Clean up after tests
  teardown(async () => {
    // Clean up test data
    try {
      await vscode.workspace.fs.delete(mockContext.globalStorageUri, { recursive: true });
    } catch (error) {
      console.warn('Failed to clean up test storage:', error);
    }
  });
  
  test('Initialize creates index', async () => {
    const stats = indexer.getIndexStats();
    assert.ok(stats.conversationCount > 0, 'Index should have conversations');
    assert.ok(stats.messageCount > 0, 'Index should have messages');
    assert.ok(stats.termCount > 0, 'Index should have terms');
  });
  
  test('Search conversations by title', async () => {
    const results = await indexer.searchConversations('javascript');
    
    assert.ok(results.length > 0, 'Should find at least one result');
    assert.ok(results.some(r => r.conversation.id === 'test-conv-1'), 'Should find JavaScript conversation');
    assert.ok(!results.some(r => r.conversation.id === 'test-conv-2'), 'Should not find React conversation');
  });
  
  test('Search conversations with fuzzy matching', async () => {
    const results = await indexer.searchConversations('javascrpt', undefined, { fuzzy: true });
    
    assert.ok(results.length > 0, 'Should find at least one result with fuzzy matching');
    assert.ok(results.some(r => r.conversation.id === 'test-conv-1'), 'Should find JavaScript conversation with fuzzy matching');
  });
  
  test('Search messages by content', async () => {
    const results = await indexer.searchMessages('performance');
    
    assert.ok(results.length > 0, 'Should find at least one result');
    assert.ok(results.some(r => r.message.id === 'test-msg-1'), 'Should find message about performance');
    assert.ok(!results.some(r => r.message.id === 'test-msg-3'), 'Should not find message about React components');
  });
  
  test('Search messages with conversation filter', async () => {
    const results = await indexer.searchMessages('components', { conversationId: 'test-conv-2' });
    
    assert.ok(results.length > 0, 'Should find at least one result');
    assert.ok(results.some(r => r.message.id === 'test-msg-3'), 'Should find message about React components');
    assert.strictEqual(results.every(r => r.message.conversationId === 'test-conv-2'), true, 'All results should be from the specified conversation');
  });
  
  test('Search messages with sender filter', async () => {
    const results = await indexer.searchMessages('', { sender: 'ai' });
    
    assert.ok(results.length > 0, 'Should find at least one result');
    assert.strictEqual(results.every(r => r.message.sender === 'ai'), true, 'All results should be from AI');
  });
  
  test('Update conversation index', async () => {
    // Update a conversation
    const conversation = await storage.getConversation('test-conv-1');
    if (conversation) {
      conversation.title = 'Updated JavaScript Performance Tips';
      await storage.saveConversation(conversation);
      
      // Update index
      await indexer.updateConversationIndex(conversation);
      
      // Search for new title
      const results = await indexer.searchConversations('tips');
      
      assert.ok(results.length > 0, 'Should find updated conversation');
      assert.ok(results.some(r => r.conversation.id === 'test-conv-1'), 'Should find conversation by new title');
    } else {
      assert.fail('Conversation not found');
    }
  });
  
  test('Update message index', async () => {
    // Update a message
    const message = await storage.getMessage('test-msg-1');
    if (message) {
      message.content = 'Updated question about JavaScript performance and memory usage';
      await storage.saveMessage(message);
      
      // Update index
      await indexer.updateMessageIndex(message);
      
      // Search for new content
      const results = await indexer.searchMessages('memory usage');
      
      assert.ok(results.length > 0, 'Should find updated message');
      assert.ok(results.some(r => r.message.id === 'test-msg-1'), 'Should find message by new content');
    } else {
      assert.fail('Message not found');
    }
  });
  
  test('Remove conversation from index', async () => {
    // Remove conversation from index
    await indexer.removeConversationFromIndex('test-conv-1');
    
    // Search for removed conversation
    const results = await indexer.searchConversations('javascript');
    
    assert.ok(!results.some(r => r.conversation.id === 'test-conv-1'), 'Should not find removed conversation');
  });
  
  test('Remove message from index', async () => {
    // Remove message from index
    await indexer.removeMessageFromIndex('test-msg-1');
    
    // Search for removed message
    const results = await indexer.searchMessages('performance');
    
    assert.ok(!results.some(r => r.message.id === 'test-msg-1'), 'Should not find removed message');