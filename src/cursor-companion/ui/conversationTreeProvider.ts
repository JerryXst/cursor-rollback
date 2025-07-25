import * as vscode from 'vscode';
import { Conversation, Message, ConversationFilter } from '../models';
import { IDataStorage } from '../services/interfaces';
import { generateUUID } from '../utils/helpers';

/**
 * Tree item for conversations in the UI
 */
export class ConversationTreeItem extends vscode.TreeItem {
  constructor(
    public readonly conversation: Conversation,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(conversation.title, collapsibleState);
    
    this.tooltip = this.buildTooltip();
    this.description = this.buildDescription();
    this.contextValue = 'conversation';
    
    // Set icon based on status
    this.iconPath = new vscode.ThemeIcon(
      conversation.status === 'archived' ? 'archive' : 'comment-discussion'
    );

    // Add command for conversation selection
    this.command = {
      command: 'cursorCompanion.selectConversation',
      title: 'Select Conversation',
      arguments: [conversation.id]
    };
  }

  private buildTooltip(): string {
    const date = new Date(this.conversation.timestamp).toLocaleString();
    const messageCount = Array.isArray(this.conversation.messages) ? this.conversation.messages.length : 0;
    const status = this.conversation.status || 'active';
    
    let tooltip = `${this.conversation.title}\n`;
    tooltip += `Created: ${date}\n`;
    tooltip += `Messages: ${messageCount}\n`;
    tooltip += `Status: ${status}`;
    
    if (this.conversation.metadata?.tags && this.conversation.metadata.tags.length > 0) {
      tooltip += `\nTags: ${this.conversation.metadata.tags.join(', ')}`;
    }
    
    return tooltip;
  }

  private buildDescription(): string {
    const messageCount = Array.isArray(this.conversation.messages) ? this.conversation.messages.length : 0;
    const date = new Date(this.conversation.timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    let timeDesc = '';
    if (diffDays === 0) {
      timeDesc = 'Today';
    } else if (diffDays === 1) {
      timeDesc = 'Yesterday';
    } else if (diffDays < 7) {
      timeDesc = `${diffDays} days ago`;
    } else {
      timeDesc = date.toLocaleDateString();
    }
    
    return `${messageCount} messages • ${timeDesc}`;
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
    super('', collapsibleState);
    
    this.label = this.buildLabel();
    
    this.tooltip = this.buildTooltip();
    this.description = this.buildDescription();
    this.contextValue = 'message';
    
    // Set icon based on sender
    this.iconPath = new vscode.ThemeIcon(
      message.sender === 'user' ? 'person' : 'robot'
    );
    
    // Add command for message selection
    this.command = {
      command: 'cursorCompanion.selectMessage',
      title: 'Select Message',
      arguments: [message.id]
    };
  }

  private buildLabel(): string {
    const senderIcon = this.message.sender === 'user' ? '👤' : '🤖';
    const preview = this.message.content.length > 50 
      ? this.message.content.substring(0, 50) + '...'
      : this.message.content;
    
    // Replace newlines with spaces for single-line display
    const cleanPreview = preview.replace(/\n/g, ' ').trim();
    
    return `${senderIcon} ${cleanPreview}`;
  }

  private buildTooltip(): string {
    const date = new Date(this.message.timestamp).toLocaleString();
    const sender = this.message.sender === 'user' ? 'User' : 'AI Assistant';
    
    let tooltip = `${sender} - ${date}\n\n${this.message.content}`;
    
    // Add code changes info if present
    if (this.message.codeChanges && this.message.codeChanges.length > 0) {
      tooltip += `\n\nCode Changes: ${this.message.codeChanges.length} files`;
    }
    
    // Add snapshot info if present
    if (this.message.snapshot && this.message.snapshot.length > 0) {
      tooltip += `\n\nSnapshot: ${this.message.snapshot.length} files`;
    }
    
    return tooltip;
  }

  private buildDescription(): string {
    const time = new Date(this.message.timestamp).toLocaleTimeString();
    const extras = [];
    
    if (this.message.codeChanges && this.message.codeChanges.length > 0) {
      extras.push(`${this.message.codeChanges.length} changes`);
    }
    
    if (this.message.snapshot && this.message.snapshot.length > 0) {
      extras.push('snapshot');
    }
    
    return extras.length > 0 ? `${time} • ${extras.join(', ')}` : time;
  }
}

/**
 * Tree data provider for conversations with virtual scrolling and performance optimizations
 */
export class ConversationTreeProvider implements vscode.TreeDataProvider<ConversationTreeItem | MessageTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ConversationTreeItem | MessageTreeItem | undefined | null | void> = new vscode.EventEmitter<ConversationTreeItem | MessageTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ConversationTreeItem | MessageTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private conversations: Conversation[] = [];
  private expandedConversations = new Set<string>();
  private currentFilter: ConversationFilter | undefined;
  private isLoading = false;
  private loadingTimeout: NodeJS.Timeout | undefined;

