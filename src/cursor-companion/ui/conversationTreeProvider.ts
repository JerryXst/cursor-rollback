import * as vscode from 'vscode';
import { Conversation, Message } from '../models';
import { IDataStorage } from '../services/interfaces';

/**
 * Tree item for conversations in the UI
 */
export class ConversationTreeItem extends vscode.TreeItem {
  constructor(
    public readonly conversation: Conversation,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(conversation.title, collapsibleState);
    
    this.tooltip = `${conversation.title} - ${new Date(conversation.timestamp).toLocaleString()}`;
    this.description = `${conversation.messages.length} messages`;
    this.contextValue = 'conversation';
    
    // Set icon based on status
    this.iconPath = new vscode.ThemeIcon(
      conversation.status === 'archived' ? 'archive' : 'comment-discussion'
    );
  }
}

/**
 * Tree item for messages in the UI
 */
export class MessageTreeItem extends vscode.TreeItem {
  constructor(
    public readonly message: Message,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(
      `${message.sender === 'user' ? '👤' : '🤖'} ${message.content.substring(0, 50)}...`,
      collapsibleState
    );
    
    this.tooltip = `${message.sender} - ${new Date(message.timestamp).toLocaleString()}\n\n${message.content}`;
    this.description = new Date(message.timestamp).toLocaleTimeString();
    this.contextValue = 'message';
    
    // Set icon based on sender
    this.iconPath = new vscode.ThemeIcon(
      message.sender === 'user' ? 'person' : 'robot'
    );
    
    // Add command for rollback
    this.command = {
      command: 'cursorCompanion.showMessageDetails',
      title: 'Show Message Details',
      arguments: [message.id]
    };
  }
}

/**
 * Tree data provider for conversations
 */
export class ConversationTreeProvider implements vscode.TreeDataProvider<ConversationTreeItem | MessageTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ConversationTreeItem | MessageTreeItem | undefined | null | void> = new vscode.EventEmitter<ConversationTreeItem | MessageTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ConversationTreeItem | MessageTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private conversations: Conversation[] = [];
  private expandedConversations = new Set<string>();

  constructor(private dataStorage: IDataStorage) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async loadConversations(): Promise<void> {
    try {
      this.conversations = await this.dataStorage.getConversations();
      this.refresh();
    } catch (error) {
      console.error('Failed to load conversations:', error);
      vscode.window.showErrorMessage('Failed to load conversations');
    }
  }

  getTreeItem(element: ConversationTreeItem | MessageTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ConversationTreeItem | MessageTreeItem): Promise<(ConversationTreeItem | MessageTreeItem)[]> {
    if (!element) {
      // Return root level conversations
      return this.conversations.map(conversation => 
        new ConversationTreeItem(
          conversation,
          this.expandedConversations.has(conversation.id) 
            ? vscode.TreeItemCollapsibleState.Expanded 
            : vscode.TreeItemCollapsibleState.Collapsed
        )
      );
    }

    if (element instanceof ConversationTreeItem) {
      // Return messages for this conversation
      try {
        const messages = await this.dataStorage.getMessages(element.conversation.id);
        return messages.map(message => new MessageTreeItem(message));
      } catch (error) {
        console.error(`Failed to load messages for conversation ${element.conversation.id}:`, error);
        return [];
      }
    }

    // Messages don't have children
    return [];
  }

  async expandConversation(conversationId: string): Promise<void> {
    this.expandedConversations.add(conversationId);
    this.refresh();
  }

  async collapseConversation(conversationId: string): Promise<void> {
    this.expandedConversations.delete(conversationId);
    this.refresh();
  }

  async filterConversations(query: string): Promise<void> {
    try {
      if (!query.trim()) {
        // No filter, load all conversations
        this.conversations = await this.dataStorage.getConversations();
      } else {
        // Filter conversations by search query
        this.conversations = await this.dataStorage.getConversations({
          searchQuery: query
        });
      }
      this.refresh();
    } catch (error) {
      console.error('Failed to filter conversations:', error);
      vscode.window.showErrorMessage('Failed to filter conversations');
    }
  }

  async archiveConversation(conversationId: string): Promise<void> {
    try {
      await this.dataStorage.archiveConversation(conversationId);
      await this.loadConversations();
      vscode.window.showInformationMessage('Conversation archived');
    } catch (error) {
      console.error(`Failed to archive conversation ${conversationId}:`, error);
      vscode.window.showErrorMessage('Failed to archive conversation');
    }
  }

  async deleteConversation(conversationId: string): Promise<void> {
    try {
      const result = await vscode.window.showWarningMessage(
        'Are you sure you want to delete this conversation? This action cannot be undone.',
        { modal: true },
        'Delete'
      );

      if (result === 'Delete') {
        await this.dataStorage.deleteConversation(conversationId);
        await this.loadConversations();
        vscode.window.showInformationMessage('Conversation deleted');
      }
    } catch (error) {
      console.error(`Failed to delete conversation ${conversationId}:`, error);
      vscode.window.showErrorMessage('Failed to delete conversation');
    }
  }
}