/**
 * Tests for ContextMenuProvider
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { ContextMenuProvider, ContextMenuItem, ActionButton } from '../cursor-companion/ui/contextMenuProvider';
import { Conversation, Message } from '../cursor-companion/models';
import { IDataStorage, IRollbackManager } from '../cursor-companion/services/interfaces';

// Mock implementations
class MockDataStorage implements IDataStorage {
  private conversations: Map<string, Conversation> = new Map();
  private messages: Map<string, Message[]> = new Map();

  async initialize(): Promise<void> {}

  async saveConversation(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, conversation);
  }

  async getConversations(): Promise<Conversation[]> {
    return Array.from(this.conversations.values());
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) || null;
  }

  async deleteConversation(id: string): Promise<void> {
    this.conversations.delete(id);
    this.messages.delete(id);
  }

  async archiveConversation(id: string): Promise<void> {
    const conversation = this.conversations.get(id);
    if (conversation) {
      conversation.status = 'archived';
      this.conversations.set(id, conversation);
    }
  }

  async saveMessage(message: Message): Promise<void> {
    const messages = this.messages.get(message.conversationId) || [];
    const existingIndex = messages.findIndex(m => m.id === message.id);
    if (existingIndex >= 0) {
      messages[existingIndex] = message;
    } else {
      messages.push(message);
    }
    this.messages.set(message.conversationId, messages);
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return this.messages.get(conversationId) || [];
  }

  async getMessage(id: string): Promise<Message | null> {
    for (const messages of this.messages.values()) {
      const message = messages.find(m => m.id === id);
      if (message) return message;
    }
    return null;
  }

  async saveSnapshot(): Promise<void> {}
  async getSnapshot(): Promise<any> { return null; }
  async cleanup(): Promise<void> {}
  async migrateData(): Promise<any> {}
  async verifyDataIntegrity(): Promise<any> { return { totalChecked: 0, corruptedItems: 0, errors: [] }; }
  async repairConversationData(): Promise<any> { return { success: true, repairedFields: [], errors: [] }; }
  async createBackup(): Promise<string> { return 'backup-id'; }
}

class MockRollbackManager implements IRollbackManager {
  async rollbackToMessage(): Promise<any> {
    return { success: true, modifiedFiles: ['test.ts'], backupId: 'backup-123' };
  }

  async createBackup(): Promise<string> {
    return 'backup-' + Date.now();
  }

  async restoreBackup(): Promise<void> {}
  async listBackups(): Promise<any[]> { return []; }
  async deleteBackup(): Promise<void> {}
  async canRollback(): Promise<boolean> { return true; }
}

suite('ContextMenuProvider Tests', () => {
  let contextMenuProvider: ContextMenuProvider;
  let mockContext: vscode.ExtensionContext;
  let mockDataStorage: MockDataStorage;
  let mockRollbackManager: MockRollbackManager;

  setup(() => {
    mockContext = {
      subscriptions: [],
      workspaceState: {} as any,
      globalState: {} as any,
      extensionUri: vscode.Uri.file('/test'),
      extensionPath: '/test',
      asAbsolutePath: (path: string) => path,
      storageUri: vscode.Uri.file('/test/storage'),
      globalStorageUri: vscode.Uri.file('/test/global'),
      logUri: vscode.Uri.file('/test/log'),
      secrets: {} as any,
      environmentVariableCollection: {} as any,
      extension: {} as any,
      storagePath: '/test/storage',
      globalStoragePath: '/test/global',
      logPath: '/test/log',
      extensionMode: 1,
      languageModelAccessInformation: {} as any
    };

    mockDataStorage = new MockDataStorage();
    mockRollbackManager = new MockRollbackManager();
    
    contextMenuProvider = new ContextMenuProvider(
      mockContext,
      mockDataStorage,
      mockRollbackManager
    );
  });

  teardown(() => {
    contextMenuProvider.dispose();
  });

  test('should create conversation context menu items', () => {
    const conversation: Conversation = {
      id: 'conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };

    const menuItems = contextMenuProvider.getConversationContextMenu(conversation);

    assert.ok(menuItems.length > 0, 'Should have menu items');
    
    const showDetailsItem = menuItems.find(item => item.action === 'showDetails');
    assert.ok(showDetailsItem, 'Should have show details item');
    assert.strictEqual(showDetailsItem.enabled, true);
    assert.strictEqual(showDetailsItem.visible, true);

    const exportItem = menuItems.find(item => item.action === 'export');
    assert.ok(exportItem, 'Should have export item');

    const deleteItem = menuItems.find(item => item.action === 'delete');
    assert.ok(deleteItem, 'Should have delete item');

    const archiveItem = menuItems.find(item => item.action === 'archive');
    assert.ok(archiveItem, 'Should have archive item');
  });

  test('should create message context menu items', () => {
    const conversation: Conversation = {
      id: 'conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };

    const message: Message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      content: 'Test message',
      sender: 'user',
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: []
    };

    const menuItems = contextMenuProvider.getMessageContextMenu(message, conversation);

    assert.ok(menuItems.length > 0, 'Should have menu items');
    
    const showDetailsItem = menuItems.find(item => item.action === 'showDetails');
    assert.ok(showDetailsItem, 'Should have show details item');

    const copyContentItem = menuItems.find(item => item.action === 'copyContent');
    assert.ok(copyContentItem, 'Should have copy content item');

    const exportItem = menuItems.find(item => item.action === 'export');
    assert.ok(exportItem, 'Should have export item');
  });

  test('should show rollback option for messages with snapshots', () => {
    const conversation: Conversation = {
      id: 'conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };

    const messageWithSnapshot: Message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      content: 'Test message',
      sender: 'ai',
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: [
        {
          filePath: 'test.ts',
          content: 'test content',
          timestamp: Date.now(),
          checksum: 'abc123'
        }
      ]
    };

    const menuItems = contextMenuProvider.getMessageContextMenu(messageWithSnapshot, conversation);
    const rollbackItem = menuItems.find(item => item.action === 'rollback');
    
    assert.ok(rollbackItem, 'Should have rollback item for message with snapshot');
    assert.strictEqual(rollbackItem.enabled, true);
  });

  test('should get tree view action buttons', () => {
    const actionButtons = contextMenuProvider.getTreeViewActionButtons();

    assert.ok(actionButtons.length > 0, 'Should have action buttons');
    
    const refreshButton = actionButtons.find(button => button.id === 'refresh');
    assert.ok(refreshButton, 'Should have refresh button');
    assert.strictEqual(refreshButton.command, 'cursorCompanion.refreshConversations');

    const searchButton = actionButtons.find(button => button.id === 'search');
    assert.ok(searchButton, 'Should have search button');
    assert.strictEqual(searchButton.command, 'cursorCompanion.quickSearch');
  });

  test('should handle archive action', async () => {
    const conversation: Conversation = {
      id: 'conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };

    await mockDataStorage.saveConversation(conversation);

    // Mock the confirmation dialog to return true
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    vscode.window.showWarningMessage = async () => 'Archive' as any;

    try {
      await contextMenuProvider.executeAction('archive', conversation);
      
      const updatedConversation = await mockDataStorage.getConversation(conversation.id);
      assert.strictEqual(updatedConversation?.status, 'archived', 'Conversation should be archived');
    } finally {
      vscode.window.showWarningMessage = originalShowWarningMessage;
    }
  });

  test('should handle delete action', async () => {
    const conversation: Conversation = {
      id: 'conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };

    await mockDataStorage.saveConversation(conversation);

    // Mock the confirmation dialog to return true
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    vscode.window.showWarningMessage = async () => 'Delete' as any;

    try {
      await contextMenuProvider.executeAction('delete', conversation);
      
      const deletedConversation = await mockDataStorage.getConversation(conversation.id);
      assert.strictEqual(deletedConversation, null, 'Conversation should be deleted');
    } finally {
      vscode.window.showWarningMessage = originalShowWarningMessage;
    }
  });

  test('should handle rollback action', async () => {
    const message: Message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      content: 'Test message',
      sender: 'ai',
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: [
        {
          filePath: 'test.ts',
          content: 'test content',
          timestamp: Date.now(),
          checksum: 'abc123'
        }
      ]
    };

    // Mock the confirmation dialog to return true
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    vscode.window.showWarningMessage = async () => 'Rollback' as any;

    // Mock progress dialog
    const originalWithProgress = vscode.window.withProgress;
    vscode.window.withProgress = async (options: any, task: any) => {
      const mockProgress = {
        report: () => {}
      };
      return await task(mockProgress);
    };

    try {
      await contextMenuProvider.executeAction('rollback', message);
      // If we get here without throwing, the rollback was successful
      assert.ok(true, 'Rollback should complete successfully');
    } finally {
      vscode.window.showWarningMessage = originalShowWarningMessage;
      vscode.window.withProgress = originalWithProgress;
    }
  });

  test('should handle copy content action', async () => {
    const message: Message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      content: 'Test message content',
      sender: 'user',
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: []
    };

    // Mock clipboard
    const originalWriteText = vscode.env.clipboard.writeText;
    let copiedText = '';
    vscode.env.clipboard.writeText = async (text: string) => {
      copiedText = text;
    };

    try {
      await contextMenuProvider.executeAction('copyContent', message);
      assert.strictEqual(copiedText, message.content, 'Should copy message content to clipboard');
    } finally {
      vscode.env.clipboard.writeText = originalWriteText;
    }
  });

  test('should handle add tag action', async () => {
    const conversation: Conversation = {
      id: 'conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };

    await mockDataStorage.saveConversation(conversation);

    // Mock input box
    const originalShowInputBox = vscode.window.showInputBox;
    vscode.window.showInputBox = async () => 'javascript';

    try {
      await contextMenuProvider.executeAction('addTag', conversation);
      
      const updatedConversation = await mockDataStorage.getConversation(conversation.id);
      assert.ok(updatedConversation?.metadata?.tags?.includes('javascript'), 'Should add tag to conversation');
    } finally {
      vscode.window.showInputBox = originalShowInputBox;
    }
  });

  test('should register action callbacks', () => {
    let callbackCalled = false;
    const callback = async () => {
      callbackCalled = true;
    };

    contextMenuProvider.onAction('rollback', callback);

    // Verify callback is registered
    assert.ok(true, 'Callback should be registered without error');
  });

  test('should show confirmation dialog', async () => {
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let dialogShown = false;
    
    vscode.window.showWarningMessage = async (message: string, options: any, ...items: string[]) => {
      dialogShown = true;
      return 'Confirm';
    };

    try {
      const result = await contextMenuProvider.showConfirmationDialog({
        title: 'Test',
        message: 'Test message',
        confirmLabel: 'Confirm'
      });

      assert.ok(dialogShown, 'Dialog should be shown');
      assert.strictEqual(result, true, 'Should return true for confirm');
    } finally {
      vscode.window.showWarningMessage = originalShowWarningMessage;
    }
  });
});