import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { BackupManager } from '../cursor-companion/services/backupManager';
import { LocalFileStorage } from '../cursor-companion/services/localFileStorage';
import { Conversation, Message } from '../cursor-companion/models';

suite('BackupManager Tests', () => {
  let storage: LocalFileStorage;
  let backupManager: BackupManager;
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
        update: (key: string, value: any) => Promise.resolve(),
        keys: () => []
      },
      globalState: {
        get: (key: string) => undefined,
        update: (key: string, value: any) => Promise.resolve(),
        setKeysForSync: (keys: string[]) => {},
        keys: () => []
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
        delete: (key: string) => Promise.resolve(),
        onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
      },
      languageModelAccessInformation: {
        onDidChange: new vscode.EventEmitter<void>().event,
        canSendRequest: (chat: any) => false
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
    
    backupManager = new BackupManager(storage, mockContext, {
      enableAutoBackups: false // Disable auto backups for tests
    });
    await backupManager.initialize();
    
    // Create test data
    const conversation1 = createTestConversation('test-conv-1', 'JavaScript Performance Optimization');
    const conversation2 = createTestConversation('test-conv-2', 'React Component Architecture');
    
    await storage.saveConversation(conversation1);
    await storage.saveConversation(conversation2);
    
    const message1 = createTestMessage('test-msg-1', 'test-conv-1', 'How can I optimize the performance of my JavaScript application?');
    const message2 = createTestMessage('test-msg-2', 'test-conv-1', 'You should consider using memoization and reducing DOM manipulations.', 'ai');
    const message3 = createTestMessage('test-msg-3', 'test-conv-2', 'What is the best way to structure React components?');
    const message4 = createTestMessage('test-msg-4', 'test-conv-2', 'You should follow the single responsibility principle and use composition.', 'ai');
    
    await storage.saveMessage(message1);
    await storage.saveMessage(message2);
    await storage.saveMessage(message3);
    await storage.saveMessage(message4);
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
  
  test('Initialize creates backup directory', async () => {
    // Re-initialize to ensure directory is created
    await backupManager.initialize();
    
    // Check if backup directory exists
    const backupsDir = path.join(mockContext.globalStorageUri.fsPath, 'cursor-companion', 'backups');
    
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(backupsDir));
    } catch (error) {
      assert.fail('Backup directory was not created');
    }
  });
  
  test('Create and list backups', async () => {
    // Create a backup
    const backupId = await backupManager.createBackup({
      description: 'Test backup'
    });
    
    // List backups
    const backups = await backupManager.listBackups();
    
    // Verify
    assert.ok(backups.length > 0, 'Should have at least one backup');
    assert.ok(backups.some(b => b.id === backupId), 'Should include the created backup');
    assert.strictEqual(backups.find(b => b.id === backupId)?.description, 'Test backup', 'Backup should have correct description');
  });
  
  test('Create backup with specific conversations', async () => {
    // Create a backup with only one conversation
    const backupId = await backupManager.createBackup({
      description: 'Specific backup',
      conversationIds: ['test-conv-1']
    });
    
    // Delete all data
    await storage.deleteConversation('test-conv-1');
    await storage.deleteConversation('test-conv-2');
    
    // Restore from backup
    const result = await backupManager.restoreFromBackup(backupId, {
      createBackupBeforeRestore: false
    });
    
    // Verify
    assert.ok(result.success, 'Restore should succeed');
    assert.ok(result.restoredItems > 0, 'Should restore items');
    
    // Check if only the specified conversation was restored
    const conversations = await storage.getConversations();
    assert.strictEqual(conversations.length, 1, 'Should restore only one conversation');
    assert.strictEqual(conversations[0].id, 'test-conv-1', 'Should restore the correct conversation');
  });
  
  test('Restore from backup', async () => {
    // Create a backup
    const backupId = await backupManager.createBackup();
    
    // Delete all data
    await storage.deleteConversation('test-conv-1');
    await storage.deleteConversation('test-conv-2');
    
    // Verify data is deleted
    const conversationsBeforeRestore = await storage.getConversations();
    assert.strictEqual(conversationsBeforeRestore.length, 0, 'All conversations should be deleted');
    
    // Restore from backup
    const result = await backupManager.restoreFromBackup(backupId, {
      createBackupBeforeRestore: false
    });
    
    // Verify
    assert.ok(result.success, 'Restore should succeed');
    assert.ok(result.restoredItems > 0, 'Should restore items');
    
    // Check if data was restored
    const conversationsAfterRestore = await storage.getConversations();
    assert.strictEqual(conversationsAfterRestore.length, 2, 'Should restore both conversations');
    
    // Check messages
    const messages1 = await storage.getMessages('test-conv-1');
    const messages2 = await storage.getMessages('test-conv-2');
    
    assert.strictEqual(messages1.length, 2, 'Should restore messages for first conversation');
    assert.strictEqual(messages2.length, 2, 'Should restore messages for second conversation');
  });
  
  test('Delete backup', async () => {
    // Create a backup
    const backupId = await backupManager.createBackup();
    
    // Verify backup exists
    let backups = await backupManager.listBackups();
    assert.ok(backups.some(b => b.id === backupId), 'Backup should exist');
    
    // Delete backup
    await backupManager.deleteBackup(backupId);
    
    // Verify backup is deleted
    backups = await backupManager.listBackups();
    assert.ok(!backups.some(b => b.id === backupId), 'Backup should be deleted');
  });
  
  test('Clean up old backups', async () => {
    // Create multiple backups
    const backupId1 = await backupManager.createBackup({ description: 'Backup 1' });
    const backupId2 = await backupManager.createBackup({ description: 'Backup 2' });
    const backupId3 = await backupManager.createBackup({ description: 'Backup 3' });
    
    // Clean up old backups (keep only 1)
    const deletedCount = await backupManager.cleanupOldBackups(1, false);
    
    // Verify
    assert.ok(deletedCount > 0, 'Should delete some backups');
    
    // Check remaining backups
    const backups = await backupManager.listBackups();
    assert.strictEqual(backups.length, 1, 'Should keep only one backup');
    assert.strictEqual(backups[0].id, backupId3, 'Should keep the newest backup');
  });
  
  test('Create auto backup', async () => {
    // Create auto backup
    const backupId = await backupManager.createAutoBackup();
    
    // Verify
    assert.ok(backupId, 'Should return backup ID');
    
    // Check backup type
    const backups = await backupManager.listBackups();
    const backup = backups.find(b => b.id === backupId);
    
    assert.ok(backup, 'Backup should exist');
    assert.strictEqual(backup?.type, 'auto', 'Backup should be of type auto');
  });
});