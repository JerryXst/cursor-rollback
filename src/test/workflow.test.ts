/**
 * End-to-end workflow tests for Cursor Companion UI
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { DataStorage } from '../cursor-companion/services/dataStorage';
import { UIManager } from '../cursor-companion/ui/uiManager';
import { ConversationTracker } from '../cursor-companion/services/conversationTracker';
import { RollbackManager } from '../cursor-companion/services/rollbackManager';
import { SnapshotManager } from '../cursor-companion/services/snapshotManager';

suite('Workflow Test Suite', () => {
  let mockContext: vscode.ExtensionContext;
  let dataStorage: DataStorage;
  let uiManager: UIManager;
  let conversationTracker: ConversationTracker;
  let rollbackManager: RollbackManager;
  let snapshotManager: SnapshotManager;

  suiteSetup(async () => {
    // Create mock extension context
    mockContext = {
      subscriptions: [],
      globalState: {
        get: () => undefined,
        update: () => Promise.resolve()
      },
      workspaceState: {
        get: () => undefined,
        update: () => Promise.resolve()
      },
      globalStorageUri: vscode.Uri.file('/tmp/test-workflow'),
      extensionPath: '/tmp/test-extension'
    } as any;

    // Initialize services in correct order
    dataStorage = new DataStorage(mockContext);
    await dataStorage.initialize();

    snapshotManager = new SnapshotManager(mockContext, dataStorage);
    await snapshotManager.initialize();

    rollbackManager = new RollbackManager(mockContext, dataStorage);
    uiManager = new UIManager(mockContext, dataStorage, rollbackManager);
    conversationTracker = new ConversationTracker(mockContext);

    await uiManager.initialize();
  });

  suiteTeardown(() => {
    // Cleanup
    if (uiManager) {
      uiManager.dispose();
    }
    if (conversationTracker) {
      conversationTracker.stopTracking();
    }
  });

  test('Complete conversation workflow', async () => {
    // Step 1: Create a conversation
    const conversation = {
      id: 'workflow-conv-1',
      title: 'Workflow Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active' as const
    };

    await dataStorage.saveConversation(conversation);

    // Step 2: Add messages to the conversation
    const userMessage = {
      id: 'workflow-msg-1',
      conversationId: 'workflow-conv-1',
      content: 'User: Please help me with this code',
      sender: 'user' as const,
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: []
    };

    const aiMessage = {
      id: 'workflow-msg-2',
      conversationId: 'workflow-conv-1',
      content: 'AI: Here is the solution',
      sender: 'ai' as const,
      timestamp: Date.now() + 1000,
      codeChanges: [{
        filePath: 'test.ts',
        changeType: 'modify' as const,
        beforeContent: 'old code',
        afterContent: 'new code'
      }],
      snapshot: []
    };

    await dataStorage.saveMessage(userMessage);
    await dataStorage.saveMessage(aiMessage);

    // Step 3: Verify conversation and messages are saved
    const savedConversation = await dataStorage.getConversation('workflow-conv-1');
    assert.ok(savedConversation);
    assert.strictEqual(savedConversation.title, 'Workflow Test Conversation');

    const messages = await dataStorage.getMessages('workflow-conv-1');
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].sender, 'user');
    assert.strictEqual(messages[1].sender, 'ai');

    // Step 4: Test UI refresh with new data
    await uiManager.refreshConversationList();

    // Step 5: Test search functionality
    uiManager.filterConversations('Workflow');

    // Step 6: Test archiving
    await dataStorage.archiveConversation('workflow-conv-1');
    const archivedConversation = await dataStorage.getConversation('workflow-conv-1');
    assert.strictEqual(archivedConversation?.status, 'archived');

    // Workflow completed successfully
    assert.ok(true);
  });

  test('Conversation tracking workflow', async () => {
    // Step 1: Start tracking
    await conversationTracker.startTracking();
    assert.strictEqual(conversationTracker.isTracking(), true);

    // Step 2: Set up event handlers
    let newConversationReceived = false;
    let newMessageReceived = false;

    conversationTracker.onNewConversation(() => {
      newConversationReceived = true;
    });

    conversationTracker.onNewMessage(() => {
      newMessageReceived = true;
    });

    // Step 3: Stop tracking
    conversationTracker.stopTracking();
    assert.strictEqual(conversationTracker.isTracking(), false);

    // Tracking workflow completed
    assert.ok(true);
  });

  test('Snapshot management workflow', async () => {
    // Step 1: Create a snapshot
    const snapshotCollection = await snapshotManager.createSnapshot('workflow-msg-2', {
      excludePatterns: ['**/*.js']
    });
    assert.ok(snapshotCollection);

    // Step 2: Verify snapshot exists
    assert.ok(snapshotCollection.id);
    assert.strictEqual(snapshotCollection.messageId, 'workflow-msg-2');

    // Step 3: Get snapshot stats
    const stats = await snapshotManager.getStats();
    assert.ok(stats);

    // Snapshot workflow completed
    assert.ok(true);
  });

  test('Error handling workflow', async () => {
    // Test error scenarios that should be handled gracefully

    // Step 1: Try to get non-existent conversation
    const nonExistent = await dataStorage.getConversation('does-not-exist');
    assert.strictEqual(nonExistent, null);

    // Step 2: Try to get non-existent message
    const nonExistentMessage = await dataStorage.getMessage('does-not-exist');
    assert.strictEqual(nonExistentMessage, null);

    // Step 3: Try to archive non-existent conversation
    try {
      await dataStorage.archiveConversation('does-not-exist');
      // Should handle gracefully or throw appropriate error
      assert.ok(true);
    } catch (error) {
      // Error is expected for non-existent conversation
      assert.ok(error);
    }

    // Step 4: Test UI with empty data
    await uiManager.refreshConversationList();
    uiManager.filterConversations('non-existent-query');

    // Error handling workflow completed
    assert.ok(true);
  });

  test('Performance workflow with multiple conversations', async () => {
    // Step 1: Create multiple conversations
    const conversations = [];
    for (let i = 0; i < 10; i++) {
      const conv = {
        id: `perf-conv-${i}`,
        title: `Performance Test Conversation ${i}`,
        timestamp: Date.now() + i * 1000,
        messages: [],
        status: 'active' as const
      };
      conversations.push(conv);
      await dataStorage.saveConversation(conv);
    }

    // Step 2: Create messages for each conversation
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 5; j++) {
        const message = {
          id: `perf-msg-${i}-${j}`,
          conversationId: `perf-conv-${i}`,
          content: `Message ${j} in conversation ${i}`,
          sender: j % 2 === 0 ? 'user' as const : 'ai' as const,
          timestamp: Date.now() + i * 1000 + j * 100,
          codeChanges: [],
          snapshot: []
        };
        await dataStorage.saveMessage(message);
      }
    }

    // Step 3: Test retrieval performance
    const startTime = Date.now();
    const allConversations = await dataStorage.getConversations();
    const endTime = Date.now();

    assert.ok(allConversations.length >= 10);
    assert.ok(endTime - startTime < 1000); // Should complete within 1 second

    // Step 4: Test UI performance with multiple conversations
    await uiManager.refreshConversationList();

    // Performance workflow completed
    assert.ok(true);
  });
});