/**
 * Tests for ConversationExpandManager
 * Validates conversation expansion state management and message formatting
 */

// Using global mocha functions
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ConversationExpandManager } from '../cursor-companion/ui/conversationExpandManager';
import { LocalFileStorage } from '../cursor-companion/services/localFileStorage';
import { Message } from '../cursor-companion/models';

suite('ConversationExpandManager', () => {
  let expandManager: ConversationExpandManager;
  let mockContext: vscode.ExtensionContext;
  let mockDataStorage: LocalFileStorage;
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Create mock context
    mockContext = {
      globalState: {
        get: sandbox.stub().returns([]),
        update: sandbox.stub().resolves()
      }
    } as any;

    // Create mock data storage
    mockDataStorage = {
      getMessage: sandbox.stub()
    } as any;

    // Create expand manager
    expandManager = new ConversationExpandManager(mockContext, mockDataStorage);
  });

  teardown(() => {
    expandManager.dispose();
    sandbox.restore();
  });

  suite('conversation expansion', () => {
    test('should toggle conversation expansion state', () => {
      const conversationId = 'conv-1';

      // Initially not expanded
      assert.strictEqual(expandManager.isConversationExpanded(conversationId), false);

      // Toggle to expanded
      const isExpanded1 = expandManager.toggleConversationExpansion(conversationId);
      assert.strictEqual(isExpanded1, true);
      assert.strictEqual(expandManager.isConversationExpanded(conversationId), true);

      // Toggle back to collapsed
      const isExpanded2 = expandManager.toggleConversationExpansion(conversationId);
      assert.strictEqual(isExpanded2, false);
      assert.strictEqual(expandManager.isConversationExpanded(conversationId), false);
    });

    test('should handle multiple conversations independently', () => {
      const conv1 = 'conv-1';
      const conv2 = 'conv-2';

      // Expand conv1
      expandManager.toggleConversationExpansion(conv1);
      assert.strictEqual(expandManager.isConversationExpanded(conv1), true);
      assert.strictEqual(expandManager.isConversationExpanded(conv2), false);

      // Expand conv2
      expandManager.toggleConversationExpansion(conv2);
      assert.strictEqual(expandManager.isConversationExpanded(conv1), true);
      assert.strictEqual(expandManager.isConversationExpanded(conv2), true);

      // Collapse conv1
      expandManager.toggleConversationExpansion(conv1);
      assert.strictEqual(expandManager.isConversationExpanded(conv1), false);
      assert.strictEqual(expandManager.isConversationExpanded(conv2), true);
    });
  });

  suite('message expansion', () => {
    test('should toggle message expansion state', () => {
      const conversationId = 'conv-1';
      const messageId = 'msg-1';

      // Initially not expanded
      assert.strictEqual(expandManager.isMessageExpanded(conversationId, messageId), false);

      // Toggle to expanded
      const isExpanded1 = expandManager.toggleMessageExpansion(conversationId, messageId);
      assert.strictEqual(isExpanded1, true);
      assert.strictEqual(expandManager.isMessageExpanded(conversationId, messageId), true);

      // Toggle back to collapsed
      const isExpanded2 = expandManager.toggleMessageExpansion(conversationId, messageId);
      assert.strictEqual(isExpanded2, false);
      assert.strictEqual(expandManager.isMessageExpanded(conversationId, messageId), false);
    });

    test('should handle multiple messages in same conversation', () => {
      const conversationId = 'conv-1';
      const msg1 = 'msg-1';
      const msg2 = 'msg-2';

      // Expand msg1
      expandManager.toggleMessageExpansion(conversationId, msg1);
      assert.strictEqual(expandManager.isMessageExpanded(conversationId, msg1), true);
      assert.strictEqual(expandManager.isMessageExpanded(conversationId, msg2), false);

      // Expand msg2
      expandManager.toggleMessageExpansion(conversationId, msg2);
      assert.strictEqual(expandManager.isMessageExpanded(conversationId, msg1), true);
      assert.strictEqual(expandManager.isMessageExpanded(conversationId, msg2), true);
    });

    test('should expand all messages in conversation', () => {
      const conversationId = 'conv-1';
      const messageIds = ['msg-1', 'msg-2', 'msg-3'];

      expandManager.expandAllMessages(conversationId, messageIds);

      for (const messageId of messageIds) {
        assert.strictEqual(expandManager.isMessageExpanded(conversationId, messageId), true);
      }
    });

    test('should collapse all messages in conversation', () => {
      const conversationId = 'conv-1';
      const messageIds = ['msg-1', 'msg-2', 'msg-3'];

      // First expand all messages
      expandManager.expandAllMessages(conversationId, messageIds);

      // Then collapse all
      expandManager.collapseAllMessages(conversationId);

      for (const messageId of messageIds) {
        assert.strictEqual(expandManager.isMessageExpanded(conversationId, messageId), false);
      }
    });
  });

  suite('message formatting', () => {
    test('should format messages for display with default options', async () => {
      const conversationId = 'conv-1';
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId,
          content: 'Hello, this is a test message',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        },
        {
          id: 'msg-2',
          conversationId,
          content: 'This is an AI response with code changes',
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

      const formattedMessages = await expandManager.formatMessagesForDisplay(conversationId, messages);

      assert.strictEqual(formattedMessages.length, 2);
      
      // Check first message
      assert.strictEqual(formattedMessages[0].id, 'msg-1');
      assert.strictEqual(formattedMessages[0].sender, 'user');
      assert.strictEqual(formattedMessages[0].hasCodeChanges, false);
      assert.strictEqual(formattedMessages[0].isExpanded, false);
      
      // Check second message
      assert.strictEqual(formattedMessages[1].id, 'msg-2');
      assert.strictEqual(formattedMessages[1].sender, 'ai');
      assert.strictEqual(formattedMessages[1].hasCodeChanges, true);
      assert.ok(formattedMessages[1].codeChangesSummary);
    });

    test('should truncate long content when not expanded', async () => {
      const conversationId = 'conv-1';
      const longContent = 'A'.repeat(200); // 200 characters
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId,
          content: longContent,
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        }
      ];

      const formattedMessages = await expandManager.formatMessagesForDisplay(
        conversationId, 
        messages,
        { 
          showTimestamp: true, 
          showSender: true, 
          showCodeChanges: true, 
          maxContentLength: 50 
        }
      );

      assert.strictEqual(formattedMessages.length, 1);
      assert.ok(formattedMessages[0].displayContent.length <= 53); // 50 + '...'
      assert.ok(formattedMessages[0].displayContent.endsWith('...'));
    });

    test('should highlight search terms in content', async () => {
      const conversationId = 'conv-1';
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId,
          content: 'This is a test message with important keywords',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        }
      ];

      const formattedMessages = await expandManager.formatMessagesForDisplay(
        conversationId, 
        messages,
        { 
          showTimestamp: true, 
          showSender: true, 
          showCodeChanges: true,
          highlightSearchTerms: ['test', 'important']
        }
      );

      assert.strictEqual(formattedMessages.length, 1);
      assert.ok(formattedMessages[0].displayContent.includes('**test**'));
      assert.ok(formattedMessages[0].displayContent.includes('**important**'));
    });

    test('should format timestamps correctly', async () => {
      const conversationId = 'conv-1';
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30, 0);
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const lastYear = new Date(today.getFullYear() - 1, 5, 15, 14, 45, 0);

      const messages: Message[] = [
        {
          id: 'msg-today',
          conversationId,
          content: 'Today message',
          sender: 'user',
          timestamp: today.getTime(),
          codeChanges: [],
          snapshot: []
        },
        {
          id: 'msg-yesterday',
          conversationId,
          content: 'Yesterday message',
          sender: 'user',
          timestamp: yesterday.getTime(),
          codeChanges: [],
          snapshot: []
        },
        {
          id: 'msg-lastyear',
          conversationId,
          content: 'Last year message',
          sender: 'user',
          timestamp: lastYear.getTime(),
          codeChanges: [],
          snapshot: []
        }
      ];

      const formattedMessages = await expandManager.formatMessagesForDisplay(conversationId, messages);

      // Today's message should show time only
      assert.ok(formattedMessages[0].timestamp.includes('10:30'));
      assert.ok(!formattedMessages[0].timestamp.includes(today.getFullYear().toString()));

      // Yesterday's message should show month and day
      assert.ok(!formattedMessages[1].timestamp.includes(yesterday.getFullYear().toString()));

      // Last year's message should show full date including year
      assert.ok(formattedMessages[2].timestamp.includes(lastYear.getFullYear().toString()));
    });
  });

  suite('code changes summary', () => {
    test('should generate correct summary for different change types', async () => {
      const conversationId = 'conv-1';
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId,
          content: 'Made some changes',
          sender: 'ai',
          timestamp: Date.now(),
          codeChanges: [
            { filePath: 'file1.ts', changeType: 'create', afterContent: 'new content' },
            { filePath: 'file2.ts', changeType: 'modify', beforeContent: 'old', afterContent: 'new' },
            { filePath: 'file3.ts', changeType: 'delete', beforeContent: 'deleted content' }
          ],
          snapshot: []
        }
      ];

      const formattedMessages = await expandManager.formatMessagesForDisplay(conversationId, messages);

      assert.strictEqual(formattedMessages.length, 1);
      assert.ok(formattedMessages[0].codeChangesSummary);
      assert.ok(formattedMessages[0].codeChangesSummary!.includes('1 created'));
      assert.ok(formattedMessages[0].codeChangesSummary!.includes('1 modified'));
      assert.ok(formattedMessages[0].codeChangesSummary!.includes('1 deleted'));
      assert.ok(formattedMessages[0].codeChangesSummary!.includes('3 files'));
    });

    test('should handle single file changes correctly', async () => {
      const conversationId = 'conv-1';
      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId,
          content: 'Modified one file',
          sender: 'ai',
          timestamp: Date.now(),
          codeChanges: [
            { filePath: 'single.ts', changeType: 'modify', beforeContent: 'old', afterContent: 'new' }
          ],
          snapshot: []
        }
      ];

      const formattedMessages = await expandManager.formatMessagesForDisplay(conversationId, messages);

      assert.strictEqual(formattedMessages.length, 1);
      assert.ok(formattedMessages[0].codeChangesSummary);
      assert.ok(formattedMessages[0].codeChangesSummary!.includes('1 modified'));
      assert.ok(formattedMessages[0].codeChangesSummary!.includes('1 file')); // singular
    });
  });

  suite('expansion statistics', () => {
    test('should return correct expansion statistics', () => {
      const conv1 = 'conv-1';
      const conv2 = 'conv-2';

      // Expand conv1 and some messages
      expandManager.toggleConversationExpansion(conv1);
      expandManager.toggleMessageExpansion(conv1, 'msg-1');
      expandManager.toggleMessageExpansion(conv1, 'msg-2');

      // Expand conv2 but no messages
      expandManager.toggleConversationExpansion(conv2);

      const stats = expandManager.getExpansionStats();

      assert.strictEqual(stats.totalConversations, 2);
      assert.strictEqual(stats.expandedConversations, 2);
      assert.strictEqual(stats.totalExpandedMessages, 2);
    });

    test('should return zero stats for empty state', () => {
      const stats = expandManager.getExpansionStats();

      assert.strictEqual(stats.totalConversations, 0);
      assert.strictEqual(stats.expandedConversations, 0);
      assert.strictEqual(stats.totalExpandedMessages, 0);
    });
  });

  suite('persistence', () => {
    test('should save expansion states to global state', () => {
      const conversationId = 'conv-1';
      const messageId = 'msg-1';

      expandManager.toggleConversationExpansion(conversationId);
      expandManager.toggleMessageExpansion(conversationId, messageId);

      // Should have called update on global state
      assert.ok((mockContext.globalState.update as sinon.SinonStub).called);
    });

    test('should load expansion states from global state', () => {
      const savedStates = [
        {
          conversationId: 'conv-1',
          isExpanded: true,
          expandedMessages: ['msg-1', 'msg-2'],
          lastAccessed: Date.now()
        }
      ];

      (mockContext.globalState.get as sinon.SinonStub).returns(savedStates);

      // Create new manager to test loading
      const newManager = new ConversationExpandManager(mockContext, mockDataStorage);

      assert.strictEqual(newManager.isConversationExpanded('conv-1'), true);
      assert.strictEqual(newManager.isMessageExpanded('conv-1', 'msg-1'), true);
      assert.strictEqual(newManager.isMessageExpanded('conv-1', 'msg-2'), true);

      newManager.dispose();
    });
  });
});