  // Virtual scrolling properties
  private readonly pageSize = 50;
  private currentPage = 0;
  private totalConversations = 0;
  private hasMoreConversations = true;

  // Performance optimization properties
  private conversationCache = new Map<string, ConversationTreeItem>();
  private messageCache = new Map<string, MessageTreeItem[]>();
  private refreshDebounceTimer?: NodeJS.Timeout;
  private readonly refreshDebounceDelay = 100;

  // Lazy loading properties
  private loadingConversations = new Set<string>();
  private loadingMessages = new Set<string>();

  constructor(private dataStorage: IDataStorage) {
    // Auto-refresh every 30 seconds with debouncing
    setInterval(() => {
      if (!this.isLoading) {
        this.debouncedRefresh();
      }
    }, 30000);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Debounced refresh to prevent excessive UI updates
   */
  private debouncedRefresh(): void {
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }

    this.refreshDebounceTimer = setTimeout(() => {
      this.refresh();
    }, this.refreshDebounceDelay);
  }

  async loadConversations(showProgress = false, reset = false): Promise<void> {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;

    try {
      if (reset) {
        this.currentPage = 0;
        this.conversations = [];
        this.conversationCache.clear();
        this.messageCache.clear();
      }

      if (showProgress) {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Window,
          title: 'Loading conversations...',
          cancellable: false
        }, async () => {
          await this.loadConversationsPage();
        });
      } else {
        await this.loadConversationsPage();
      }
      
