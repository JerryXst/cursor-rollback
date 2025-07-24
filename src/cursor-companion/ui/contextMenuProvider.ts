/**
 * Context menu provider for conversation and message actions
 * Handles right-click context menus, action buttons, and confirmation dialogs
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Conversation, Message } from '../models';
import { IDataStorage, IRollbackManager } from '../services/interfaces';

/**
 * Context menu action types
 */
export type ContextMenuAction = 
  | 'rollback'
  | 'delete'
  | 'archive'
  | 'export'
  | 'duplicate'
  | 'copyContent'
  | 'showDetails'
  | 'addTag'
  | 'removeTag'
  | 'markAsRead'
  | 'markAsUnread';

/**
 * Context menu item configuration
 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  tooltip?: string;
  enabled: boolean;
  visible: boolean;
  action: ContextMenuAction;
  shortcut?: string;
  group?: string;
}

/**
 * Action button configuration
 */
export interface ActionButton {
  id: string;
  label: string;
  icon: string;
  tooltip: string;
  command: string;
  when?: string;
  group?: string;
  priority?: number;
}

/**
 * Confirmation dialog options
 */
export interface ConfirmationOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  showProgress?: boolean;
}

/**
 * Provides context menu and action button functionality
 */
export class ContextMenuProvider {
  private readonly actionCallbacks = new Map<ContextMenuAction, Array<(item: any) => Promise<void>>>();

  constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage,
    private rollbackManager: IRollbackManager
  ) {
    this.registerContextMenuCommands();
  }

  /**
   * Get context menu items for a conversation
   */
  getConversationContextMenu(conversation: Conversation): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    // Show details
    items.push({
      id: 'showDetails',
      label: 'Show Details',
      icon: 'info',
      tooltip: 'Show conversation details',
      enabled: true,
      visible: true,
      action: 'showDetails',
      group: 'navigation'
    });

    // Export conversation
    items.push({
      id: 'export',
      label: 'Export Conversation',
      icon: 'export',
      tooltip: 'Export conversation to file',
      enabled: true,
      visible: true,
      action: 'export',
      shortcut: 'Ctrl+E',
      group: 'file'
    });

    // Duplicate conversation
    items.push({
      id: 'duplicate',
      label: 'Duplicate Conversation',
      icon: 'copy',
      tooltip: 'Create a copy of this conversation',
      enabled: true,
      visible: true,
      action: 'duplicate',
      group: 'edit'
    });

    // Add separator
    items.push({
      id: 'separator1',
      label: '',
      enabled: false,
      visible: true,
      action: 'showDetails',
      group: 'separator'
    });

    // Archive/Unarchive
    if (conversation.status === 'archived') {
      items.push({
        id: 'unarchive',
        label: 'Unarchive',
        icon: 'archive',
        tooltip: 'Move conversation back to active',
        enabled: true,
        visible: true,
        action: 'archive',
        group: 'status'
      });
    } else {
      items.push({
        id: 'archive',
        label: 'Archive',
        icon: 'archive',
        tooltip: 'Archive this conversation',
        enabled: true,
        visible: true,
        action: 'archive',
        group: 'status'
      });
    }

    // Add tag
    items.push({
      id: 'addTag',
      label: 'Add Tag',
      icon: 'tag',
      tooltip: 'Add a tag to this conversation',
      enabled: true,
      visible: true,
      action: 'addTag',
      group: 'tags'
    });

    // Remove tag (only if conversation has tags)
    if (conversation.metadata?.tags && conversation.metadata.tags.length > 0) {
      items.push({
        id: 'removeTag',
        label: 'Remove Tag',
        icon: 'tag',
        tooltip: 'Remove a tag from this conversation',
        enabled: true,
        visible: true,
        action: 'removeTag',
        group: 'tags'
      });
    }

    // Add separator
    items.push({
      id: 'separator2',
      label: '',
      enabled: false,
      visible: true,
      action: 'showDetails',
      group: 'separator'
    });

    // Delete conversation
    items.push({
      id: 'delete',
      label: 'Delete Conversation',
      icon: 'trash',
      tooltip: 'Permanently delete this conversation',
      enabled: true,
      visible: true,
      action: 'delete',
      shortcut: 'Delete',
      group: 'danger'
    });

    return items;
  }

  /**
   * Get context menu items for a message
   */
  getMessageContextMenu(message: Message, conversation: Conversation): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    // Show details
    items.push({
      id: 'showDetails',
      label: 'Show Message Details',
      icon: 'info',
      tooltip: 'Show detailed message information',
      enabled: true,
      visible: true,
      action: 'showDetails',
      group: 'navigation'
    });

    // Copy content
    items.push({
      id: 'copyContent',
      label: 'Copy Content',
      icon: 'copy',
      tooltip: 'Copy message content to clipboard',
      enabled: true,
      visible: true,
      action: 'copyContent',
      shortcut: 'Ctrl+C',
      group: 'edit'
    });

    // Add separator
    items.push({
      id: 'separator1',
      label: '',
      enabled: false,
      visible: true,
      action: 'showDetails',
      group: 'separator'
    });

    // Rollback to message (only if message has snapshots or code changes)
    const canRollback = (message.snapshot && message.snapshot.length > 0) || 
                       (message.codeChanges && message.codeChanges.length > 0);
    
    if (canRollback) {
      items.push({
        id: 'rollback',
        label: 'Rollback to Here',
        icon: 'history',
        tooltip: 'Rollback code and conversation to this point',
        enabled: true,
        visible: true,
        action: 'rollback',
        shortcut: 'Ctrl+R',
        group: 'rollback'
      });

      // Add separator
      items.push({
        id: 'separator2',
        label: '',
        enabled: false,
        visible: true,
        action: 'showDetails',
        group: 'separator'
      });
    }

    // Export message
    items.push({
      id: 'export',
      label: 'Export Message',
      icon: 'export',
      tooltip: 'Export message to file',
      enabled: true,
      visible: true,
      action: 'export',
      group: 'file'
    });

    return items;
  }

  /**
   * Get action buttons for the conversation tree view
   */
  getTreeViewActionButtons(): ActionButton[] {
    return [
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        tooltip: 'Refresh conversation list',
        command: 'cursorCompanion.refreshConversations',
        group: 'navigation',
        priority: 1
      },
      {
        id: 'search',
        label: 'Search',
        icon: 'search',
        tooltip: 'Search conversations and messages',
        command: 'cursorCompanion.quickSearch',
        group: 'navigation',
        priority: 2
      },
      {
        id: 'filter',
        label: 'Filter',
        icon: 'filter',
        tooltip: 'Filter conversations',
        command: 'cursorCompanion.advancedSearch',
        group: 'navigation',
        priority: 3
      },
      {
        id: 'clearFilters',
        label: 'Clear Filters',
        icon: 'clear-all',
        tooltip: 'Clear all filters',
        command: 'cursorCompanion.clearSearch',
        when: 'cursorCompanion.hasActiveFilters',
        group: 'navigation',
        priority: 4
      },
      {
        id: 'exportResults',
        label: 'Export Results',
        icon: 'export',
        tooltip: 'Export search results',
        command: 'cursorCompanion.exportSearchResults',
        when: 'cursorCompanion.hasSearchResults',
        group: 'file',
        priority: 5
      },
      {
        id: 'showStats',
        label: 'Statistics',
        icon: 'graph',
        tooltip: 'Show conversation statistics',
        command: 'cursorCompanion.showStats',
        group: 'info',
        priority: 6
      }
    ];
  }

  /**
   * Execute a context menu action
   */
  async executeAction(action: ContextMenuAction, item: Conversation | Message, context?: any): Promise<void> {
    try {
      switch (action) {
        case 'rollback':
          await this.handleRollbackAction(item as Message);
          break;
        case 'delete':
          await this.handleDeleteAction(item, context);
          break;
        case 'archive':
          await this.handleArchiveAction(item as Conversation);
          break;
        case 'export':
          await this.handleExportAction(item, context);
          break;
        case 'duplicate':
          await this.handleDuplicateAction(item as Conversation);
          break;
        case 'copyContent':
          await this.handleCopyContentAction(item as Message);
          break;
        case 'showDetails':
          await this.handleShowDetailsAction(item, context);
          break;
        case 'addTag':
          await this.handleAddTagAction(item as Conversation);
          break;
        case 'removeTag':
          await this.handleRemoveTagAction(item as Conversation);
          break;
        default:
          vscode.window.showWarningMessage(`Action '${action}' is not implemented yet`);
      }
    } catch (error) {
      console.error(`Failed to execute action '${action}':`, error);
      vscode.window.showErrorMessage(`Failed to execute action: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Show confirmation dialog
   */
  async showConfirmationDialog(options: ConfirmationOptions): Promise<boolean> {
    const confirmLabel = options.confirmLabel || 'Confirm';
    const cancelLabel = options.cancelLabel || 'Cancel';

    const result = await vscode.window.showWarningMessage(
      options.message,
      {
        modal: true,
        detail: options.detail
      },
      confirmLabel,
      cancelLabel
    );

    return result === confirmLabel;
  }

  /**
   * Show progress dialog
   */
  async showProgressDialog<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
  ): Promise<T> {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false
    }, task);
  }

  /**
   * Register callback for action
   */
  onAction(action: ContextMenuAction, callback: (item: any) => Promise<void>): void {
    if (!this.actionCallbacks.has(action)) {
      this.actionCallbacks.set(action, []);
    }
    this.actionCallbacks.get(action)!.push(callback);
  }

  // Private methods

  /**
   * Register context menu commands
   */
  private registerContextMenuCommands(): void {
    // Register generic context menu command
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.contextMenuAction', async (action: ContextMenuAction, item: any, context?: any) => {
        await this.executeAction(action, item, context);
      })
    );

    // Register specific action commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.rollbackToMessage', async (messageId: string) => {
        // Find message by ID
        const targetMessage = await this.dataStorage.getMessage(messageId);
        
        if (targetMessage) {
          await this.handleRollbackAction(targetMessage);
        }
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.deleteConversation', async (conversationId: string) => {
        const conversation = await this.dataStorage.getConversation(conversationId);
        if (conversation) {
          await this.handleDeleteAction(conversation);
        }
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.archiveConversation', async (conversationId: string) => {
        const conversation = await this.dataStorage.getConversation(conversationId);
        if (conversation) {
          await this.handleArchiveAction(conversation);
        }
      })
    );
  }

  /**
   * Handle rollback action
   */
  private async handleRollbackAction(message: Message): Promise<void> {
    const confirmed = await this.showConfirmationDialog({
      title: 'Confirm Rollback',
      message: 'Are you sure you want to rollback to this message?',
      detail: 'This will restore your code and conversation context to the state at this point. A backup will be created before the rollback.',
      confirmLabel: 'Rollback',
      isDestructive: true
    });

    if (!confirmed) {
      return;
    }

    await this.showProgressDialog('Rolling back...', async (progress) => {
      progress.report({ increment: 0, message: 'Creating backup...' });
      
      const result = await this.rollbackManager.rollbackToMessage(message.id);
      
      progress.report({ increment: 50, message: 'Restoring files...' });
      
      if (result.success) {
        progress.report({ increment: 100, message: 'Complete' });
        vscode.window.showInformationMessage(
          `Rollback successful! ${result.modifiedFiles.length} files restored.`
        );
      } else {
        throw new Error(result.error || 'Rollback failed');
      }
    });

    // Notify callbacks
    const callbacks = this.actionCallbacks.get('rollback') || [];
    for (const callback of callbacks) {
      try {
        await callback(message);
      } catch (error) {
        console.error('Error in rollback callback:', error);
      }
    }
  }

  /**
   * Handle delete action
   */
  private async handleDeleteAction(item: Conversation | Message, context?: any): Promise<void> {
    const isConversation = 'messages' in item;
    const itemType = isConversation ? 'conversation' : 'message';
    const itemName = isConversation ? (item as Conversation).title : `message from ${new Date((item as Message).timestamp).toLocaleString()}`;

    const confirmed = await this.showConfirmationDialog({
      title: `Delete ${itemType}`,
      message: `Are you sure you want to delete this ${itemType}?`,
      detail: `"${itemName}" will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete',
      isDestructive: true
    });

    if (!confirmed) {
      return;
    }

    await this.showProgressDialog(`Deleting ${itemType}...`, async (progress) => {
      progress.report({ increment: 0, message: `Deleting ${itemType}...` });
      
      if (isConversation) {
        await this.dataStorage.deleteConversation(item.id);
      } else {
        // For messages, delete the message file directly
        // Note: This is a simplified implementation - in a full system you might want
        // to also update the conversation's message list
        const messageFilePath = path.join(this.context.globalStorageUri.fsPath, 'cursor-companion', 'messages', `${item.id}.json`);
        await vscode.workspace.fs.delete(vscode.Uri.file(messageFilePath));
      }
      
      progress.report({ increment: 100, message: 'Complete' });
    });

    vscode.window.showInformationMessage(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} deleted successfully`);

    // Notify callbacks
    const callbacks = this.actionCallbacks.get('delete') || [];
    for (const callback of callbacks) {
      try {
        await callback(item);
      } catch (error) {
        console.error('Error in delete callback:', error);
      }
    }
  }

  /**
   * Handle archive action
   */
  private async handleArchiveAction(conversation: Conversation): Promise<void> {
    const isArchived = conversation.status === 'archived';
    const action = isArchived ? 'unarchive' : 'archive';
    const actionLabel = isArchived ? 'Unarchive' : 'Archive';

    const confirmed = await this.showConfirmationDialog({
      title: `${actionLabel} Conversation`,
      message: `Are you sure you want to ${action} this conversation?`,
      detail: `"${conversation.title}" will be ${isArchived ? 'moved back to active conversations' : 'archived'}.`,
      confirmLabel: actionLabel
    });

    if (!confirmed) {
      return;
    }

    await this.showProgressDialog(`${actionLabel}ing conversation...`, async (progress) => {
      progress.report({ increment: 0, message: `${actionLabel}ing...` });
      
      if (isArchived) {
        // Unarchive - set status to active
        conversation.status = 'active';
        await this.dataStorage.saveConversation(conversation);
      } else {
        // Archive
        await this.dataStorage.archiveConversation(conversation.id);
      }
      
      progress.report({ increment: 100, message: 'Complete' });
    });

    vscode.window.showInformationMessage(`Conversation ${action}d successfully`);

    // Notify callbacks
    const callbacks = this.actionCallbacks.get('archive') || [];
    for (const callback of callbacks) {
      try {
        await callback(conversation);
      } catch (error) {
        console.error('Error in archive callback:', error);
      }
    }
  }

  /**
   * Handle export action
   */
  private async handleExportAction(item: Conversation | Message, context?: any): Promise<void> {
    const isConversation = 'messages' in item;
    const itemType = isConversation ? 'conversation' : 'message';

    try {
      let content: string;
      let defaultFilename: string;

      if (isConversation) {
        const conversation = item as Conversation;
        const messages = await this.dataStorage.getMessages(conversation.id);
        content = this.formatConversationForExport(conversation, messages);
        defaultFilename = `${conversation.title.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
      } else {
        const message = item as Message;
        content = this.formatMessageForExport(message);
        defaultFilename = `message_${message.id}.md`;
      }

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultFilename),
        filters: {
          'Markdown': ['md'],
          'Text': ['txt'],
          'All Files': ['*']
        }
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} exported to ${uri.fsPath}`);
      }
    } catch (error) {
      throw new Error(`Failed to export ${itemType}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Notify callbacks
    const callbacks = this.actionCallbacks.get('export') || [];
    for (const callback of callbacks) {
      try {
        await callback(item);
      } catch (error) {
        console.error('Error in export callback:', error);
      }
    }
  }

  /**
   * Handle duplicate action
   */
  private async handleDuplicateAction(conversation: Conversation): Promise<void> {
    const newTitle = await vscode.window.showInputBox({
      prompt: 'Enter title for the duplicated conversation',
      value: `${conversation.title} (Copy)`,
      validateInput: (value) => {
        if (!value || value.trim() === '') {
          return 'Title cannot be empty';
        }
        return undefined;
      }
    });

    if (!newTitle) {
      return;
    }

    await this.showProgressDialog('Duplicating conversation...', async (progress) => {
      progress.report({ increment: 0, message: 'Creating duplicate...' });
      
      // Create a new conversation with the same content
      const duplicatedConversation: Conversation = {
        ...conversation,
        id: `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: newTitle.trim(),
        timestamp: Date.now(),
        status: 'active'
      };

      await this.dataStorage.saveConversation(duplicatedConversation);
      
      progress.report({ increment: 50, message: 'Copying messages...' });
      
      // Copy messages if any
      if (conversation.messages && conversation.messages.length > 0) {
        const originalMessages = await this.dataStorage.getMessages(conversation.id);
        
        for (const originalMessage of originalMessages) {
          const duplicatedMessage: Message = {
            ...originalMessage,
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            conversationId: duplicatedConversation.id
          };
          
          // Save duplicated message
          await this.dataStorage.saveMessage(duplicatedMessage);
        }
      }
      
      progress.report({ increment: 100, message: 'Complete' });
    });

    vscode.window.showInformationMessage(`Conversation duplicated as "${newTitle}"`);

    // Notify callbacks
    const callbacks = this.actionCallbacks.get('duplicate') || [];
    for (const callback of callbacks) {
      try {
        await callback(conversation);
      } catch (error) {
        console.error('Error in duplicate callback:', error);
      }
    }
  }

  /**
   * Handle copy content action
   */
  private async handleCopyContentAction(message: Message): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(message.content);
      vscode.window.showInformationMessage('Message content copied to clipboard');
    } catch (error) {
      throw new Error(`Failed to copy content: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Notify callbacks
    const callbacks = this.actionCallbacks.get('copyContent') || [];
    for (const callback of callbacks) {
      try {
        await callback(message);
      } catch (error) {
        console.error('Error in copy content callback:', error);
      }
    }
  }

  /**
   * Handle show details action
   */
  private async handleShowDetailsAction(item: Conversation | Message, context?: any): Promise<void> {
    const isConversation = 'messages' in item;

    if (isConversation) {
      // Show conversation details
      vscode.commands.executeCommand('cursorCompanion.selectConversation', item.id);
    } else {
      // Show message details
      vscode.commands.executeCommand('cursorCompanion.showMessageDetails', item.id);
    }

    // Notify callbacks
    const callbacks = this.actionCallbacks.get('showDetails') || [];
    for (const callback of callbacks) {
      try {
        await callback(item);
      } catch (error) {
        console.error('Error in show details callback:', error);
      }
    }
  }

  /**
   * Handle add tag action
   */
  private async handleAddTagAction(conversation: Conversation): Promise<void> {
    const tag = await vscode.window.showInputBox({
      prompt: 'Enter tag name',
      placeHolder: 'e.g., javascript, bug-fix, feature',
      validateInput: (value) => {
        if (!value || value.trim() === '') {
          return 'Tag name cannot be empty';
        }
        if (value.includes(' ')) {
          return 'Tag name cannot contain spaces';
        }
        return undefined;
      }
    });

    if (!tag) {
      return;
    }

    const trimmedTag = tag.trim().toLowerCase();

    // Initialize metadata if not present
    if (!conversation.metadata) {
      conversation.metadata = {
        messageCount: conversation.messages?.length || 0,
        lastActivity: conversation.timestamp,
        tags: []
      };
    }

    // Initialize tags array if not present
    if (!conversation.metadata.tags) {
      conversation.metadata.tags = [];
    }

    // Check if tag already exists
    if (conversation.metadata.tags.includes(trimmedTag)) {
      vscode.window.showWarningMessage(`Tag "${trimmedTag}" already exists on this conversation`);
      return;
    }

    // Add the tag
    conversation.metadata.tags.push(trimmedTag);

    // Save the conversation
    await this.dataStorage.saveConversation(conversation);

    vscode.window.showInformationMessage(`Tag "${trimmedTag}" added to conversation`);

    // Notify callbacks
    const callbacks = this.actionCallbacks.get('addTag') || [];
    for (const callback of callbacks) {
      try {
        await callback(conversation);
      } catch (error) {
        console.error('Error in add tag callback:', error);
      }
    }
  }

  /**
   * Handle remove tag action
   */
  private async handleRemoveTagAction(conversation: Conversation): Promise<void> {
    const tags = conversation.metadata?.tags || [];

    if (tags.length === 0) {
      vscode.window.showInformationMessage('No tags to remove');
      return;
    }

    const tagItems = tags.map(tag => ({
      label: tag,
      picked: false
    }));

    const selectedTags = await vscode.window.showQuickPick(tagItems, {
      placeHolder: 'Select tags to remove',
      canPickMany: true
    });

    if (!selectedTags || selectedTags.length === 0) {
      return;
    }

    const tagsToRemove = selectedTags.map(item => item.label);

    // Remove the selected tags
    if (conversation.metadata && conversation.metadata.tags) {
      conversation.metadata.tags = conversation.metadata.tags.filter(tag => !tagsToRemove.includes(tag));
    }

    // Save the conversation
    await this.dataStorage.saveConversation(conversation);

    vscode.window.showInformationMessage(`Removed ${tagsToRemove.length} tag(s) from conversation`);

    // Notify callbacks
    const callbacks = this.actionCallbacks.get('removeTag') || [];
    for (const callback of callbacks) {
      try {
        await callback(conversation);
      } catch (error) {
        console.error('Error in remove tag callback:', error);
      }
    }
  }

  /**
   * Format conversation for export
   */
  private formatConversationForExport(conversation: Conversation, messages: Message[]): string {
    const lines: string[] = [];
    
    lines.push(`# ${conversation.title}`);
    lines.push(`**Created:** ${new Date(conversation.timestamp).toLocaleString()}`);
    lines.push(`**Status:** ${conversation.status || 'active'}`);
    lines.push(`**Messages:** ${messages.length}`);
    
    if (conversation.metadata?.tags && conversation.metadata.tags.length > 0) {
      lines.push(`**Tags:** ${conversation.metadata.tags.join(', ')}`);
    }
    
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const message of messages) {
      lines.push(`## ${message.sender === 'user' ? 'You' : 'Cursor AI'} - ${new Date(message.timestamp).toLocaleString()}`);
      lines.push('');
      lines.push(message.content);
      
      if (message.codeChanges && message.codeChanges.length > 0) {
        lines.push('');
        lines.push('**Code Changes:**');
        for (const change of message.codeChanges) {
          lines.push(`- ${change.changeType}: ${change.filePath}`);
        }
      }
      
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format message for export
   */
  private formatMessageForExport(message: Message): string {
    const lines: string[] = [];
    
    lines.push(`# Message from ${message.sender === 'user' ? 'You' : 'Cursor AI'}`);
    lines.push(`**Time:** ${new Date(message.timestamp).toLocaleString()}`);
    lines.push(`**Message ID:** ${message.id}`);
    lines.push('');
    lines.push('## Content');
    lines.push('');
    lines.push(message.content);
    
    if (message.codeChanges && message.codeChanges.length > 0) {
      lines.push('');
      lines.push('## Code Changes');
      lines.push('');
      for (const change of message.codeChanges) {
        lines.push(`### ${change.changeType.toUpperCase()}: ${change.filePath}`);
        if (change.beforeContent) {
          lines.push('');
          lines.push('**Before:**');
          lines.push('```');
          lines.push(change.beforeContent);
          lines.push('```');
        }
        if (change.afterContent) {
          lines.push('');
          lines.push('**After:**');
          lines.push('```');
          lines.push(change.afterContent);
          lines.push('```');
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.actionCallbacks.clear();
  }
}