import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { LocalFileStorage } from '../cursor-companion/services/localFileStorage';
import { Conversation, Message, FileSnapshot, SnapshotCollection } from '../cursor-companion/models';

suite('LocalFileStorage Tests', () => {
  let storage: LocalFileStorage;
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
  const createTestConversation = (id: string): Conversation => {
    return {
      id,
      title: `Test Conversation ${id}`,
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
  const createTestMessage = (id: string, conversationId: string): Message => {
    return {
      id,
      conversationId,
      content: `Test message content ${id}`,
      sender: 'user',
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: []
    };
  };
  
  // Helper to create a test file snapshot
  const createTestFileSnapshot = (filePath: string): FileSnapshot => {
    const content = `Test file content for ${filePath}`;
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    
    return {
      filePath,
      content,
      timestamp: Date.now(),
      checksum,
      metadata: {
        size: content.length,
        encoding: 'utf8',
        language: 'plaintext'
      }
    };
  };
  
  // Helper to create a test snapshot collection
  const createTestSnapshotCollection = (id: string, messageId: string): SnapshotCollection => {
    return {
      id,
      messageId,
      timestamp: Date.now(),
      snapshots: [
        createTestFileSnapshot('test/file1.txt'),
        createTestFileSnapshot('test/file2.js')
      ]
    };
  };
  
  // Setup test environment
  setup(async () => {
    mockContext = createMockContext();
    storage = new LocalFileStorage(mockContext);
    await storage.initialize();
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
  
  test('Initialize creates required directories', async () => {
    // Re-initialize to ensure directories are created
    await storage.initialize();
    
    // Check if directories exist
    const storageRoot = path.join(mockContext.globalStorageUri.fsPath, 'cursor-companion');
    const dirs = [
      storageRoot,
      path.join(storageRoot, 'conversations'),
      path.join(storageRoot, 'messages'),
      path.join(storageRoot, 'snapshots'),
      path.join(storageRoot, 'backups'),
      path.join(storageRoot, 'indexes'),
      path.join(storageRoot, 'temp')
    ];
    
    for (const dir of dirs) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(dir));
      } catch (error) {
        assert.fail(`Directory ${dir} was not created`);
      }
    }
  });
  
  test('Save and retrieve conversation', async () => {
    const conversation = createTestConversation('test-conv-1');
    
    // Save conversation
    await storage.saveConversation(conversation);
    
    // Retrieve conversation
    const retrieved = await storage.getConversation('test-conv-1');
    
    // Verify
    assert.ok(retrieved, 'Conversation should be retrieved');
    assert.strictEqual(retrieved?.id, conversation.id);
    assert.strictEqual(retrieved?.title, conversation.title);
    assert.strictEqual(retrieved?.status, conversation.status);
  });
  
  test('Save and retrieve message', async () => {
    // Create and save conversation first
    const conversation = createTestConversation('test-conv-2');
    await storage.saveConversation(conversation);
    
    // Create and save message
    const message = createTestMessage('test-msg-1', 'test-conv-2');
    await storage.saveMessage(message);
    
    // Retrieve message
    const retrieved = await storage.getMessage('test-msg-1');
    
    // Verify
    assert.ok(retrieved, 'Message should be retrieved');
    assert.strictEqual(retrieved?.id, message.id);
    assert.strictEqual(retrieved?.conversationId, message.conversationId);
    assert.strictEqual(retrieved?.content, message.content);
    assert.strictEqual(retrieved?.sender, message.sender);
  });
  
  test('Save and retrieve snapshot', async () => {
    // Create and save message first
    const conversation = createTestConversation('test-conv-3');
    await storage.saveConversation(conversation);
    
    const message = createTestMessage('test-msg-2', 'test-conv-3');
    await storage.saveMessage(message);
    
    // Create and save snapshot
    const snapshot = createTestSnapshotCollection('test-snap-1', 'test-msg-2');
    await storage.saveSnapshot(snapshot);
    
    // Retrieve snapshot
    const retrieved = await storage.getSnapshot('test-msg-2');
    
    // Verify
    assert.ok(retrieved, 'Snapshot should be retrieved');
    assert.strictEqual(retrieved?.id, snapshot.id);
    assert.strictEqual(retrieved?.messageId, snapshot.messageId);
    assert.strictEqual(retrieved?.snapshots.length, snapshot.snapshots.length);
  });
  
  test('Delete conversation', async () => {
    // Create and save conversation
    const conversation = createTestConversation('test-conv-4');
    await storage.saveConversation(conversation);
    
    // Verify it exists
    let retrieved = await storage.getConversation('test-conv-4');
    assert.ok(retrieved, 'Conversation should exist before deletion');
    
    // Delete conversation
    await storage.deleteConversation('test-conv-4');
    
    // Verify it's gone
    retrieved = await storage.getConversation('test-conv-4');
    assert.strictEqual(retrieved, null, 'Conversation should be deleted');
  });
  
  test('Archive conversation', async () => {
    // Create and save conversation
    const conversation = createTestConversation('test-conv-5');
    await storage.saveConversation(conversation);
    
    // Archive conversation
    await storage.archiveConversation('test-conv-5');
    
    // Verify it's archived
    const retrieved = await storage.getConversation('test-conv-5');
    assert.strictEqual(retrieved?.status, 'archived', 'Conversation should be archived');
  });
  
  test('Get conversations with filtering', async () => {
    // Create and save multiple conversations
    const conv1 = createTestConversation('test-conv-6');
    const conv2 = createTestConversation('test-conv-7');
    conv2.status = 'archived';
    
    await storage.saveConversation(conv1);
    await storage.saveConversation(conv2);
    
    // Get all conversations
    const allConvs = await storage.getConversations();
    assert.ok(allConvs.length >= 2, 'Should retrieve all conversations');
    
    // Filter by status
    const activeConvs = await storage.getConversations({ status: 'active' });
    assert.ok(activeConvs.some(c => c.id === 'test-conv-6'), 'Should include active conversation');
    assert.ok(!activeConvs.some(c => c.id === 'test-conv-7'), 'Should not include archived conversation');
    
    const archivedConvs = await storage.getConversations({ status: 'archived' });
    assert.ok(!archivedConvs.some(c => c.id === 'test-conv-6'), 'Should not include active conversation');
    assert.ok(archivedConvs.some(c => c.id === 'test-conv-7'), 'Should include archived conversation');
  });
  
  test('Get messages for conversation', async () => {
    // Create and save conversation
    const conversation = createTestConversation('test-conv-8');
    await storage.saveConversation(conversation);
    
    // Create and save messages
    const msg1 = createTestMessage('test-msg-3', 'test-conv-8');
    const msg2 = createTestMessage('test-msg-4', 'test-conv-8');
    
    await storage.saveMessage(msg1);
    await storage.saveMessage(msg2);
    
    // Get messages for conversation
    const messages = await storage.getMessages('test-conv-8');
    
    // Verify
    assert.strictEqual(messages.length, 2, 'Should retrieve both messages');
    assert.ok(messages.some(m => m.id === 'test-msg-3'), 'Should include first message');
    assert.ok(messages.some(m => m.id === 'test-msg-4'), 'Should include second message');
  });
  
  test('Create backup', async () => {
    // Create and save conversation with messages
    const conversation = createTestConversation('test-conv-9');
    await storage.saveConversation(conversation);
    
    const message = createTestMessage('test-msg-5', 'test-conv-9');
    await storage.saveMessage(message);
    
    // Create backup
    const backupId = await storage.createBackup('test-conv-9');
    
    // Verify backup ID is returned
    assert.ok(backupId, 'Backup ID should be returned');
    assert.ok(backupId.includes('backup-test-conv-9-'), 'Backup ID should include conversation ID');
  });
  
  test('Verify data integrity', async () => {
    // Create and save valid conversation
    const conversation = createTestConversation('test-conv-10');
    await storage.saveConversation(conversation);
    
    // Verify integrity
    const result = await storage.verifyDataIntegrity();
    
    // Verify
    assert.ok(result.totalChecked > 0, 'Should check at least one item');
    assert.strictEqual(result.corruptedItems, 0, 'Should not find corrupted items');
    assert.strictEqual(result.errors.length, 0, 'Should not have errors');
  });
});