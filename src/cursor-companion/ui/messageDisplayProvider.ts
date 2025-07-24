/**
 * Message display provider for rendering conversation messages in the UI
 * Handles message formatting, content rendering, and user interactions
 */

import * as vscode from 'vscode';
import { Conversation, Message } from '../models';
import { IDataStorage } from '../services/interfaces';
import { ConversationExpandManager, FormattedMessage, MessageDisplayOptions } from './conversationExpandManager';

/**
 * Tree item representing a formatted message in the conversation tree
 */
export class FormattedMessageTreeItem extends vscode.TreeItem {
  constructor(
    public readonly message: FormattedMessage,
    public readonly conversationId: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(message.displayContent, collapsibleState);
    
    this.id = `message-${message.id}`;
    this.contextValue = 'message';
    this.tooltip = this.createTooltip();
    this.description = this.createDescription();
    this.iconPath = this.getMessageIcon();
    
    // Add rollback command if message can be rolled back
    if (message.canRollback) {
      this.contextValue += '-rollbackable';
    }
  }

  /**
   * Create tooltip text for the message
   */
  private createTooltip(): string {
    const parts: string[] = [];
    
    // Add sender info
    parts.push(`From: ${this.message.sender === 'user' ? 'You' : 'Cursor AI'}`);
    
    // Add timestamp
    if (this.message.timestamp) {
      parts.push(`Time: ${this.message.timestamp}`);
    }
    
    // Add code changes info
    if (this.message.hasCodeChanges && this.message.codeChangesSummary) {
      parts.push(`Changes: ${this.message.codeChangesSummary}`);
    }
    
    // Add rollback info
    if (this.message.canRollback) {
      parts.push('Right-click to rollback to this point');
    }
    
    return parts.join('\n');
  }

  /**
   * Create description text for the message
   */
  private createDescription(): string {
    const parts: string[] = [];
    
    // Add timestamp
    if (this.message.timestamp) {
      parts.push(this.message.timestamp);
    }
    
    // Add code changes summary
    if (this.message.hasCodeChanges && this.message.codeChangesSummary) {
      parts.push(this.message.codeChangesSummary);
    }
    
    return parts.join(' • ');
  }

  /**
   * Get appropriate icon for the message
   */
  private getMessageIcon(): vscode.ThemeIcon {
    if (this.message.sender === 'user') {
      return new vscode.ThemeIcon('person');
    } else {
      return new vscode.ThemeIcon('robot');
    }
  }
}

/**
 * Tree item representing code changes within a message
 */