      this.debouncedRefresh();
    } catch (error) {
      console.error('Failed to load conversations:', error);
      vscode.window.showErrorMessage('Failed to load conversations');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Load a page of conversations with virtual scrolling
   */
  private async loadConversationsPage(): Promise<void> {
    // Check if we have a performance manager available for pagination
    const performanceManager = (this.dataStorage as any).performanceManager;
    
    if (performanceManager && typeof performanceManager.getConversationsPaginated === 'function') {
      // Use performance manager's pagination
      const result = await performanceManager.getConversationsPaginated(
        this.currentPage,
        this.pageSize,
        this.currentFilter
      );
      
      if (this.currentPage === 0) {
        this.conversations = result.items;
      } else {
        this.conversations.push(...result.items);
      }
      
      this.totalConversations = result.totalCount;
      this.hasMoreConversations = result.hasMore;
    } else {
      // Fallback to regular loading with manual pagination
      const allConversations = await this.dataStorage.getConversations(this.currentFilter);
      const startIndex = this.currentPage * this.pageSize;
      const endIndex = Math.min(startIndex + this.pageSize, allConversations.length);
      
      if (this.currentPage === 0) {
        this.conversations = allConversations.slice(startIndex, endIndex);
      } else {
        this.conversations.push(...allConversations.slice(startIndex, endIndex));
      }
      
      this.totalConversations = allConversations.length;
      this.hasMoreConversations = endIndex < allConversations.length;
    }
  }

  /**
   * Load more conversations for virtual scrolling
   */
  async loadMoreConversations(): Promise<void> {
    if (!this.hasMoreConversations || this.isLoading) {
      return;
    }

    this.currentPage++;
    await this.loadConversations(false, false);
  }

  async forceRefresh(): Promise<void> {
    await this.loadConversations(true);
  }

  getTreeItem(element: ConversationTreeItem | MessageTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ConversationTreeItem | MessageTreeItem): Promise<(ConversationTreeItem | MessageTreeItem)[]> {
    if (!element) {
      // Return root level conversations with virtual scrolling
      const items: (ConversationTreeItem | MessageTreeItem)[] = [];
      
      // Add conversation items
      for (const conversation of this.conversations) {
        // Check cache first
        let conversationItem = this.conversationCache.get(conversation.id);
        
        if (!conversationItem) {
          conversationItem = new ConversationTreeItem(
            conversation,
            this.expandedConversations.has(conversation.id) 
              ? vscode.TreeItemCollapsibleState.Expanded 
              : vscode.TreeItemCollapsibleState.Collapsed
          );
          this.conversationCache.set(conversation.id, conversationItem);
        }
        
        items.push(conversationItem);
      }
      
      // Add "Load More" item if there are more conversations
      if (this.hasMoreConversations && !this.isLoading) {
        const loadMoreItem = new vscode.TreeItem('Load More...', vscode.TreeItemCollapsibleState.None);
        loadMoreItem.iconPath = new vscode.ThemeIcon('refresh');
        loadMoreItem.tooltip = `Load more conversations (${this.conversations.length}/${this.totalConversations})`;
        loadMoreItem.command = {
          command: 'cursorCompanion.loadMoreConversations',
          title: 'Load More Conversations'
        };
        items.push(loadMoreItem as any);
      }
      
      // Add loading indicator if loading
      if (this.isLoading && this.conversations.length > 0) {
        const loadingItem = new vscode.TreeItem('Loading...', vscode.TreeItemCollapsibleState.None);
        loadingItem.iconPath = new vscode.ThemeIcon('loading~spin');
        loadingItem.tooltip = 'Loading more conversations...';
        items.push(loadingItem as any);
      }
      
      return items;
    }

    if (element instanceof ConversationTreeItem) {
      // Return messages for this conversation with lazy loading
      return await this.getMessagesForConversation(element.conversation.id);
    }

    // Messages don't have children
    return [];
  }

  /**
   * Get messages for a conversation with caching and lazy loading
   */
  private async getMessagesForConversation(conversationId: string): Promise<MessageTreeItem[]> {
    // Check if already loading
    if (this.loadingMessages.has(conversationId)) {
      return [this.createLoadingMessageItem()];
    }

    // Check cache first
    if (this.messageCache.has(conversationId)) {
      return this.messageCache.get(conversationId)!;
    }

    // Start loading
    this.loadingMessages.add(conversationId);

    try {
      // Check if we have a performance manager for lazy loading
      const performanceManager = (this.dataStorage as any).performanceManager;
      let messages: Message[];

      if (performanceManager && typeof performanceManager.getMessagesLazy === 'function') {
        // Use lazy loading
        const result = await performanceManager.getMessagesLazy(conversationId, 0, 20);
        messages = result.items;
        
        // If there are more messages, add a "Load More" item
        if (result.hasMore) {
          const messageItems = messages.map(message => new MessageTreeItem(message));
          const loadMoreItem = this.createLoadMoreMessagesItem(conversationId, result.offset + result.limit);
          messageItems.push(loadMoreItem);
          
          this.messageCache.set(conversationId, messageItems);
          return messageItems;
        }
      } else {
        // Fallback to regular loading
        messages = await this.dataStorage.getMessages(conversationId);
      }

      const messageItems = messages.map(message => new MessageTreeItem(message));
      this.messageCache.set(conversationId, messageItems);
      
      return messageItems;
    } catch (error) {
      console.error(`Failed to load messages for conversation ${conversationId}:`, error);
      
      // Return error item
      return [this.createErrorMessageItem(conversationId)];
    } finally {
      this.loadingMessages.delete(conversationId);
    }
  }

  /**
   * Create loading message item
   */
  private createLoadingMessageItem(): MessageTreeItem {
    const loadingItem = new vscode.TreeItem('Loading messages...', vscode.TreeItemCollapsibleState.None);
    loadingItem.iconPath = new vscode.ThemeIcon('loading~spin');
    loadingItem.tooltip = 'Loading messages...';
    return loadingItem as any;
  }

  /**
   * Create load more messages item
   */
  private createLoadMoreMessagesItem(conversationId: string, offset: number): MessageTreeItem {
    const loadMoreItem = new vscode.TreeItem('Load More Messages...', vscode.TreeItemCollapsibleState.None);
    loadMoreItem.iconPath = new vscode.ThemeIcon('refresh');
    loadMoreItem.tooltip = 'Load more messages';
    loadMoreItem.command = {
      command: 'cursorCompanion.loadMoreMessages',
      title: 'Load More Messages',
      arguments: [conversationId, offset]
    };
    return loadMoreItem as any;
  }

  /**
   * Create error message item
   */
  private createErrorMessageItem(conversationId: string): MessageTreeItem {
    const errorItem = new vscode.TreeItem('Failed to load messages', vscode.TreeItemCollapsibleState.None);
    errorItem.iconPath = new vscode.ThemeIcon('error');
    errorItem.tooltip = 'Click to retry loading messages';
    errorItem.command = {
      command: 'cursorCompanion.retryLoadMessages',
      title: 'Retry Load Messages',
      arguments: [conversationId]
    };
    return errorItem as any;
  }

  /**
   * Load more messages for a conversation
   */
  async loadMoreMessages(conversationId: string, offset: number): Promise<void> {
    try {
      const performanceManager = (this.dataStorage as any).performanceManager;
      
      if (performanceManager && typeof performanceManager.getMessagesLazy === 'function') {
        const result = await performanceManager.getMessagesLazy(conversationId, offset, 20);
        
        // Get existing cached messages
        const existingMessages = this.messageCache.get(conversationId) || [];
        
        // Remove the "Load More" item if it exists
        const filteredMessages = existingMessages.filter(item => 
          (item as any).command?.command !== 'cursorCompanion.loadMoreMessages'
        );
        
        // Add new messages
        const newMessageItems = result.items.map((message: Message) => new MessageTreeItem(message));
        const updatedMessages = [...filteredMessages, ...newMessageItems];
        
        // Add new "Load More" item if there are more messages
        if (result.hasMore) {
          const loadMoreItem = this.createLoadMoreMessagesItem(conversationId, result.offset + result.limit);
          updatedMessages.push(loadMoreItem);
        }
        
        this.messageCache.set(conversationId, updatedMessages);
        this.debouncedRefresh();
      }
    } catch (error) {
      console.error(`Failed to load more messages for conversation ${conversationId}:`, error);
      vscode.window.showErrorMessage('Failed to load more messages');
    }
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
    // Clear any existing timeout
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }

    // Debounce the filter operation
    this.loadingTimeout = setTimeout(async () => {
      try {
        if (!query.trim()) {
          // No filter, load all conversations
          this.currentFilter = undefined;
        } else {
          // Filter conversations by search query
          this.currentFilter = {
            searchQuery: query
          };
        }
        
        await this.loadConversations();
      } catch (error) {
        console.error('Failed to filter conversations:', error);
        vscode.window.showErrorMessage('Failed to filter conversations');
      }
    }, 300); // 300ms debounce
  }

  async filterByStatus(status: 'all' | 'active' | 'archived'): Promise<void> {
    try {
      this.currentFilter = {
        ...this.currentFilter,
        status
      };
      
      await this.loadConversations();
    } catch (error) {
      console.error('Failed to filter by status:', error);
      vscode.window.showErrorMessage('Failed to filter conversations');
    }
  }

  async filterByDateRange(startDate: Date, endDate: Date): Promise<void> {
    try {
      this.currentFilter = {
        ...this.currentFilter,
        dateRange: {
          start: startDate.getTime(),
          end: endDate.getTime()
        }
      };
      
      await this.loadConversations();
    } catch (error) {
      console.error('Failed to filter by date range:', error);
      vscode.window.showErrorMessage('Failed to filter conversations');
    }
  }

  async filterByTags(tags: string[]): Promise<void> {
    try {
      this.currentFilter = {
        ...this.currentFilter,
        tags
      };
      
      await this.loadConversations();
    } catch (error) {
      console.error('Failed to filter by tags:', error);
      vscode.window.showErrorMessage('Failed to filter conversations');
    }
  }

  clearFilters(): void {
    this.currentFilter = undefined;
    this.loadConversations();
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

  async retryLoadMessages(conversationId: string): Promise<void> {
    try {
      // Find the conversation item and refresh it
      const conversationItem = this.conversations.find(c => c.id === conversationId);
      if (conversationItem) {
        this.refresh();
      }
    } catch (error) {
      console.error(`Failed to retry loading messages for conversation ${conversationId}:`, error);
      vscode.window.showErrorMessage('Failed to retry loading messages');
    }
  }

  async exportConversation(conversationId: string): Promise<void> {
    try {
      const conversation = await this.dataStorage.getConversation(conversationId);
      if (!conversation) {
        vscode.window.showErrorMessage('Conversation not found');
        return;
      }

      const messages = await this.dataStorage.getMessages(conversationId);
      
      const exportData = {
        conversation,
        messages,
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };

      const exportJson = JSON.stringify(exportData, null, 2);
      
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`conversation-${conversation.title.replace(/[^a-zA-Z0-9]/g, '-')}.json`),
        filters: {
          'JSON Files': ['json']
        }
      });

      if (saveUri) {
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(exportJson, 'utf8'));
        vscode.window.showInformationMessage('Conversation exported successfully');
      }
    } catch (error) {
      console.error(`Failed to export conversation ${conversationId}:`, error);
      vscode.window.showErrorMessage('Failed to export conversation');
    }
  }

  async duplicateConversation(conversationId: string): Promise<void> {
    try {
      const conversation = await this.dataStorage.getConversation(conversationId);
      if (!conversation) {
        vscode.window.showErrorMessage('Conversation not found');
        return;
      }

      const messages = await this.dataStorage.getMessages(conversationId);
      
      // Create duplicate conversation
      const duplicateConversation: Conversation = {
        ...conversation,
        id: generateUUID(),
        title: `${conversation.title} (Copy)`,
        timestamp: Date.now(),
        messages: []
      };

      await this.dataStorage.saveConversation(duplicateConversation);

      // Duplicate messages
      for (const message of messages) {
        const duplicateMessage: Message = {
          ...message,
          id: generateUUID(),
          conversationId: duplicateConversation.id,
          timestamp: Date.now()
        };
        
        await this.dataStorage.saveMessage(duplicateMessage);
        duplicateConversation.messages.push(duplicateMessage);
      }

      // Update conversation with message IDs
      await this.dataStorage.saveConversation(duplicateConversation);
      await this.loadConversations();
      
      vscode.window.showInformationMessage('Conversation duplicated successfully');
    } catch (error) {
      console.error(`Failed to duplicate conversation ${conversationId}:`, error);
      vscode.window.showErrorMessage('Failed to duplicate conversation');
    }
  }

  async getConversationStats(): Promise<{
    total: number;
    active: number;
    archived: number;
    totalMessages: number;
  }> {
    try {
      const allConversations = await this.dataStorage.getConversations();
      const active = allConversations.filter(c => c.status !== 'archived').length;
      const archived = allConversations.filter(c => c.status === 'archived').length;
      const totalMessages = allConversations.reduce((sum, c) => sum + (Array.isArray(c.messages) ? c.messages.length : 0), 0);

      return {
        total: allConversations.length,
        active,
        archived,
        totalMessages
      };
    } catch (error) {
      console.error('Failed to get conversation stats:', error);
      return { total: 0, active: 0, archived: 0, totalMessages: 0 };
    }
  }

  async searchInMessages(query: string): Promise<{ conversation: Conversation; message: Message }[]> {
    try {
      const results: { conversation: Conversation; message: Message }[] = [];
      
      for (const conversation of this.conversations) {
        const messages = await this.dataStorage.getMessages(conversation.id, {
          searchQuery: query
        });
        
        for (const message of messages) {
          results.push({ conversation, message });
        }
      }
      
      return results;
    } catch (error) {
      console.error('Failed to search in messages:', error);
      return [];
    }
  }

  dispose(): void {
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }
    
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    
    // Clear caches
    this.conversationCache.clear();
    this.messageCache.clear();
    this.loadingConversations.clear();
    this.loadingMessages.clear();
  }
}