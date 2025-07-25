/**
 * Integration tests for Cursor Companion UI
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { DataStorage } from '../cursor-companion/services/dataStorage';
import { UIManager } from '../cursor-companion/ui/uiManager';
import { ConversationTracker } from '../cursor-companion/services/conversationTracker';
import { RollbackManager } from '../cursor-companion/services/rollbackManager';

suite('Integration Test Suite', () => {
  let mockContext: vscode.ExtensionContext;
  let dataStorage: DataStorage;
  let uiManager: UIManager;
  let conversationTracker: ConversationTracker;
  let rollbackManager: RollbackManager;

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
      globalStorageUri: vscode.Uri.file('/tmp/test-storage'),
      extensionPath: '/tmp/test-extension'
    } as any;

    // Initialize services
    dataStorage = new DataStorage(mockContext);
    rollbackManager = new RollbackManager(mockContext, dataStorage);
    uiManager = new UIManager(mockContext, dataStorage, rollbackManager);
    conversationTracker = new ConversationTracker(mockContext);
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

  test('Should initialize data storage', async () => {
    await dataStorage.initialize();
    
    // Should not throw error
    assert.ok(true);
  });

  test('Should initialize UI manager', async () => {
    await uiManager.initialize();
    
    // Should not throw error
    assert.ok(true);
  });

  test('Should start conversation tracking', async () => {
    await conversationTracker.startTracking();
    
    assert.strictEqual(conversationTracker.isTracking(), true);
  });

  test('Should save and retrieve conversation', async () => {
    const conversation = {
      id: 'test-conv-1',
      title: 'Test Integration Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active' as const
    };

    await dataStorage.saveConversation(conversation);
    const retrieved = await dataStorage.getConversation('test-conv-1');
    
    assert.ok(retrieved);
    assert.strictEqual(retrieved.id, 'test-conv-1');
    assert.strictEqual(retrieved.title, 'Test Integration Conversation');
  });

  test('Should save and retrieve message', async () => {
    const message = {
      id: 'test-msg-1',
      conversationId: 'test-conv-1',
      content: 'Test integration message',
      sender: 'user' as const,
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: []
    };

    await dataStorage.saveMessage(message);
    const retrieved = await dataStorage.getMessage('test-msg-1');
    
    assert.ok(retrieved);
    assert.strictEqual(retrieved.id, 'test-msg-1');
    assert.strictEqual(retrieved.content, 'Test integration message');
  });

  test('Should handle conversation filtering', async () => {
    const conversations = await dataStorage.getConversations();
    
    assert.ok(Array.isArray(conversations));
  });

  test('Should handle UI refresh', async () => {
    await uiManager.refreshConversationList();
    
    // Should not throw error
    assert.ok(true);
  });

  test('Should handle conversation panel display', async () => {
    await uiManager.showConversationPanel();
    
    // Should not throw error
    assert.ok(true);
  });

  test('Should handle search filtering', () => {
    uiManager.filterConversations('test query');
    
    // Should not throw error
    assert.ok(true);
  });

  test('Should register rollback callback', () => {
    const callback = () => {};
    uiManager.onRollbackRequest(callback);
    
    // Should not throw error
    assert.ok(true);
  });

  test('Should handle conversation archiving', async () => {
    await dataStorage.archiveConversation('test-conv-1');
    
    const archived = await dataStorage.getConversation('test-conv-1');
    assert.ok(archived);
    assert.strictEqual(archived.status, 'archived');
  });

  test('Should handle error scenarios gracefully', async () => {
    // Test with invalid conversation ID
    const result = await dataStorage.getConversation('non-existent');
    assert.strictEqual(result, null);
    
    // Test with invalid message ID
    const messageResult = await dataStorage.getMessage('non-existent');
    assert.strictEqual(messageResult, null);
  });
});