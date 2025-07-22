import * as vscode from 'vscode';
import { ConversationTreeProvider } from './conversationTreeProvider';
import { IDataStorage, IRollbackManager, IUIManager } from '../services/interfaces';

/**
 * Manages all UI components for Cursor Companion
 */
export class UIManager implements IUIManager {
  private conversationTreeProvider: ConversationTreeProvider;
  private conversationTreeView: vscode.TreeView<any>;
  private rollbackCallbacks: Array<(messageId: string) => void> = [];

  constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage,
    private rollbackManager: IRollbackManager
  ) {
    this.conversationTreeProvider = new ConversationTreeProvider(dataStorage);
    
    // Create tree view
    this.conversationTreeView = vscode.window.createTreeView('cursorCompanionConversations', {
      treeDataProvider: this.conversationTreeProvider,
      showCollapseAll: true,
      canSelectMany: false
    });
  }

  async initialize(): Promise<void> {
    try {
      // Register commands
      this.registerCommands();
      
      // Load initial data
      await this.conversationTreeProvider.loadConversations();
      
      // Set up event listeners
      this.setupEventListeners();
      
      console.log('Cursor Companion UI initialized');
    } catch (error) {
      throw new Error(`Failed to initialize UI: ${error}`);
    }
  }

  showConversationPanel(): void {
    // Focus on the conversation tree view
    this.conversationTreeView.reveal(undefined, { focus: true, select: false });
  }

  refreshConversationList(): void {
    this.conversationTreeProvider.refresh();
  }

  filterConversations(query: string): void {
    this.conversationTreeProvider.filterConversations(query);
  }

  onRollbackRequest(callback: (messageId: string) => void): void {
    this.rollbackCallbacks.push(callback);
  }

  private registerCommands(): void {
    // Refresh conversations
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.refreshConversations', () => {
        this.conversationTreeProvider.loadConversations();
      })
    );

    // Search conversations
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.searchConversations', async () => {
        const query = await vscode.window.showInputBox({
          prompt: 'Search conversations',
          placeHolder: 'Enter search terms...'
        });

        if (query !== undefined) {
          this.filterConversations(query);
        }
      })
    );

    // Show message details
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.showMessageDetails', async (messageId: string) => {
        await this.showMessageDetails(messageId);
      })
    );

    // Rollback to message
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.rollbackToMessage', async (messageId: string) => {
        await this.handleRollbackRequest(messageId);
      })
    );

    // Archive conversation
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.archiveConversation', async (item: any) => {
        if (item && item.conversation) {
          await this.conversationTreeProvider.archiveConversation(item.conversation.id);
        }
      })
    );

    // Delete conversation
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.deleteConversation', async (item: any) => {
        if (item && item.conversation) {
          await this.conversationTreeProvider.deleteConversation(item.conversation.id);
        }
      })
    );

    // Show rollback options
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.showRollbackOptions', async () => {
        await this.showRollbackOptions();
      })
    );
  }

  private setupEventListeners(): void {
    // Listen for tree view selection changes
    this.conversationTreeView.onDidChangeSelection(event => {
      // Handle selection changes if needed
    });

    // Listen for tree view expansion
    this.conversationTreeView.onDidExpandElement(event => {
      if (event.element && event.element.conversation) {
        this.conversationTreeProvider.expandConversation(event.element.conversation.id);
      }
    });

    // Listen for tree view collapse
    this.conversationTreeView.onDidCollapseElement(event => {
      if (event.element && event.element.conversation) {
        this.conversationTreeProvider.collapseConversation(event.element.conversation.id);
      }
    });
  }

  private async showMessageDetails(messageId: string): Promise<void> {
    try {
      const message = await this.dataStorage.getMessage(messageId);
      if (!message) {
        vscode.window.showErrorMessage('Message not found');
        return;
      }

      // Create a webview to show message details
      const panel = vscode.window.createWebviewPanel(
        'messageDetails',
        'Message Details',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      panel.webview.html = this.getMessageDetailsHtml(message);

      // Handle messages from the webview
      panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
          case 'rollback':
            await this.handleRollbackRequest(messageId);
            break;
        }
      });

    } catch (error) {
      console.error(`Failed to show message details for ${messageId}:`, error);
      vscode.window.showErrorMessage('Failed to show message details');
    }
  }

  private async handleRollbackRequest(messageId: string): Promise<void> {
    try {
      // Check if rollback is possible
      const canRollback = await this.rollbackManager.canRollback(messageId);
      if (!canRollback) {
        vscode.window.showWarningMessage('Cannot rollback to this message - no snapshot available');
        return;
      }

      // Confirm rollback
      const result = await vscode.window.showWarningMessage(
        'Are you sure you want to rollback to this message? This will restore your code to the state at this point in the conversation.',
        { modal: true },
        'Rollback'
      );

      if (result === 'Rollback') {
        // Show progress
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Rolling back...',
          cancellable: false
        }, async (progress) => {
          progress.report({ increment: 0, message: 'Creating backup...' });
          
          // Notify callbacks
          this.rollbackCallbacks.forEach(callback => {
            try {
              callback(messageId);
            } catch (error) {
              console.error('Error in rollback callback:', error);
            }
          });

          progress.report({ increment: 50, message: 'Restoring files...' });
          
          // Perform rollback
          const rollbackResult = await this.rollbackManager.rollbackToMessage(messageId);
          
          progress.report({ increment: 100, message: 'Complete' });

          if (rollbackResult.success) {
            vscode.window.showInformationMessage(
              `Rollback successful! ${rollbackResult.modifiedFiles.length} files restored.`
            );
          } else {
            vscode.window.showErrorMessage(`Rollback failed: ${rollbackResult.error}`);
          }
        });
      }

    } catch (error) {
      console.error(`Failed to handle rollback request for ${messageId}:`, error);
      vscode.window.showErrorMessage('Failed to perform rollback');
    }
  }

  private async showRollbackOptions(): Promise<void> {
    try {
      const backups = await this.rollbackManager.listBackups();
      
      if (backups.length === 0) {
        vscode.window.showInformationMessage('No backups available');
        return;
      }

      const items = backups.map(backup => ({
        label: backup.description || `Backup ${backup.id}`,
        description: new Date(backup.timestamp).toLocaleString(),
        backupId: backup.id
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a backup to restore'
      });

      if (selected) {
        const result = await vscode.window.showWarningMessage(
          'Are you sure you want to restore this backup? This will overwrite your current workspace.',
          { modal: true },
          'Restore'
        );

        if (result === 'Restore') {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Restoring backup...',
            cancellable: false
          }, async () => {
            await this.rollbackManager.restoreBackup(selected.backupId);
            vscode.window.showInformationMessage('Backup restored successfully');
          });
        }
      }

    } catch (error) {
      console.error('Failed to show rollback options:', error);
      vscode.window.showErrorMessage('Failed to show rollback options');
    }
  }

  private getMessageDetailsHtml(message: any): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Message Details</title>
        <style>
          body { font-family: var(--vscode-font-family); padding: 20px; }
          .message-header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; margin-bottom: 20px; }
          .message-content { white-space: pre-wrap; margin-bottom: 20px; }
          .code-changes { margin-top: 20px; }
          .code-change { margin-bottom: 10px; padding: 10px; background: var(--vscode-editor-background); border-radius: 4px; }
          .rollback-button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
          .rollback-button:hover { background: var(--vscode-button-hoverBackground); }
        </style>
      </head>
      <body>
        <div class="message-header">
          <h2>${message.sender === 'user' ? '👤 User' : '🤖 AI'}</h2>
          <p>Timestamp: ${new Date(message.timestamp).toLocaleString()}</p>
        </div>
        
        <div class="message-content">${message.content}</div>
        
        ${message.codeChanges.length > 0 ? `
          <div class="code-changes">
            <h3>Code Changes (${message.codeChanges.length})</h3>
            ${message.codeChanges.map((change: any) => `
              <div class="code-change">
                <strong>${change.changeType}</strong>: ${change.filePath}
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        <button class="rollback-button" onclick="rollback()">Rollback to this Message</button>
        
        <script>
          const vscode = acquireVsCodeApi();
          
          function rollback() {
            vscode.postMessage({ command: 'rollback' });
          }
        </script>
      </body>
      </html>
    `;
  }
}