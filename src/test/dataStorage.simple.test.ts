/**
 * Basic unit tests for Data Storage service
 */

// Using global mocha functions
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { DataStorage } from '../cursor-companion/services/dataStorage';
import { Conversation, Message } from '../cursor-companion/models';

suite('DataStorage Basic Tests', () => {
  let dataStorage: DataStorage;
  let mockContext: vscode.ExtensionContext;
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Mock extension context
    mockContext = {
      subscriptions: [],
      globalState: {
        get: sandbox.stub(),
        update: sandbox.stub()
      },
      workspaceState: {
        get: sandbox.stub(),
        update: sandbox.stub()
      },
      globalStorageUri: {
        fsPath: '/mock/storage/path'
      },
      extensionPath: '/mock/extension/path'
    } as any;

    // Mock VSCode file system
    sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
    sandbox.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('{}'));
    sandbox.stub(vscode.workspace.fs, 'writeFile').resolves();
    sandbox.stub(vscode.workspace.fs, 'stat').resolves({
      type: vscode.FileType.File,
      ctime: Date.now(),
      mtime: Date.now(),
      size: 100
    });

    dataStorage = new DataStorage(mockContext);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('initialization', () => {
    test('should create data storage instance', () => {
      assert.ok(dataStorage);
    });

    test('should initialize successfully', async () => {
      await dataStorage.initialize();
      
      // Should not throw error
      assert.ok(true);
    });
  });

  suite('conversation operations', () => {
    const sampleConversation: Conversation = {
      id: 'conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };

    setup(async () => {
      await dataStorage.initialize();
    });

    test('should save conversation', async () => {
      await dataStorage.saveConversation(sampleConversation);
      
      // Should not throw error
      assert.ok(true);
    });

    test('should get conversations', async () => {
      const result = await dataStorage.getConversations();
      
      assert.ok(Array.isArray(result));
    });

    test('should get conversation by ID', async () => {
      const result = await dataStorage.getConversation('conv-1');
      
      // Should return null or conversation object
      assert.ok(result === null || typeof result === 'object');
    });

    test('should archive conversation', async () => {
      // Mock existing conversation
      sandbox.stub(dataStorage, 'getConversation').resolves(sampleConversation);
      
      await dataStorage.archiveConversation('conv-1');
      
      // Should not throw error
      assert.ok(true);
    });
  });

  suite('message operations', () => {
    const sampleMessage: Message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      content: 'Test message',
      sender: 'user',
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: []
    };

    setup(async () => {
      await dataStorage.initialize();
    });

    test('should save message', async () => {
      await dataStorage.saveMessage(sampleMessage);
      
      // Should not throw error
      assert.ok(true);
    });

    test('should get messages for conversation', async () => {
      const result = await dataStorage.getMessages('conv-1');
      
      assert.ok(Array.isArray(result));
    });

    test('should get message by ID', async () => {
      const result = await dataStorage.getMessage('msg-1');
      
      // Should return null or message object
      assert.ok(result === null || typeof result === 'object');
    });
  });

  suite('error handling', () => {
    test('should handle file system errors gracefully', async () => {
      // Mock file system error
      sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));
      
      const result = await dataStorage.getConversations();
      
      // Should return empty array on error
      assert.ok(Array.isArray(result));
    });
  });
});