export class CodeChangeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly codeChange: any,
    public readonly messageId: string
  ) {
    super(codeChange.filePath, vscode.TreeItemCollapsibleState.None);
    
    this.id = `codechange-${messageId}-${codeChange.filePath}`;
    this.contextValue = 'codechange';
    this.tooltip = this.createTooltip();
    this.description = this.createDescription();
    this.iconPath = this.getChangeIcon();
    
    // Add command to open file diff
    this.command = {
      command: 'cursorCompanion.showCodeChangeDiff',
      title: 'Show Diff',
      arguments: [this.codeChange, this.messageId]
    };
  }

  /**
   * Create tooltip for code change
   */
  private createTooltip(): string {
    const parts: string[] = [];
    
    parts.push(`File: ${this.codeChange.filePath}`);
    parts.push(`Change: ${this.codeChange.changeType}`);
    
    if (this.codeChange.lineNumbers) {
      parts.push(`Lines: ${this.codeChange.lineNumbers.start}-${this.codeChange.lineNumbers.end}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Create description for code change
   */
  private createDescription(): string {
    return this.codeChange.changeType;
  }

  /**
   * Get appropriate icon for the change type
   */
  private getChangeIcon(): vscode.ThemeIcon {
    switch (this.codeChange.changeType) {
      case 'create':
        return new vscode.ThemeIcon('add', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
      case 'modify':
        return new vscode.ThemeIcon('edit', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
      case 'delete':
        return new vscode.ThemeIcon('trash', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
      default:
        return new vscode.ThemeIcon('file');
    }
  }
}

/**
 * Provides message display functionality for the conversation tree view
 */
export class MessageDisplayProvider {
  private readonly displayOptions: MessageDisplayOptions = {
    showTimestamp: true,
    showSender: true,
    showCodeChanges: true,
    maxContentLength: 100
  };

  constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage,
    private expandManager: ConversationExpandManager
  ) {}

  /**
   * Create tree items for messages in a conversation
   */
  async createMessageTreeItems(conversation: Conversation): Promise<vscode.TreeItem[]> {
    try {
      // Get messages for the conversation
      const messages = await this.dataStorage.getMessages(conversation.id);
      
      // Format messages for display
      const formattedMessages = await this.expandManager.formatMessagesForDisplay(
        conversation.id,
        messages,
        this.displayOptions
      );
      
      const treeItems: vscode.TreeItem[] = [];
      
      for (const formattedMessage of formattedMessages) {
        // Determine collapsible state
        const hasCodeChanges = formattedMessage.hasCodeChanges;
        const isExpanded = formattedMessage.isExpanded;
        
        let collapsibleState = vscode.TreeItemCollapsibleState.None;
        if (hasCodeChanges) {
          collapsibleState = isExpanded 
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        }
        
        // Create message tree item
        const messageItem = new FormattedMessageTreeItem(
          formattedMessage,
          conversation.id,
          collapsibleState,
          {
            command: 'cursorCompanion.toggleMessageExpansion',
            title: 'Toggle Message',
            arguments: [conversation.id, formattedMessage.id]
          }
        );
        
        treeItems.push(messageItem);
        
        // Add code change items if message is expanded
        if (hasCodeChanges && isExpanded) {
          const originalMessage = messages.find(m => m.id === formattedMessage.id);
          if (originalMessage && originalMessage.codeChanges) {
            for (const codeChange of originalMessage.codeChanges) {
              const codeChangeItem = new CodeChangeTreeItem(codeChange, formattedMessage.id);
              treeItems.push(codeChangeItem);
            }
          }
        }
      }
      
      return treeItems;
    } catch (error) {
      console.error(`Error creating message tree items for conversation ${conversation.id}:`, error);
      return [];
    }
  }

  /**
   * Update display options
   */
  updateDisplayOptions(options: Partial<MessageDisplayOptions>): void {
    Object.assign(this.displayOptions, options);
  }

  /**
   * Get current display options
   */
  getDisplayOptions(): MessageDisplayOptions {
    return { ...this.displayOptions };
  }

  /**
   * Format message content for search highlighting
   */
  async formatMessageWithSearchHighlight(
    conversationId: string,
    message: Message,
    searchTerms: string[]
  ): Promise<FormattedMessage> {
    const options: MessageDisplayOptions = {
      ...this.displayOptions,
      highlightSearchTerms: searchTerms
    };
    
    const isExpanded = this.expandManager.isMessageExpanded(conversationId, message.id);
    return await this.expandManager['formatSingleMessage'](message, options, isExpanded);
  }

  /**
   * Create a summary tree item for a conversation
   */
  createConversationSummaryItem(conversation: Conversation, messageCount: number): vscode.TreeItem {
    const summaryItem = new vscode.TreeItem(
      `${messageCount} messages`,
      vscode.TreeItemCollapsibleState.None
    );
    
    summaryItem.id = `summary-${conversation.id}`;
    summaryItem.contextValue = 'conversationSummary';
    summaryItem.iconPath = new vscode.ThemeIcon('info');
    summaryItem.description = `Last updated: ${new Date(conversation.timestamp).toLocaleString()}`;
    
    return summaryItem;
  }

  /**
   * Create an empty state tree item
   */
  createEmptyStateItem(message: string): vscode.TreeItem {
    const emptyItem = new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None);
    emptyItem.contextValue = 'emptyState';
    emptyItem.iconPath = new vscode.ThemeIcon('info');
    return emptyItem;
  }

  /**
   * Create a loading state tree item
   */
  createLoadingStateItem(): vscode.TreeItem {
    const loadingItem = new vscode.TreeItem('Loading messages...', vscode.TreeItemCollapsibleState.None);
    loadingItem.contextValue = 'loadingState';
    loadingItem.iconPath = new vscode.ThemeIcon('loading~spin');
    return loadingItem;
  }

  /**
   * Create an error state tree item
   */
  createErrorStateItem(error: string): vscode.TreeItem {
    const errorItem = new vscode.TreeItem(`Error: ${error}`, vscode.TreeItemCollapsibleState.None);
    errorItem.contextValue = 'errorState';
    errorItem.iconPath = new vscode.ThemeIcon('error');
    errorItem.tooltip = 'Click to retry loading messages';
    errorItem.command = {
      command: 'cursorCompanion.refreshConversationList',
      title: 'Retry'
    };
    return errorItem;
  }

  /**
   * Get message statistics for a conversation
   */
  async getMessageStatistics(conversationId: string): Promise<{
    totalMessages: number;
    userMessages: number;
    aiMessages: number;
    messagesWithCodeChanges: number;
  }> {
    try {
      const messages = await this.dataStorage.getMessages(conversationId);
      
      const stats = {
        totalMessages: messages.length,
        userMessages: 0,
        aiMessages: 0,
        messagesWithCodeChanges: 0
      };
      
      for (const message of messages) {
        if (message.sender === 'user') {
          stats.userMessages++;
        } else {
          stats.aiMessages++;
        }
        
        if (message.codeChanges && message.codeChanges.length > 0) {
          stats.messagesWithCodeChanges++;
        }
      }
      
      return stats;
    } catch (error) {
      console.error(`Error getting message statistics for conversation ${conversationId}:`, error);
      return {
        totalMessages: 0,
        userMessages: 0,
        aiMessages: 0,
        messagesWithCodeChanges: 0
      };
    }
  }

  /**
   * Search for messages containing specific terms
   */
  async searchMessages(
    conversationId: string,
    searchTerms: string[]
  ): Promise<FormattedMessage[]> {
    try {
      const messages = await this.dataStorage.getMessages(conversationId);
      const matchingMessages: Message[] = [];
      
      // Filter messages that contain any of the search terms
      for (const message of messages) {
        const content = message.content.toLowerCase();
        const hasMatch = searchTerms.some(term => 
          content.includes(term.toLowerCase())
        );
        
        if (hasMatch) {
          matchingMessages.push(message);
        }
      }
      
      // Format matching messages with search highlighting
      const formattedMessages: FormattedMessage[] = [];
      for (const message of matchingMessages) {
        const formatted = await this.formatMessageWithSearchHighlight(
          conversationId,
          message,
          searchTerms
        );
        formattedMessages.push(formatted);
      }
      
      return formattedMessages;
    } catch (error) {
      console.error(`Error searching messages in conversation ${conversationId}:`, error);
      return [];
    }
  }

  /**
   * Export conversation messages to a readable format
   */
  async exportConversationMessages(conversationId: string): Promise<string> {
    try {
      const messages = await this.dataStorage.getMessages(conversationId);
      const conversation = await this.dataStorage.getConversation(conversationId);
      
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      
      const lines: string[] = [];
      lines.push(`# ${conversation.title}`);
      lines.push(`Generated: ${new Date().toLocaleString()}`);
      lines.push(`Total Messages: ${messages.length}`);
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
    } catch (error) {
      console.error(`Error exporting conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    // Clean up any resources if needed
  }
}