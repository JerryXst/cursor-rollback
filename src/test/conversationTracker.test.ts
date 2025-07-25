import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConversationTracker } from '../cursor-companion/services/conversationTracker';
import { Conversation, Message } from '../cursor-companion/models';

suite('ConversationTracker Tests', () => {
  let tracker: ConversationTracker;
  let mockContext: vscode.ExtensionContext;
  let mockFileSystemWatcher: vscode.FileSystemWatcher;
  let onDidChangeCallback: (uri: vscode.Uri) => Promise<void>;
  let onDidCreateCallback: (uri: vscode.Uri) => Promise<void>;
  let onDidDeleteCallback: (uri: vscode.Uri) => Promise<void>;
  
  const mockUri = { fsPath: '/test/path/file.ts' } as vscode.Uri;
  
  setup(() => {
    // Mock VSCode workspace
    sinon.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: { fsPath: '/test/workspace' } } as vscode.WorkspaceFolder
    ]);
    
    // Mock file system watcher
    mockFileSystemWatcher = {
      onDidChange: (callback: any) => {
        onDidChangeCallback = callback;
        return { dispose: () => {} };
      },
      onDidCreate: (callback: any) => {
        onDidCreateCallback = callback;
        return { dispose: () => {} };
      },
      onDidDelete: (callback: any) => {
        onDidDeleteCallback = callback;
        return { dispose: () => {} };
      },
      dispose: () => {}
    } as unknown as vscode.FileSystemWatcher;
    
    sinon.stub(vscode.workspace, 'createFileSystemWatcher').returns(mockFileSystemWatcher);
    
    // Mock document reading
    sinon.stub(vscode.workspace, 'openTextDocument').resolves({
      getText: () => 'test file content'
    } as unknown as vscode.TextDocument);
    
    // Create mock extension context
    mockContext = {
      subscriptions: []
    } as unknown as vscode.ExtensionContext;
    
    // Create tracker instance
    tracker = new ConversationTracker(mockContext);
  });
  
  teardown(() => {
    sinon.restore();
  });
  
  test('Should initialize file system watcher on start tracking', async () => {
    await tracker.startTracking();
    
    assert.strictEqual(tracker.isTracking(), true);
    assert.strictEqual((vscode.workspace.createFileSystemWatcher as sinon.SinonStub).called, true);
  });
  
  test('Should stop tracking and clean up resources', async () => {
    await tracker.startTracking();
    tracker.stopTracking();
    
    assert.strictEqual(tracker.isTracking(), false);
  });
  
  test('Should notify about new conversations', async () => {
    const conversationCallback = sinon.spy();
    tracker.onNewConversation(conversationCallback);
    
    await tracker.startTracking();
    
    // Trigger a file change to create a conversation
    await onDidChangeCallback(mockUri);
    
    // Wait for the buffer timeout
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    assert.strictEqual(conversationCallback.called, true);
    const conversation = conversationCallback.firstCall.args[0] as Conversation;
    assert.ok(conversation.id);
    assert.strictEqual(conversation.status, 'active');
  });
  
  test('Should notify about new messages', async () => {
    const messageCallback = sinon.spy();
    tracker.onNewMessage(messageCallback);
    
    await tracker.startTracking();
    
    // Trigger a file change to create a message
    await onDidChangeCallback(mockUri);
    
    // Wait for the buffer timeout
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    assert.strictEqual(messageCallback.called, true);
    assert.strictEqual(messageCallback.callCount, 2); // Initial user message + AI message with changes
    
    const message = messageCallback.secondCall.args[0] as Message;
    assert.ok(message.id);
    assert.strictEqual(message.sender, 'ai');
    assert.ok(message.codeChanges.length > 0);
  });
  
  test('Should handle file creation events', async () => {
    const messageCallback = sinon.spy();
    tracker.onNewMessage(messageCallback);
    
    await tracker.startTracking();
    
    // Trigger a file creation
    await onDidCreateCallback(mockUri);
    
    // Wait for the buffer timeout
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    assert.strictEqual(messageCallback.called, true);
    const message = messageCallback.secondCall.args[0] as Message;
    assert.strictEqual(message.codeChanges[0].changeType, 'create');
  });
  
  test('Should handle file deletion events', async () => {
    const messageCallback = sinon.spy();
    tracker.onNewMessage(messageCallback);
    
    await tracker.startTracking();
    
    // Trigger a file deletion
    await onDidDeleteCallback(mockUri);
    
    // Wait for the buffer timeout
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    assert.strictEqual(messageCallback.called, true);
    const message = messageCallback.secondCall.args[0] as Message;
    assert.strictEqual(message.codeChanges[0].changeType, 'delete');
  });
  
  test('Should ignore files matching ignore patterns', async () => {
    const messageCallback = sinon.spy();
    tracker.onNewMessage(messageCallback);
    
    await tracker.startTracking();
    
    // Trigger a file change for an ignored file
    await onDidChangeCallback({ fsPath: '/test/path/node_modules/file.js' } as vscode.Uri);
    
    // Wait for the buffer timeout
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    assert.strictEqual(messageCallback.called, false);
  });
  
  test('Should handle errors gracefully', async () => {
    const errorCallback = sinon.spy();
    tracker.onTrackingError(errorCallback);
    
    // Force an error by making openTextDocument throw
    sinon.restore();
    sinon.stub(vscode.workspace, 'openTextDocument').rejects(new Error('Test error'));
    
    await tracker.startTracking();
    
    // Trigger a file change
    await onDidChangeCallback(mockUri);
    
    assert.strictEqual(errorCallback.called, true);
  });
});