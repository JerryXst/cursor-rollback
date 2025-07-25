import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConversationTracker } from '../cursor-companion/services/conversationTracker';
import { Conversation, Message } from '../cursor-companion/models';

suite('Cursor API Integration Tests', () => {
  let conversationTracker: ConversationTracker;
  let mockContext: vscode.ExtensionContext;
  let commandsStub: sinon.SinonStub;
  let newConversationSpy: sinon.SinonSpy;
  let newMessageSpy: sinon.SinonSpy;
  
  setup(() => {
    // Create mock extension context
    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: () => undefined,
        update: () => Promise.resolve(),
        keys: () => []
      },
      globalState: {
        get: () => undefined,
        update: () => Promise.resolve(),
        setKeysForSync: () => {},
        keys: () => []
      },
      extensionPath: '',
      storagePath: '',
      globalStoragePath: '',
      logPath: '',
      extensionUri: vscode.Uri.parse('file:///mock'),
      storageUri: vscode.Uri.parse('file:///mock/storage'),
      globalStorageUri: vscode.Uri.parse('file:///mock/global-storage'),
      logUri: vscode.Uri.parse('file:///mock/logs'),
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
      environmentVariableCollection: {} as any,
      extensionMode: vscode.ExtensionMode.Test,
      extension: {} as any,
      asAbsolutePath: (relativePath: string) => relativePath
    };
    
    // Stub vscode.commands.getCommands
    commandsStub = sinon.stub(vscode.commands, 'getCommands').resolves([
      'cursor.agent.listCheckpoints',
      'cursor.agent.restoreCheckpoint',
      'cursor.chat.duplicate',
      'cursor.chat.new'
    ]);
    
    // Create conversation tracker
    conversationTracker = new ConversationTracker(mockContext);
    
    // Set up spies for callbacks
    newConversationSpy = sinon.spy();
    newMessageSpy = sinon.spy();
    
    conversationTracker.onNewConversation(newConversationSpy);
    conversationTracker.onNewMessage(newMessageSpy);
  });
  
  teardown(() => {
    // Restore stubs
    commandsStub.restore();
    
    // Stop tracking
    conversationTracker.stopTracking();
  });
  
  test('Should detect Cursor commands availability', async () => {
    await conversationTracker.startTracking();
    assert.strictEqual(conversationTracker.isTracking(), true);
  });
  
  test('Should create new conversation on chat.new command', async () => {
    await conversationTracker.startTracking();
    
    // Simulate cursor.chat.new command
    await vscode.commands.executeCommand('_internal.cursorCompanion.chatCommandExecuted', 'cursor.chat.new', {});
    
    // Check if new conversation was created
    assert.strictEqual(newConversationSpy.calledOnce, true);
    assert.strictEqual(newMessageSpy.calledOnce, true);
    
    const conversation: Conversation = newConversationSpy.args[0][0];
    assert.strictEqual(conversation.status, 'active');
  });
  
  test('Should create new message on chat.submit command', async () => {
    await conversationTracker.startTracking();
    
    // First create a conversation
    await vscode.commands.executeCommand('_internal.cursorCompanion.chatCommandExecuted', 'cursor.chat.new', {});
    
    // Reset spies
    newConversationSpy.resetHistory();
    newMessageSpy.resetHistory();
    
    // Simulate user message
    await vscode.commands.executeCommand('_internal.cursorCompanion.chatCommandExecuted', 'cursor.chat.submit', {
      message: 'Test user message'
    });
    
    // Check if new message was created but not a new conversation
    assert.strictEqual(newConversationSpy.called, false);
    assert.strictEqual(newMessageSpy.calledOnce, true);
    
    const message: Message = newMessageSpy.args[0][0];
    assert.strictEqual(message.sender, 'user');
    assert.strictEqual(message.content, 'Test user message');
  });
  
  test('Should create new message on chat.response command', async () => {
    await conversationTracker.startTracking();
    
    // First create a conversation
    await vscode.commands.executeCommand('_internal.cursorCompanion.chatCommandExecuted', 'cursor.chat.new', {});
    
    // Reset spies
    newConversationSpy.resetHistory();
    newMessageSpy.resetHistory();
    
    // Simulate AI response
    await vscode.commands.executeCommand('_internal.cursorCompanion.chatCommandExecuted', 'cursor.chat.response', {
      message: 'Test AI response'
    });
    
    // Check if new message was created but not a new conversation
    assert.strictEqual(newConversationSpy.called, false);
    assert.strictEqual(newMessageSpy.calledOnce, true);
    
    const message: Message = newMessageSpy.args[0][0];
    assert.strictEqual(message.sender, 'ai');
    assert.strictEqual(message.content, 'Test AI response');
  });
  
  test('Should create new conversation after boundary time', async () => {
    await conversationTracker.startTracking();
    
    // Access private field for testing
    const tracker = conversationTracker as any;
    
    // Override conversation boundary time for testing
    tracker.CONVERSATION_BOUNDARY_TIME = 100; // 100ms for testing
    
    // First create a conversation
    await vscode.commands.executeCommand('_internal.cursorCompanion.chatCommandExecuted', 'cursor.chat.new', {});
    
    // Reset spies
    newConversationSpy.resetHistory();
    newMessageSpy.resetHistory();
    
    // Set last activity to simulate time passing
    tracker.lastCursorActivity = Date.now() - 200; // 200ms ago
    
    // Trigger boundary check
    tracker.checkConversationBoundary();
    
    // Now simulate a new message - should create a new conversation
    await vscode.commands.executeCommand('_internal.cursorCompanion.chatCommandExecuted', 'cursor.chat.submit', {
      message: 'New conversation message'
    });
    
    // Should have created a new conversation
    assert.strictEqual(newConversationSpy.calledOnce, true);
    assert.strictEqual(newMessageSpy.calledOnce, true);
  });
  
  test('Should track checkpoint restore', async () => {
    await conversationTracker.startTracking();
    
    // First create a conversation
    await vscode.commands.executeCommand('_internal.cursorCompanion.chatCommandExecuted', 'cursor.chat.new', {});
    
    // Reset spies
    newConversationSpy.resetHistory();
    newMessageSpy.resetHistory();
    
    // Simulate checkpoint restore
    await vscode.commands.executeCommand('_internal.cursorCompanion.agentCommandExecuted', 'cursor.agent.restoreCheckpoint', {
      id: 'test-checkpoint-id'
    });
    
    // Should have created a new message about the restore
    assert.strictEqual(newConversationSpy.called, false);
    assert.strictEqual(newMessageSpy.calledOnce, true);
    
    const message: Message = newMessageSpy.args[0][0];
    assert.strictEqual(message.sender, 'ai');
    assert.ok(message.content.includes('checkpoint'));
  });
});