/**
 * Tests for MessageDisplayProvider
 * Validates message formatting, display logic, and user interactions
 */

// Using global mocha functions
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { MessageDisplayProvider } from '../cursor-companion/ui/messageDisplayProvider';
import { ConversationExpandManager } from '../cursor-companion/ui/conversationExpandManager';
import { LocalFileStorage } from '../cursor-companion/services/localFileStorage';
import { Conversation, Message } from '../cursor-companion/models';

suite('MessageDisplayProvider', () => {
  let messageDisplayProvider: MessageDisplayProvider;
  let mockContext: vscode.ExtensionContext;
  let mockDataStorage: LocalFileStorage;
  let mockExpandManager: ConversationExpandManager;
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Create mock context
    mockContext = {
      globalState: {
        get: sandbox.stub(),
        update: sandbox.stub()
      }
    } as any;

    // Create mock data storage
    mockDataStorage = {
      getMessages: sandbox.stub(),
      getConversation: sandbox.stub(),
      getMessage: sandbox.stub()
    } as any;

    // Create mock expand manager
    mockExpandManager = {
      formatMessagesForDisplay: sandbox.stub(),
      isMessageExpanded: sandbox.stub(),
      toggleMessageExpansion: sandbox.stub()
    } as any;

    // Create message display provider
    messageDisplayProvider = new MessageDisplayProvider(mockContext, mockDataStorage, mockExpandManager);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('createMessageTreeItems', () => {
    test('should create tree items for messages in a conversation', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          content: 'Hello, can you help me?',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        },
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          content: 'Of course! What do you need help with?',
          sender: 'ai',
          timestamp: Date.now() + 1000,
          codeChanges: [
            {
              filePath: 'test.ts',
              changeType: 'modify',
              beforeContent: 'old content',
              afterContent: 'new content'
            }
          ],
          snapshot: []
        }
      ];

      const conversation: Conversation = {
        id: 'conv-1',
        title: 'Test Conversation',
        timestamp: Date.now(),
        messages: messages,
        status: 'active'
      };

      const formattedMessages = [
        {
          id: 'msg-1',
          displayContent: 'Hello, can you help me?',
          timestamp: '10:30 AM',
          sender: 'user' as const,
          hasCodeChanges: false,
          isExpanded: false,
          canRollback: false
        },
        {
          id: 'msg-2',
          displayContent: 'Of course! What do you need help with?',
          timestamp: '10:31 AM',
          sender: 'ai' as const,
          hasCodeChanges: true,
          codeChangesSummary: '1 modified • 1 file',
          isExpanded: true,
          canRollback: true
        }
      ];

      (mockDataStorage.getMessages as sinon.SinonStub).resolves(messages);
      (mockExpandManager.formatMessagesForDisplay as sinon.SinonStub).resolves(formattedMessages);

      const treeItems = await messageDisplayProvider.createMessageTreeItems(conversation);

      assert.strictEqual(treeItems.length, 3); // 2 messages + 1 code change item
      assert.strictEqual(treeItems[0].label, 'Hello, can you help me?');
      assert.strictEqual(treeItems[1].label, 'Of course! What do you need help with?');
      assert.strictEqual(treeItems[2].label, 'test.ts'); // Code change item
    });

    test('should handle empty conversation', async () => {
      const conversation: Conversation = {
        id: 'conv-empty',
        title: 'Empty Conversation',
        timestamp: Date.now(),
        messages: [],
        status: 'active'
      };

      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);
      (mockExpandManager.formatMessagesForDisplay as sinon.SinonStub).resolves([]);

      const treeItems = await messageDisplayProvider.createMessageTreeItems(conversation);

      assert.strictEqual(treeItems.length, 0);
    });

    test('should handle errors gracefully', async () => {
      const conversation: Conversation = {
        id: 'conv-error',
        title: 'Error Conversation',
        timestamp: Date.now(),
        messages: [{
          id: 'msg-1',
          conversationId: 'conv-error',
          content: 'Test message',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        }],
        status: 'active'
      };

      (mockDataStorage.getMessages as sinon.SinonStub).rejects(new Error('Database error'));

      const treeItems = await messageDisplayProvider.createMessageTreeItems(conversation);

      assert.strictEqual(treeItems.length, 0);
    });
  });

  suite('getMessageStatistics', () => {
    test('should return correct message statistics', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          content: 'User message',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        },
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          content: 'AI message with code',
          sender: 'ai',
          timestamp: Date.now() + 1000,
          codeChanges: [{ filePath: 'test.ts', changeType: 'modify' }],
          snapshot: []
        },
        {
          id: 'msg-3',
          conversationId: 'conv-1',
          content: 'Another AI message',
          sender: 'ai',
          timestamp: Date.now() + 2000,
          codeChanges: [],
          snapshot: []
        }
      ];

      (mockDataStorage.getMessages as sinon.SinonStub).resolves(messages);

      const stats = await messageDisplayProvider.getMessageStatistics('conv-1');

      assert.strictEqual(stats.totalMessages, 3);
      assert.strictEqual(stats.userMessages, 1);
      assert.strictEqual(stats.aiMessages, 2);
      assert.strictEqual(stats.messagesWithCodeChanges, 1);
    });

    test('should handle empty message list', async () => {
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      const stats = await messageDisplayProvider.getMessageStatistics('conv-empty');

      assert.strictEqual(stats.totalMessages, 0);
      assert.strictEqual(stats.userMessages, 0);
      assert.strictEqual(stats.aiMessages, 0);
      assert.strictEqual(stats.messagesWithCodeChanges, 0);
    });
  });

  suite('searchMessages', () => {
    test('should find messages containing search terms', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          content: 'Hello world, this is a test message',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        },
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          content: 'This message does not contain the search term',
          sender: 'ai',
          timestamp: Date.now() + 1000,
          codeChanges: [],
          snapshot: []
        },
        {
          id: 'msg-3',
          conversationId: 'conv-1',
          content: 'Another test message with world in it',
          sender: 'user',
          timestamp: Date.now() + 2000,
          codeChanges: [],
          snapshot: []
        }
      ];

      (mockDataStorage.getMessages as sinon.SinonStub).resolves(messages);

      const results = await messageDisplayProvider.searchMessages('conv-1', ['test', 'world']);

      assert.strictEqual(results.length, 2); // Should find msg-1 and msg-3
    });

    test('should return empty array when no matches found', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          content: 'Hello there',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        }
      ];

      (mockDataStorage.getMessages as sinon.SinonStub).resolves(messages);

      const results = await messageDisplayProvider.searchMessages('conv-1', ['nonexistent']);

      assert.strictEqual(results.length, 0);
    });
  });

  suite('exportConversationMessages', () => {
    test('should export conversation messages to markdown format', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          content: 'Hello, can you help me?',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        },
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          content: 'Of course! What do you need help with?',
          sender: 'ai',
          timestamp: Date.now() + 1000,
          codeChanges: [
            {
              filePath: 'test.ts',
              changeType: 'modify',
              beforeContent: 'old',
              afterContent: 'new'
            }
          ],
          snapshot: []
        }
      ];

      const conversation: Conversation = {
        id: 'conv-1',
        title: 'Test Conversation',
        timestamp: Date.now(),
        messages: messages,
        status: 'active'
      };

      (mockDataStorage.getConversation as sinon.SinonStub).resolves(conversation);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves(messages);

      const exported = await messageDisplayProvider.exportConversationMessages('conv-1');

      assert.ok(exported.includes('# Test Conversation'));
      assert.ok(exported.includes('## You -'));
      assert.ok(exported.includes('## Cursor AI -'));
      assert.ok(exported.includes('Hello, can you help me?'));
      assert.ok(exported.includes('Of course! What do you need help with?'));
      assert.ok(exported.includes('**Code Changes:**'));
      assert.ok(exported.includes('- modify: test.ts'));
    });

    test('should throw error when conversation not found', async () => {
      (mockDataStorage.getConversation as sinon.SinonStub).resolves(null);

      try {
        await messageDisplayProvider.exportConversationMessages('nonexistent');
        assert.fail('Should have thrown error');
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('Conversation not found'));
      }
    });
  });

  suite('utility methods', () => {
    test('should create appropriate tree items for different states', () => {
      const emptyItem = messageDisplayProvider.createEmptyStateItem('No messages found');
      assert.strictEqual(emptyItem.label, 'No messages found');
      assert.strictEqual(emptyItem.contextValue, 'emptyState');

      const loadingItem = messageDisplayProvider.createLoadingStateItem();
      assert.strictEqual(loadingItem.label, 'Loading messages...');
      assert.strictEqual(loadingItem.contextValue, 'loadingState');

      const errorItem = messageDisplayProvider.createErrorStateItem('Failed to load');
      assert.strictEqual(errorItem.label, 'Error: Failed to load');
      assert.strictEqual(errorItem.contextValue, 'errorState');
    });

    test('should update display options correctly', () => {
      const initialOptions = messageDisplayProvider.getDisplayOptions();
      assert.strictEqual(initialOptions.showTimestamp, true);
      assert.strictEqual(initialOptions.maxContentLength, 100);

      messageDisplayProvider.updateDisplayOptions({
        showTimestamp: false,
        maxContentLength: 200
      });

      const updatedOptions = messageDisplayProvider.getDisplayOptions();
      assert.strictEqual(updatedOptions.showTimestamp, false);
      assert.strictEqual(updatedOptions.maxContentLength, 200);
      assert.strictEqual(updatedOptions.showSender, true); // Should preserve other options
    });
  });
});