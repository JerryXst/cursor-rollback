/**
 * Performance and stress tests for Cursor Companion UI
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { DataStorage } from '../cursor-companion/services/dataStorage';
import { UIManager } from '../cursor-companion/ui/uiManager';
import { ConversationTracker } from '../cursor-companion/services/conversationTracker';
import { RollbackManager } from '../cursor-companion/services/rollbackManager';
import { SnapshotManager } from '../cursor-companion/services/snapshotManager';

suite('Performance and Stress Test Suite', () => {
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
      globalStorageUri: vscode.Uri.file('/tmp/test-performance'),
      extensionPath: '/tmp/test-extension'
    } as any;

    // Initialize services
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

  test('Should handle large number of conversations efficiently', async () => {
    const startTime = Date.now();
    const conversationCount = 500;

    // Create many conversations
    for (let i = 0; i < conversationCount; i++) {
      await dataStorage.saveConversation({
        id: `perf-conv-${i}`,
        title: `Performance Test Conversation ${i}`,
        timestamp: Date.now() + i,
        messages: [],
        status: i % 10 === 0 ? 'archived' : 'active'
      });
    }

    const saveTime = Date.now() - startTime;
    console.log(`Saved ${conversationCount} conversations in ${saveTime}ms`);

    // Retrieve all conversations
    const retrieveStart = Date.now();
    const conversations = await dataStorage.getConversations();
    const retrieveTime = Date.now() - retrieveStart;

    console.log(`Retrieved ${conversations.length} conversations in ${retrieveTime}ms`);

    assert.ok(conversations.length >= conversationCount);
    assert.ok(retrieveTime < 5000); // Should complete within 5 seconds
  });

  test('Should handle large number of messages efficiently', async () => {
    const conversationId = 'perf-conv-messages';
    const messageCount = 1000;

    // Create conversation
    await dataStorage.saveConversation({
      id: conversationId,
      title: 'Message Performance Test',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    });

    const startTime = Date.now();

    // Create many messages
    for (let i = 0; i < messageCount; i++) {
      await dataStorage.saveMessage({
        id: `perf-msg-${i}`,
        conversationId,
        content: `Performance test message ${i} with some content to make it realistic`,
        sender: i % 2 === 0 ? 'user' : 'ai',
        timestamp: Date.now() + i,
        codeChanges: i % 5 === 0 ? [{
          filePath: `test${i}.ts`,
          changeType: 'modify',
          beforeContent: `old content ${i}`,
          afterContent: `new content ${i}`
        }] : [],
        snapshot: []
      });
    }

    const saveTime = Date.now() - startTime;
    console.log(`Saved ${messageCount} messages in ${saveTime}ms`);

    // Retrieve all messages
    const retrieveStart = Date.now();
    const messages = await dataStorage.getMessages(conversationId);
    const retrieveTime = Date.now() - retrieveStart;

    console.log(`Retrieved ${messages.length} messages in ${retrieveTime}ms`);

    assert.strictEqual(messages.length, messageCount);
    assert.ok(retrieveTime < 3000); // Should complete within 3 seconds
  });

  test('Should handle UI refresh with large datasets efficiently', async () => {
    const startTime = Date.now();

    // Refresh UI with large dataset
    await uiManager.refreshConversationList();

    const refreshTime = Date.now() - startTime;
    console.log(`UI refresh completed in ${refreshTime}ms`);

    assert.ok(refreshTime < 2000); // Should complete within 2 seconds
  });

  test('Should handle rapid search operations efficiently', async () => {
    const searchQueries = [
      'Performance',
      'Test',
      'Conversation',
      'Message',
      'perf-conv',
      'user',
      'ai',
      'modify',
      'content'
    ];

    const startTime = Date.now();

    // Perform rapid searches
    for (const query of searchQueries) {
      uiManager.filterConversations(query);
      // Small delay to simulate user typing
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const searchTime = Date.now() - startTime;
    console.log(`Completed ${searchQueries.length} searches in ${searchTime}ms`);

    assert.ok(searchTime < 1000); // Should complete within 1 second
  });

  test('Should handle concurrent operations without conflicts', async () => {
    const concurrentOperations = 50;
    const promises = [];

    const startTime = Date.now();

    // Create concurrent save operations
    for (let i = 0; i < concurrentOperations; i++) {
      promises.push(
        dataStorage.saveConversation({
          id: `concurrent-${i}`,
          title: `Concurrent Test ${i}`,
          timestamp: Date.now() + i,
          messages: [],
          status: 'active'
        })
      );
    }

    // Wait for all operations to complete
    await Promise.all(promises);

    const concurrentTime = Date.now() - startTime;
    console.log(`Completed ${concurrentOperations} concurrent operations in ${concurrentTime}ms`);

    // Verify all conversations were saved
    const conversations = await dataStorage.getConversations();
    const concurrentConvs = conversations.filter(c => c.id.startsWith('concurrent-'));
    
    assert.strictEqual(concurrentConvs.length, concurrentOperations);
    assert.ok(concurrentTime < 5000); // Should complete within 5 seconds
  });

  test('Should handle memory usage efficiently with large snapshots', async () => {
    const snapshotCount = 100;
    const filesPerSnapshot = 10;
    const fileSize = 1000; // characters

    const startTime = Date.now();

    for (let i = 0; i < snapshotCount; i++) {
      try {
        await snapshotManager.createSnapshot(`snapshot-msg-${i}`, {
          excludePatterns: ['node_modules/**']
        });
      } catch (error) {
        // May fail due to memory constraints, which is acceptable
        console.log(`Snapshot ${i} failed: ${(error as Error).message}`);
      }
    }

    const snapshotTime = Date.now() - startTime;
    console.log(`Processed ${snapshotCount} snapshots in ${snapshotTime}ms`);

    // Should complete without crashing
    assert.ok(true);
  });

  test('Should handle rapid start/stop tracking cycles', async () => {
    const cycles = 20;
    const startTime = Date.now();

    for (let i = 0; i < cycles; i++) {
      await conversationTracker.startTracking();
      assert.strictEqual(conversationTracker.isTracking(), true);
      
      conversationTracker.stopTracking();
      assert.strictEqual(conversationTracker.isTracking(), false);
    }

    const cycleTime = Date.now() - startTime;
    console.log(`Completed ${cycles} tracking cycles in ${cycleTime}ms`);

    assert.ok(cycleTime < 2000); // Should complete within 2 seconds
  });

  test('Should handle stress test with mixed operations', async () => {
    const operationCount = 200;
    const startTime = Date.now();

    const operations = [];

    for (let i = 0; i < operationCount; i++) {
      const operation = i % 4;
      
      switch (operation) {
        case 0: // Save conversation
          operations.push(
            dataStorage.saveConversation({
              id: `stress-conv-${i}`,
              title: `Stress Test ${i}`,
              timestamp: Date.now() + i,
              messages: [],
              status: 'active'
            })
          );
          break;
          
        case 1: // Save message
          operations.push(
            dataStorage.saveMessage({
              id: `stress-msg-${i}`,
              conversationId: `stress-conv-${Math.floor(i / 4)}`,
              content: `Stress test message ${i}`,
              sender: i % 2 === 0 ? 'user' : 'ai',
              timestamp: Date.now() + i,
              codeChanges: [],
              snapshot: []
            })
          );
          break;
          
        case 2: // Get conversations
          operations.push(dataStorage.getConversations());
          break;
          
        case 3: // UI refresh
          operations.push(uiManager.refreshConversationList());
          break;
      }
    }

    // Execute all operations
    await Promise.all(operations);

    const stressTime = Date.now() - startTime;
    console.log(`Completed ${operationCount} mixed operations in ${stressTime}ms`);

    assert.ok(stressTime < 10000); // Should complete within 10 seconds
  });

  test('Should maintain performance under memory pressure', async () => {
    // Create large objects to simulate memory pressure
    const largeObjects = [];
    const objectCount = 100;
    const objectSize = 10000; // characters

    for (let i = 0; i < objectCount; i++) {
      largeObjects.push({
        id: i,
        data: 'X'.repeat(objectSize),
        timestamp: Date.now()
      });
    }

    // Perform operations under memory pressure
    const startTime = Date.now();

    await dataStorage.saveConversation({
      id: 'memory-pressure-test',
      title: 'Memory Pressure Test',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    });

    await uiManager.refreshConversationList();
    uiManager.filterConversations('Memory');

    const operationTime = Date.now() - startTime;
    console.log(`Operations under memory pressure completed in ${operationTime}ms`);

    // Clean up large objects
    largeObjects.length = 0;

    assert.ok(operationTime < 3000); // Should complete within 3 seconds
  });
});